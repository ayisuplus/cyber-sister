/**
 * 经本机助手执行的工具：只在用户电脑上的助手在线时出现。
 * 路径一律是「用户授权文件夹」内的相对路径；越界、覆盖与删除由助手在本机拒绝（权威校验在助手侧），
 * 这里只做形状校验，并把结果裁剪后交给模型。读到的文件内容是资料，不是用户的新指令。
 */
import { HttpError } from '../utils/dbHelpers.js'
import { dispatchJob } from './bridgeBroker.js'

const MAX_PATH_CHARS = 300
const MAX_WRITE_CHARS = 200_000
const MAX_LISTED = 200

function relativePath(value, { required = false } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw new HttpError('需要授权文件夹内的相对路径', 400)
    return ''
  }
  if (typeof value !== 'string' || value.length > MAX_PATH_CHARS || value.includes('\0')) throw new HttpError('路径格式不对', 400)
  return value.trim()
}

const label = (path) => path || '授权文件夹'

export const BRIDGE_TOOLS = {
  list_local_files: {
    description: '{"tool":"list_local_files","args":{"path":"可选，授权文件夹内的相对路径，默认是文件夹本身"}} 看用户授权文件夹里有哪些文件和子文件夹',
    run: async (userId, args, context = {}) => {
      const path = relativePath(args.path)
      const result = await dispatchJob(userId, 'list', { path }, { signal: context.signal })
      const entries = Array.isArray(result?.entries) ? result.entries.slice(0, MAX_LISTED) : []
      return { summary: `看了「${label(path)}」里的 ${entries.length} 项`, result: { path, entries, truncated: Boolean(result?.truncated) } }
    },
  },
  read_local_file: {
    description: '{"tool":"read_local_file","args":{"path":"授权文件夹内的相对路径","offset":"可选，从第几个字符开始，默认 0"}} 读用户授权文件夹里的一个文本文件；每次最多两万字，hasMore 为 true 时用 nextOffset 继续',
    run: async (userId, args, context = {}) => {
      const path = relativePath(args.path, { required: true })
      const offset = args.offset === undefined ? 0 : Number(args.offset)
      if (!Number.isInteger(offset) || offset < 0) throw new HttpError('offset 需要是非负整数', 400)
      const result = await dispatchJob(userId, 'read', { path, offset }, { signal: context.signal })
      return { summary: `读了「${path}」`, result: { path, content: String(result?.content ?? ''), hasMore: Boolean(result?.hasMore), nextOffset: result?.nextOffset ?? null } }
    },
  },
  write_local_file: {
    description: '{"tool":"write_local_file","args":{"path":"授权文件夹内的新文件相对路径","content":"完整文本内容"}} 在用户授权文件夹里新建一个文本文件；同名文件已存在时不会覆盖，会如实失败',
    run: async (userId, args, context = {}) => {
      const path = relativePath(args.path, { required: true })
      if (typeof args.content !== 'string' || args.content.length > MAX_WRITE_CHARS) throw new HttpError(`内容需要是不超过 ${MAX_WRITE_CHARS} 字的文本`, 400)
      const result = await dispatchJob(userId, 'write', { path, content: args.content }, { signal: context.signal })
      return { summary: `在你的电脑上新建了「${path}」`, result: { path, bytes: result?.bytes ?? null } }
    },
  },
}

export const BRIDGE_TOOL_PARAMETERS = {
  list_local_files: { type: 'object', properties: { path: { type: 'string', maxLength: MAX_PATH_CHARS } }, required: [], additionalProperties: false },
  read_local_file: { type: 'object', properties: { path: { type: 'string', maxLength: MAX_PATH_CHARS }, offset: { type: 'integer', minimum: 0 } }, required: ['path'], additionalProperties: false },
  write_local_file: { type: 'object', properties: { path: { type: 'string', maxLength: MAX_PATH_CHARS }, content: { type: 'string', maxLength: MAX_WRITE_CHARS } }, required: ['path', 'content'], additionalProperties: false },
}
