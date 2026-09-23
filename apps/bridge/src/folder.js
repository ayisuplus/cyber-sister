/**
 * 授权文件夹：本机助手能碰的唯一地方。这里是越界与覆盖的权威校验（服务端只看形状）。
 * - 只接受相对路径；..、绝对路径、盘符、指向文件夹外面的链接一律拒绝。
 * - 只能看目录、读文本文件、新建文件；不覆盖、不删除、不运行任何东西。
 */
import { mkdir, readdir, readFile, realpath, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'

export const MAX_READ_BYTES = 2 * 1024 * 1024
export const READ_CHUNK_CHARS = 20_000
export const MAX_WRITE_BYTES = 1024 * 1024
export const MAX_LISTED = 200

/** 可以原样告诉用户和模型的失败原因。 */
export class FolderError extends Error {}

const outside = () => new FolderError('不能访问授权文件夹以外的地方')

function normalizeRelative(relative) {
  const rel = String(relative ?? '').replace(/\\/g, '/').trim()
  if (rel.includes('\0')) throw new FolderError('路径格式不对')
  if (path.isAbsolute(rel) || path.win32.isAbsolute(rel) || /^[a-zA-Z]:/.test(rel)) throw new FolderError('只能用授权文件夹里的相对路径')
  return rel
}

const isInside = (root, target) => target === root || target.startsWith(root.endsWith(path.sep) ? root : root + path.sep)

/** 把相对路径解析成授权文件夹内的真实路径。新文件（mustExist=false）检查最近一级已存在的父目录。 */
export async function resolveInside(root, relative, { mustExist = true } = {}) {
  const rootReal = await realpath(root)
  const target = path.resolve(rootReal, normalizeRelative(relative) || '.')
  if (!isInside(rootReal, target)) throw outside()
  if (mustExist) {
    let real
    try { real = await realpath(target) } catch { throw new FolderError('找不到这个文件或文件夹') }
    if (!isInside(rootReal, real)) throw outside()
    return real
  }
  for (let parent = path.dirname(target); ; parent = path.dirname(parent)) {
    let real = null
    try { real = await realpath(parent) } catch { /* 还不存在，继续往上找 */ }
    if (real !== null) {
      if (!isInside(rootReal, real)) throw outside()
      return target
    }
    if (path.dirname(parent) === parent) throw new FolderError('路径格式不对')
  }
}

export async function listFolder(root, relative = '') {
  const dir = await resolveInside(root, relative)
  if (!(await stat(dir)).isDirectory()) throw new FolderError('这不是文件夹')
  const dirents = (await readdir(dir, { withFileTypes: true })).filter((entry) => entry.isFile() || entry.isDirectory())
  const entries = await Promise.all(dirents.slice(0, MAX_LISTED).map(async (entry) => {
    if (entry.isDirectory()) return { name: entry.name, type: 'folder' }
    const info = await stat(path.join(dir, entry.name)).catch(() => null)
    return { name: entry.name, type: 'file', ...(info ? { size: info.size, modifiedAt: info.mtime.toISOString() } : {}) }
  }))
  return { entries, truncated: dirents.length > MAX_LISTED }
}

export async function readText(root, relative, offset = 0) {
  if (!normalizeRelative(relative)) throw new FolderError('要读哪个文件？')
  const file = await resolveInside(root, relative)
  const info = await stat(file)
  if (!info.isFile()) throw new FolderError('这不是文件')
  if (info.size > MAX_READ_BYTES) throw new FolderError('文件太大了（超过 2MB），先挑出需要的部分吧')
  const buffer = await readFile(file)
  if (buffer.includes(0)) throw new FolderError('这看起来不是文本文件，没法直接读')
  const text = buffer.toString('utf8')
  const start = Math.min(Math.max(0, Number.isInteger(offset) ? offset : 0), text.length)
  const content = text.slice(start, start + READ_CHUNK_CHARS)
  const next = start + content.length
  return { content, hasMore: next < text.length, nextOffset: next < text.length ? next : null }
}

export async function writeNewText(root, relative, content) {
  if (!normalizeRelative(relative)) throw new FolderError('要新建哪个文件？')
  if (typeof content !== 'string') throw new FolderError('内容需要是文本')
  const bytes = Buffer.byteLength(content)
  if (bytes > MAX_WRITE_BYTES) throw new FolderError('内容太长了（超过 1MB）')
  const target = await resolveInside(root, relative, { mustExist: false })
  await mkdir(path.dirname(target), { recursive: true })
  // 建完父目录再核对一次真实位置，防止中途被换成指向外面的链接
  await resolveInside(root, path.relative(await realpath(root), path.dirname(target)))
  try {
    await writeFile(target, content, { flag: 'wx' })
  } catch (error) {
    if (error.code === 'EEXIST') throw new FolderError('同名文件已存在，没有覆盖')
    throw error
  }
  return { bytes }
}

/** 执行服务端派来的一个任务，返回要交回的 { ok, result | error }。只有 FolderError 的原因会原样交回。 */
export async function handleJob(root, job) {
  try {
    const args = job?.args ?? {}
    if (job?.tool === 'list') return { ok: true, result: await listFolder(root, args.path) }
    if (job?.tool === 'read') return { ok: true, result: await readText(root, args.path, args.offset) }
    if (job?.tool === 'write') return { ok: true, result: await writeNewText(root, args.path, args.content) }
    return { ok: false, error: '这个助手版本不支持这项操作' }
  } catch (error) {
    return { ok: false, error: error instanceof FolderError ? error.message : '电脑上出了点问题，没有完成' }
  }
}
