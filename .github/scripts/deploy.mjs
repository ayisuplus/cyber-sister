// Runs only in a trusted GitHub-hosted deployment job. No application key is needed.
import { spawn } from 'node:child_process'
import { createReadStream, createWriteStream, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'

const repo = process.env.GITHUB_REPOSITORY
const branch = 'master'
const token = process.env.GITHUB_TOKEN
if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo || '') || !token) throw new Error('Missing deployment context')
async function api(path) {
  const response = await fetch(`https://api.github.com/repos/${repo}/${path}`, {
    headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
    redirect: 'error', signal: AbortSignal.timeout(30000),
  })
  if (!response.ok) throw new Error(`GitHub API rejected request (${response.status})`)
  return response.json()
}

const event = JSON.parse(await (await import('node:fs/promises')).readFile(process.env.GITHUB_EVENT_PATH, 'utf8'))
let id = process.env.CI_RUN_ID || event.workflow_run?.id
if (id && !/^\d+$/.test(String(id))) throw new Error('Invalid CI run ID')
if (!id) {
  const listing = await api(`actions/workflows/ci.yml/runs?branch=${branch}&event=push&status=success&per_page=20`)
  id = listing.workflow_runs[0]?.id
}
if (!id) throw new Error('No successful master CI run found')
const [run, workflow, ref] = await Promise.all([api(`actions/runs/${id}`), api('actions/workflows/ci.yml'), api(`git/ref/heads/${branch}`)])
if (run.workflow_id !== workflow.id || run.event !== 'push' || run.head_repository?.full_name !== repo || run.head_branch !== branch
  || run.status !== 'completed' || run.conclusion !== 'success') throw new Error('CI run is not a trusted successful master push')
if (ref.object.sha !== run.head_sha) {
  console.log('Skipping superseded CI commit; the current master will be deployed by its own run.')
  process.exit(0)
}
const listing = await api(`actions/runs/${run.id}/artifacts?per_page=100`)
const artifacts = listing.artifacts.filter(item => item.name === 'release-bundle' && !item.expired)
if (artifacts.length !== 1 || !/^sha256:[a-f0-9]{64}$/.test(artifacts[0]?.digest || '')) throw new Error('Release bundle missing, expired or unverifiable')
const artifact = artifacts[0]
const temporary = mkdtempSync(join(tmpdir(), 'amie-deploy-'))
try {
  const archive = join(temporary, 'release.zip')
  const response = await fetch(`https://api.github.com/repos/${repo}/actions/artifacts/${artifact.id}/zip`, {
    headers: { authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28' }, redirect: 'manual', signal: AbortSignal.timeout(30000),
  })
  let download = response
  if (response.status === 302) {
    const url = new URL(response.headers.get('location'))
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Invalid artifact download URL')
    // The signed storage redirect receives no GitHub Authorization header.
    download = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(120000) })
  }
  if (!download.ok || !download.body) throw new Error('Artifact download failed')
  await pipeline(Readable.fromWeb(download.body), createWriteStream(archive, { mode: 0o600 }))
  const size = statSync(archive).size
  if (size <= 0 || size > 128 * 1024 * 1024) throw new Error('Unexpected artifact size')
  const host = process.env.AMIE_SSH_HOST, port = process.env.AMIE_SSH_PORT || '22', user = process.env.AMIE_SSH_USER
  if (!/^[A-Za-z0-9.-]+$/.test(host || '') || !/^\d{1,5}$/.test(port) || !/^[a-z_][a-z0-9_-]*$/.test(user || '')) throw new Error('Invalid SSH destination')
  if (!process.env.AMIE_SSH_PRIVATE_KEY || !process.env.AMIE_SSH_KNOWN_HOSTS) throw new Error('Missing deployment SSH secrets')
  const key = join(temporary, 'key'), hosts = join(temporary, 'known_hosts')
  writeFileSync(key, process.env.AMIE_SSH_PRIVATE_KEY.trimEnd() + '\n', { mode: 0o600 })
  writeFileSync(hosts, process.env.AMIE_SSH_KNOWN_HOSTS.trimEnd() + '\n', { mode: 0o600 })
  const ssh = spawn('ssh', ['-F', '/dev/null', '-T', '-p', port, '-i', key,
    '-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes', '-o', 'StrictHostKeyChecking=yes',
    '-o', `UserKnownHostsFile=${hosts}`, '-o', 'ConnectTimeout=30', '-o', 'ServerAliveInterval=15',
    `${user}@${host}`, 'deploy'], { stdio: ['pipe', 'pipe', 'inherit'], env: { PATH: process.env.PATH, HOME: temporary, LANG: 'C.UTF-8' } })
  let output = ''
  ssh.stdout.on('data', chunk => { output += chunk; if (output.length > 16384) ssh.kill() })
  const exited = new Promise((done, reject) => {
    ssh.once('error', reject)
    ssh.once('exit', code => code === 0 ? done() : reject(new Error('Restricted server deployment failed')))
  })
  ssh.stdin.write(JSON.stringify({ run_id: run.id, artifact_id: artifact.id, sha: run.head_sha, token, archive_size: size }) + '\n')
  await Promise.all([pipeline(createReadStream(archive), ssh.stdin), exited])
  const receipt = JSON.parse(output)
  console.log(JSON.stringify(receipt))
  if (process.env.GITHUB_STEP_SUMMARY) {
    const { appendFileSync } = await import('node:fs')
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `Deployment: **${receipt.status}**\n\nCommit: \`${receipt.source_sha}\`\n\nImage tag: \`${receipt.tag}\`\n\nCI: https://github.com/${repo}/actions/runs/${run.id}\n`)
  }
} finally {
  if (dirname(resolve(temporary)) !== resolve(tmpdir())) throw new Error('Unsafe temporary path')
  rmSync(temporary, { recursive: true, force: true })
}
