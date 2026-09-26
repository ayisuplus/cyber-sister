import { Router } from 'express'
import { createCollectionUpload } from '../utils/imageUpload.js'
import { MAX_PHOTO_BYTES } from '../utils/photoStore.js'
import * as gardenService from '../services/gardenService.js'
import logger from '../utils/logger.js'

// 花草图鉴（路线图 C26）。每个接口都只作用于当前登录的人。
const router = Router()
const upload = createCollectionUpload({ maxBytes: MAX_PHOTO_BYTES, fieldSize: 16 * 1024 })

function sendError(res, error, fallback) {
  if (!error.statusCode) logger.error(fallback, { error: error.message })
  return res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : fallback })
}

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
