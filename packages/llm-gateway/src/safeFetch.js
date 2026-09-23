import { lookup as dnsLookup } from 'node:dns'
import http from 'node:http'
import https from 'node:https'
import { Readable } from 'node:stream'
import ipaddr from 'ipaddr.js'

const isPublicIp = (address) => ipaddr.isValid(address) && ipaddr.process(address).range() === 'unicast'

/** Resolve and pin the checked address on the actual socket. Native request never follows redirects. */
export function safeProviderFetch(input, init = {}, { allowLoopback = false, lookupImpl = dnsLookup } = {}) {
  const url = new URL(input)
  const host = url.hostname.replace(/^\[|\]$/g, '')
  const local = allowLoopback && url.protocol === 'http:' && host === '127.0.0.1'
  if ((!local && url.protocol !== 'https:') || url.username || url.password
    || /(?:^localhost$|\.(?:_?local|localhost|internal|localdomain)$)/i.test(host)
    || (ipaddr.isValid(host) && !isPublicIp(host) && !local)) {
    return Promise.reject(new Error('provider address is not public'))
  }

  const lookup = (hostname, _options, callback) => {
    lookupImpl(hostname, { all: true, verbatim: true }, (error, records) => {
      if (error || !Array.isArray(records) || records.length === 0 || records.some(({ address }) => !isPublicIp(address))) {
        callback(new Error('provider address resolved to a non-public IP'))
        return
      }
      callback(null, records[0].address, records[0].family)
    })
  }

  return new Promise((resolve, reject) => {
    const client = url.protocol === 'https:' ? https : http
    const request = client.request(url, {
      method: init.method || 'GET',
      headers: init.headers,
      signal: init.signal,
      ...(local ? {} : { lookup }),
    }, (incoming) => {
      const status = incoming.statusCode || 502
      const noBody = [204, 205, 304].includes(status)
      resolve(new Response(noBody ? null : Readable.toWeb(incoming), {
        status,
        headers: incoming.headers,
      }))
    })
    request.on('error', reject)
    request.end(init.body)
  })
}
