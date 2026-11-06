// CI creates one immutable artifact containing the checked source and its Web build.
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

const sha = process.env.GITHUB_SHA
if (!/^[a-f0-9]{40}$/.test(sha || '')) throw new Error('A GitHub source SHA is required')
if (!existsSync('apps/web/dist/index.html')) throw new Error('Missing Web build')
const destination = resolve('ci-artifacts')
if (existsSync(destination)) throw new Error('Artifact output already exists; refusing to replace it')
const source = join(destination, 'source')
mkdirSync(source, { recursive: true })
const temporary = mkdtempSync(join(tmpdir(), 'amie-ci-bundle-'))
try {
  const archive = join(temporary, 'source.tar')
  execFileSync('git', ['archive', '--format=tar', `--output=${archive}`, sha,
    'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', '.dockerignore',
    'compose.yaml', 'compose.qwen.yaml', 'apps/api', 'apps/web/package.json',
    'apps/web/nginx.conf', 'packages', 'deploy'], { stdio: 'pipe' })
  execFileSync('tar', ['-xf', archive, '-C', source], { stdio: 'pipe' })
  cpSync('apps/web/dist', join(source, 'apps/web/dist'), { recursive: true })
  const manifest = {
    schema: 1, source_sha: sha, run_id: Number(process.env.GITHUB_RUN_ID),
    run_attempt: Number(process.env.GITHUB_RUN_ATTEMPT), profile: 'web', api_base: '/api',
  }
  writeFileSync(join(destination, 'release.json'), JSON.stringify(manifest, null, 2))
  // The artifact contains only explicit deployment paths, never repository docs or .git.
  if (existsSync(join(source, 'docs')) || existsSync(join(source, '.git'))) throw new Error('Unexpected deployment content')
  console.log(`Prepared release bundle for ${sha}`)
} finally {
  if (dirname(resolve(temporary)) !== resolve(tmpdir())) throw new Error('Unsafe temporary path')
  rmSync(temporary, { recursive: true, force: true })
}
