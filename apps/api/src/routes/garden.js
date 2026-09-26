import { Router } from 'express'
import { createCollectionUpload } from '../utils/imageUpload.js'
import { MAX_PHOTO_BYTES } from '../utils/photoStore.js'
import * as gardenService from '../services/gardenService.js'
import { identifyPlant } from '../services/plantIdService.js'
import logger from '../utils/logger.js'

// 花草图鉴（路线图 C26）。每个接口都只作用于当前登录的人。
const router = Router()
const upload = createCollectionUpload({ maxBytes: MAX_PHOTO_BYTES, fieldSize: 16 * 1024 })

function sendError(res, error, fallback) {
  if (!error.statusCode) logger.error(fallback, { error: error.message })
  if (!error.statusCode) return res.status(500).json({ error: fallback })
  // 没同意云端、模型不可用等要让页面说清楚原因，带上 code
  return res.status(error.statusCode).json({ error: error.message, ...(error.code ? { code: error.code } : {}) })
}

// 认一认：照片只在这一次请求里用，不落盘；收不收由她
router.post('/identify', upload, async (req, res) => {
  try {
    res.json(await identifyPlant(req.user.userId, req.files, { requestId: req.requestId }))
  } catch (error) {
    sendError(res, error, '这会儿没认出来，过一会儿再试试')
  }
})

router.get('/', async (req, res) => {
  try {
    res.json({ entries: await gardenService.listEntries(req.user.userId, req.query.status || undefined) })
  } catch (error) {
    sendError(res, error, '图鉴没读出来')
  }
})

router.post('/', upload, async (req, res) => {
  try {
    res.json(await gardenService.createEntry(req.user.userId, req.body, req.files))
  } catch (error) {
    sendError(res, error, '没收进去，请重试')
  }
})

router.put('/:id', upload, async (req, res) => {
  try {
    res.json(await gardenService.updateEntry(req.user.userId, req.params.id, req.body, req.files))
  } catch (error) {
    sendError(res, error, '没改成功，请重试')
  }
})

router.delete('/:id', async (req, res) => {
  try {
    await gardenService.deleteEntry(req.user.userId, req.params.id)
    res.json({ success: true })
  } catch (error) {
    sendError(res, error, '没拿掉，请重试')
  }
})

for (const kind of ['photo', 'thumb']) {
  router.get(`/:id/${kind}`, async (req, res) => {
    try {
      const { buffer, mime } = await gardenService.readPhoto(req.user.userId, req.params.id, kind)
      res.set('Cache-Control', 'no-store').type(mime).send(buffer)
    } catch (error) {
      sendError(res, error, '照片没读出来')
    }
  })
}

export default router
