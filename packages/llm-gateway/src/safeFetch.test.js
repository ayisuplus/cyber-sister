import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { EventEmitter, once } from 'node:events'
import https from 'node:https'
import { Readable } from 'node:stream'
import { safeProviderFetch } from './safeFetch.js'

for (const all of [false, true]) {
  test(`public DNS honors the native lookup callback contract (all=${all})`, async (t) => {
    const records = [
      { address: '93.184.216.34', family: 4 },
      { address: '2606:4700:4700::1111', family: 6 },
    ]
    let lookups = 0
    t.mock.method(https, 'request', (_url, options, respond) => {
      const request = new EventEmitter()
      request.end = () => {
        options.lookup('model.example', { all }, (error, address, family) => {
          assert.ifError(error)
          if (all) {
            assert.deepEqual(address, [records[0]], 'pin one validated address while returning the native array shape')
            assert.equal(family, undefined)
          } else {
            assert.equal(address, records[0].address)
            assert.equal(family, 4)
          }
          const incoming = Readable.from([Buffer.from('ok')])
          incoming.statusCode = 200
          incoming.headers = {}
          respond(incoming)
        })
      }
      return request
    })
    const response = await safeProviderFetch('https://model.example/v1', {}, {
      lookupImpl: (_host, options, callback) => {
        lookups += 1
        assert.equal(options.all, true)
        callback(null, records)
      },
    })
    assert.equal(response.status, 200)
    assert.equal(await response.text(), 'ok')
    assert.equal(lookups, 1)
  })
}

test('a public first answer never hides a private DNS answer', async () => {
  await assert.rejects(safeProviderFetch('https://model.example/v1', {}, {
    lookupImpl: (_host, _options, callback) => callback(null, [
      { address: '93.184.216.34', family: 4 },
      { address: '127.0.0.1', family: 4 },
    ]),
  }), /non-public IP/)
})

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
