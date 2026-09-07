import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import express from 'express'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import workRoutes from './work.js'

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47])
const IMAGE_ID = 'a1b2c3d4-e5f6-4710-8899-aabbccddeeff.png'

const app = express()
app.use((req, _res, next) => {
  req.user = { userId: 'user-1' }
  next()
})
app.use('/', workRoutes)

describe('work 路由', () => {
  let workImageDir

  beforeEach(async () => {
    workImageDir = await mkdtemp(join(tmpdir(), 'work-route-img-'))
    process.env.WORK_IMAGE_DIR = workImageDir
    await mkdir(join(workImageDir, 'user-1'), { recursive: true })
    await writeFile(join(workImageDir, 'user-1', IMAGE_ID), PNG_BYTES)
  })

  afterEach(async () => {
    delete process.env.WORK_IMAGE_DIR
    await rm(workImageDir, { recursive: true, force: true })
  })

  it('GET /status 暴露浏览器可用性形状', async () => {
    const response = await request(app).get('/status')

    expect(response.status).toBe(200)
    expect(response.body.browser).toMatchObject({
      enabled: expect.any(Boolean),
      running: expect.any(Boolean),
      headed: expect.any(Boolean),
    })
  })

  it('GET /images/:name 按用户隔离读取，非法与不存在一律 404', async () => {
    const ok = await request(app)
      .get(`/images/${IMAGE_ID}`)
      .buffer(true)
      .parse((res, callback) => {
        const chunks = []
        res.on('data', (chunk) => chunks.push(chunk))
        res.on('end', () => callback(null, Buffer.concat(chunks)))
      })
    expect(ok.status).toBe(200)
    expect(ok.headers['content-type']).toContain('image/png')
    expect(Buffer.compare(ok.body, PNG_BYTES)).toBe(0)

    const badName = await request(app).get('/images/../../etc/passwd')
    expect(badName.status).toBe(404)

    const missing = await request(app).get('/images/00000000-0000-4000-8000-000000000000.png')
    expect(missing.status).toBe(404)
  })
})
