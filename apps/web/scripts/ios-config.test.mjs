import { test } from 'node:test'
import assert from 'node:assert/strict'
import { iosBuildSettings } from './ios-config.mjs'

test('rejects unsafe API targets before producing an iOS bundle', () => {
  for (const url of ['http://localhost:3000/api', 'https://secret@host/api', 'https://host/api?key=private', 'https://host/wrong', 'javascript:alert(1)']) {
    assert.throws(() => iosBuildSettings({ AMIE_IOS_API_URL: url }))
  }
})
test('limits packaged networking to the chosen API and ignores Web/local environment settings', () => {
  const result = iosBuildSettings({ AMIE_IOS_API_URL: 'https://amie.test/api/', VITE_API_BASE_URL: 'http://localhost:3000/api', VITE_APP_DISTRIBUTION: 'local' })
  assert.equal(result.apiUrl, 'https://amie.test/api')
  assert.match(result.csp, /connect-src 'self' https:\/\/amie\.test;/)
  assert.equal(iosBuildSettings({}).apiUrl, 'https://api.example.invalid/api')
})
