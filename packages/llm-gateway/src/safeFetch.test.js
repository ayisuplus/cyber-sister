import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { safeProviderFetch } from './safeFetch.js'

test('DNS resolves to loopback: reject before connecting', async () => {
  let lookups = 0
  await assert.rejects(safeProviderFetch('https://model.example/chat/completions', { method: 'POST' }, {
    lookupImpl: (_host, _options, callback) => {
      lookups += 1
      callback(null, [{ address: '127.0.0.1', family: 4 }])
    },
  }), /non-public IP/)
  assert.equal(lookups, 1)
})

test('private literal addresses cannot bypass DNS validation', async () => {
  await assert.rejects(safeProviderFetch('https://[::ffff:127.0.0.1]/v1'), /not public/)
  await assert.rejects(safeProviderFetch('http://127.0.0.1/v1'), /not public/)
})

test('explicit local runtime accepts loopback but never follows redirects', async (t) => {
  let hits = 0
  const server = createServer((_request, response) => {
    hits += 1
    response.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data' })
    response.end('redirect')
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => server.close())
  const response = await safeProviderFetch(`http://127.0.0.1:${server.address().port}/v1`, {}, { allowLoopback: true })
  assert.equal(response.status, 302)
  assert.equal(hits, 1)
  await response.body.cancel()
})
