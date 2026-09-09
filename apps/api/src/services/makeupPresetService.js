/**
 * 妆容预设服务：化妆间四滑杆（磨皮/美白/瘦脸/大眼）组合的命名预设，服务端落库多设备同步。
 */
import prisma from '../prisma/client.js'
import { findOwned, deleteOwned, HttpError } from '../utils/dbHelpers.js'
import logger from '../utils/logger.js'

function validateSettings({ smooth, whiten, slim, eye }) {
  for (const value of [smooth, whiten, slim, eye]) {
    if (!Number.isInteger(value) || value < 0 || value > 100) {
      throw new HttpError('妆容参数需为 0-100 的整数', 400)
    }
  }
}

function validateName(name) {
  if (typeof name !== 'string') throw new HttpError('妆容名字需为 1-20 个字', 400)
  const trimmed = name.trim()
  if (!trimmed || trimmed.length > 20) throw new HttpError('妆容名字需为 1-20 个字', 400)
  return trimmed
}

export function listPresets(userId) {
  return prisma.makeupPreset.findMany({
    where: { userId },
    orderBy: { createdAt: 'asc' },
  })
}

export async function createPreset(userId, { name, smooth, whiten, slim, eye }) {
  validateSettings({ smooth, whiten, slim, eye })
  const preset = await prisma.makeupPreset.create({
    data: { userId, name: validateName(name), smooth, whiten, slim, eye },
  })
  logger.info('创建妆容预设', { userId, presetId: preset.id })
  return preset
}

export async function renamePreset(userId, presetId, { name }) {
  await findOwned('makeupPreset', presetId, userId, '妆容预设')
  const preset = await prisma.makeupPreset.update({
    where: { id: presetId },
    data: { name: validateName(name) },
  })
  logger.info('重命名妆容预设', { userId, presetId })
  return preset
}

export async function deletePreset(userId, presetId) {
  await deleteOwned('makeupPreset', presetId, userId, '妆容预设')
  logger.info('删除妆容预设', { userId, presetId })
}

