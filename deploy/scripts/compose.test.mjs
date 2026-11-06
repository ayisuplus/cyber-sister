import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

test('rendered Tunnel stack publishes only its loopback port and removes TLS mounts', t => {
  const temp = mkdtempSync(join(tmpdir(), 'amie-compose-test-'))
  t.after(() => {
    assert.equal(dirname(resolve(temp)), resolve(tmpdir()))
    rmSync(temp, { recursive: true, force: true })
  })
  const envFile = join(temp, 'runtime.env')
  writeFileSync(envFile, '')
  const env = {
    ...process.env, RUNTIME_ENV_FILE: envFile, IMAGE_TAG: 'synthetic-compose-test',
    APP_DOMAIN: 'fixture.invalid', BIND_ADDRESS: '127.0.0.1', TUNNEL_PORT: '18080',
    TLS_CERT_PATH: '/dev/null', TLS_KEY_PATH: '/dev/null',
  }
  for (const key of ['POSTGRES_PASSWORD_FILE', 'DATABASE_PASSWORD_FILE', 'JWT_SECRET_FILE', 'JWT_REFRESH_SECRET_FILE', 'INTERNAL_TEST_CODE_FILE', 'INTERNAL_TEST_PHONES_FILE', 'INSTANCE_ADMIN_PHONES_FILE', 'MODEL_CONFIG_KEY_FILE']) env[key] = envFile
  const result = spawnSync('docker', ['compose', '-f', 'compose.yaml', '-f', 'deploy/compose.server.yaml', '-f', 'deploy/compose.tunnel.yaml', 'config', '--format', 'json'], { cwd: root, env, encoding: 'utf8' })
  assert.ifError(result.error)
  assert.equal(result.status, 0, result.stderr)
  const config = JSON.parse(result.stdout)
  assert.equal(config.services.api.environment.APP_DISTRIBUTION, 'web')
  assert.equal(config.services.api.environment.BIND_ADDRESS, '127.0.0.1')
  const published = Object.values(config.services).flatMap(service => service.ports || [])
  assert.equal(published.length, 1)
  assert.equal(published[0].host_ip, '127.0.0.1')
  assert.equal(String(published[0].published), '18080')
  assert.equal(config.services.edge.volumes.length, 1)
  assert.equal(config.services.edge.volumes[0].target, '/etc/nginx/templates/default.conf.template')
  assert.match(config.services.edge.volumes[0].source, /nginx\.tunnel\.conf$/)
  assert.equal(config.networks.database.internal, true)
  assert.ok(config.services.api.volumes.some(volume => volume.target === '/workspace/apps/api/data'))
  const nginx = readFileSync(join(root, 'deploy/nginx.tunnel.conf'), 'utf8')
  assert.match(nginx, /proxy_buffering off/)
  assert.match(nginx, /X-Forwarded-Proto https/)
  assert.doesNotMatch(nginx, /listen .*ssl|ssl_certificate/)
})
