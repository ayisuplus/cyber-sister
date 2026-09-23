import { Router } from 'express'
import { createCollectionUpload } from '../utils/imageUpload.js'
import * as collectionService from '../services/collectionService.js'
import logger from '../utils/logger.js'

// 「装扮」里的收藏：衣柜与化妆间共用。每个接口都只作用于当前登录的人。
const router = Router()
const upload = createCollectionUpload({ maxBytes: collectionService.MAX_PHOTO_BYTES })

function sendError(res, error, fallback) {
  if (!error.statusCode) logger.error(fallback, { error: error.message })
  return res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : fallback })
}

router.get('/', async (req, res) => {
  try {
    res.json({ items: await collectionService.listItems(req.user.userId, req.query.shelf || undefined) })
  } catch (error) {
    sendError(res, error, '收藏没读出来')
  }
})

router.post('/', upload, async (req, res) => {
  try {
    res.json(await collectionService.createItem(req.user.userId, req.body, req.files))
  } catch (error) {
    sendError(res, error, '没放进去，请重试')
  }
})

router.put('/:id', upload, async (req, res) => {
  try {
    res.json(await collectionService.updateItem(req.user.userId, req.params.id, req.body, req.files))
  } catch (error) {
    sendError(res, error, '没改成功，请重试')
  }
})

router.delete('/:id', async (req, res) => {
  try {
    await collectionService.deleteItem(req.user.userId, req.params.id)
    res.json({ success: true })
  } catch (error) {
    sendError(res, error, '没删掉，请重试')
  }
})

for (const kind of ['photo', 'thumb']) {
  router.get(`/:id/${kind}`, async (req, res) => {
    try {
      const { buffer, mime } = await collectionService.readPhoto(req.user.userId, req.params.id, kind)
      res.set('Cache-Control', 'no-store').type(mime).send(buffer)
    } catch (error) {
      sendError(res, error, '照片没读出来')
    }
  })
}

export default router
