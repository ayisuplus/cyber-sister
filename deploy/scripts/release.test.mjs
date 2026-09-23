import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

// Run the real release and rollback scripts against fake commands: no Docker, network or user data.
const scripts = dirname(fileURLToPath(import.meta.url))
const bash = process.env.BASH_BINARY || 'bash'
const docker = `#!/usr/bin/env bash
printf '%s %s\n' "$IMAGE_TAG" "$*" >> "$STATE_DIR/commands"
if [ "$1" = compose ]; then
  shift
  while [ "$1" = -f ] || [ "$1" = --env-file ]; do shift 2; done
  case "$1" in
    version|config) exit 0 ;;
    ps) echo fake-container ;;
    exec)
      if [[ "$*" == *pg_dump* ]]; then
        [ "$SCENARIO" = empty-backup ] || echo fake-dump
      elif [ "$SCENARIO" = invalid-backup ]; then exit 12; fi ;;
    build) if [ "$SCENARIO" = build-failure ]; then exit 17; fi ;;
    up) if [ "$SCENARIO" = start-failure ] && [ "$IMAGE_TAG" = new ]; then exit 18; fi ;;
    images) echo fake-images ;;
    *) exit 99 ;;
  esac
elif [ "$1" = inspect ]; then
  if [ "$SCENARIO" = unhealthy ] && [ "$IMAGE_TAG" = new ]; then echo unhealthy; else echo healthy; fi
elif [ "$1" = image ]; then
  [ "$SCENARIO" != rollback-failure ]
else exit 99; fi
`

function runRelease(t, scenario, { previous = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'amie-release-test-'))
  t.after(() => {
    assert.equal(dirname(resolve(root)), resolve(tmpdir()))
    assert.ok(root.includes('amie-release-test-'))
    rmSync(root, { recursive: true, force: true })
  })
  for (const dir of ['deploy/scripts', 'apps/web/dist', 'state', 'bin']) mkdirSync(join(root, dir), { recursive: true })
  for (const name of ['release.sh', 'common.sh', 'rollback.sh']) {
    const target = join(root, 'deploy/scripts', name)
    writeFileSync(target, readFileSync(join(scripts, name), 'utf8').replace(/\r\n/g, '\n'), { mode: 0o755 })
  }
  const commands = {
    docker,
    df: '#!/usr/bin/env bash\nprintf "Filesystem 1024-blocks Used Available Capacity Mounted\\nfixture 9999999 0 9999999 0%% /\\n"\n',
    curl: '#!/usr/bin/env bash\nif [ "$SCENARIO" = rollback-failure ] && [ "$IMAGE_TAG" = new ]; then printf 503; else printf 200; fi\n',
    sleep: '#!/usr/bin/env bash\nexit 0\n',
  }
  for (const [name, body] of Object.entries(commands)) writeFileSync(join(root, 'bin', name), body, { mode: 0o755 })
  writeFileSync(join(root, 'runtime.env'), 'BIND_ADDRESS=127.0.0.1\nAPP_DOMAIN=fixture.invalid\n')
  if (previous) writeFileSync(join(root, 'state/current-tag'), 'old\n')
  writeFileSync(join(root, 'run.sh'), `#!/usr/bin/env bash
cd "$(dirname "$0")"
export PATH="$PWD/bin:$PATH" STATE_DIR="$PWD/state" RUNTIME_ENV_FILE="$PWD/runtime.env"
exec bash deploy/scripts/release.sh
`)
  const result = spawnSync(bash, [join(root, 'run.sh')], {
    env: { ...process.env, IMAGE_TAG: 'new', SCENARIO: scenario, HEALTH_RETRIES: '1', HEALTH_INTERVAL: '0', SKIP_BACKUP: '0' },
    encoding: 'utf8', timeout: 15000,
  })
  assert.ifError(result.error)
  const commandLog = readFileSync(join(root, 'state/commands'), 'utf8')
  const output = `${result.stdout}${result.stderr}`
  return { result, commandLog, output, root }
}

for (const [scenario, exitCode] of Object.entries({ unhealthy: 1, 'build-failure': 17, 'start-failure': 18, 'empty-backup': 1, 'invalid-backup': 1 })) {
  test(`release rolls back exactly once on ${scenario}`, t => {
    const { result, commandLog, output, root } = runRelease(t, scenario)
    assert.equal(result.status, exitCode, output)
    assert.equal(commandLog.split('\n').filter(line => line.startsWith('old compose') && line.includes(' up ')).length, 1, output)
    assert.equal(readFileSync(join(root, 'state/current-tag'), 'utf8'), 'old\n')
    assert.doesNotMatch(output, /发布完成：new/)
    assert.doesNotMatch(commandLog, /pg_restore.*--clean|prisma.*reset/)
  })
}

test('successful release records its tag and never rolls back', t => {
  const { result, commandLog, root, output } = runRelease(t, 'success')
  assert.equal(result.status, 0, output)
  assert.doesNotMatch(commandLog, /^old /m)
  assert.equal(readFileSync(join(root, 'state/current-tag'), 'utf8'), 'new\n')
  assert.equal(readFileSync(join(root, 'state/previous-tag'), 'utf8'), 'old\n')
})

test('first release failure has no previous image to roll back', t => {
  const { result, commandLog, output } = runRelease(t, 'unhealthy', { previous: false })
  assert.notEqual(result.status, 0, output)
  assert.doesNotMatch(commandLog, /^old /m)
  assert.match(output, /没有可回滚/)
})

test('rollback failure remains a failed release and is not retried', t => {
  const { result, commandLog, output } = runRelease(t, 'rollback-failure')
  assert.notEqual(result.status, 0, output)
  assert.equal(commandLog.split('\n').filter(line => line.startsWith('old image inspect')).length, 1, output)
  assert.match(output, /回滚也失败/)
  assert.doesNotMatch(output, /发布完成：new/)
})
