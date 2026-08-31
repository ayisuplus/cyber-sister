import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { dirname, extname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const WEB_DIST = resolve(dirname(fileURLToPath(import.meta.url)), '../dist')
const MAKEUP_DIST = resolve(dirname(fileURLToPath(import.meta.url)), '../../../packages/makeup-skill/dist')

const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
}

function staticHandler(root, prefix = '/') {
  const rootBoundary = `${root}${sep}`
  return async (request, response) => {
    const pathname = new URL(request.url || '/', 'http://127.0.0.1').pathname
    if (pathname.startsWith('/api/') || pathname.startsWith('/makeup/api/')) {
      response.writeHead(404, { 'Content-Type': 'application/json' })
      response.end('{"error":"unmocked API request"}')
      return
    }

    const stripped = prefix === '/'
      ? pathname.slice(1)
      : pathname.startsWith(prefix) ? pathname.slice(prefix.length) : ''
    let filePath = resolve(root, stripped || 'index.html')
    if (filePath !== root && !filePath.startsWith(rootBoundary)) {
      response.writeHead(400)
      response.end()
      return
    }

    try {
      if (!(await stat(filePath)).isFile()) throw new Error('not a file')
    } catch {
      filePath = resolve(root, 'index.html')
    }

    try {
      const body = await readFile(filePath)
      response.writeHead(200, {
        'Cache-Control': 'no-store',
        'Content-Type': contentTypes[extname(filePath)] || 'application/octet-stream',
      })
      response.end(body)
    } catch {
      response.writeHead(404)
      response.end()
    }
  }
}

function listen(root, prefix, port) {
  const server = createServer(staticHandler(root, prefix))
  return new Promise((resolvePromise, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => resolvePromise(server))
  })
}

function close(server) {
  return new Promise((resolvePromise, reject) => {
    server.close(error => error ? reject(error) : resolvePromise())
  })
}

export default async function globalSetup() {
  const servers = await Promise.all([
    listen(WEB_DIST, '/', 4173),
    listen(MAKEUP_DIST, '/makeup/', 4174),
  ])
  return async () => Promise.all(servers.map(close))
}
