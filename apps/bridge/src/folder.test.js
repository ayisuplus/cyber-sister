import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { READ_CHUNK_CHARS, handleJob, listFolder, readText, resolveInside, writeNewText } from './folder.js'

let base
let root

before(async () => {
  base = await mkdtemp(path.join(tmpdir(), 'amie-bridge-'))
  root = path.join(base, '授权')
  await mkdir(path.join(root, 'notes'), { recursive: true })
  await writeFile(path.join(root, 'notes', 'a.md'), '今天去看了桂花')
  await writeFile(path.join(base, 'secret.txt'), '文件夹外面的秘密')
})
after(() => rm(base, { recursive: true, force: true }))

describe('授权文件夹边界', () => {
  it('拒绝 ..、绝对路径和盘符', async () => {
    for (const bad of ['../secret.txt', 'notes/../../secret.txt', path.join(base, 'secret.txt'), 'C:/Windows/win.ini', '/etc/passwd']) {
      await assert.rejects(resolveInside(root, bad), (error) => /授权文件夹|相对路径/.test(error.message), bad)
    }
  })

  it('指向文件夹外面的链接也不能读', async (t) => {
    try {
      await symlink(path.join(base, 'secret.txt'), path.join(root, 'link.txt'))
    } catch (error) {
      if (error.code === 'EPERM') return t.skip('本机不允许创建符号链接')
      throw error
    }
    await assert.rejects(readText(root, 'link.txt'), /授权文件夹以外/)
  })

  it('列目录只列文件和文件夹，读文件按两万字分段', async () => {
    const listed = await listFolder(root, '')
    assert.deepEqual(listed.entries.find((entry) => entry.name === 'notes'), { name: 'notes', type: 'folder' })
    assert.equal((await listFolder(root, 'notes')).entries[0].name, 'a.md')
    assert.deepEqual(await readText(root, 'notes/a.md'), { content: '今天去看了桂花', hasMore: false, nextOffset: null })

    await writeFile(path.join(root, 'long.txt'), '字'.repeat(READ_CHUNK_CHARS + 5))
    const first = await readText(root, 'long.txt')
    assert.equal(first.content.length, READ_CHUNK_CHARS)
    assert.equal(first.hasMore, true)
    const rest = await readText(root, 'long.txt', first.nextOffset)
    assert.deepEqual(rest, { content: '字'.repeat(5), hasMore: false, nextOffset: null })
  })

  it('二进制文件不直接读', async () => {
    await writeFile(path.join(root, 'photo.bin'), Buffer.from([0x89, 0x50, 0x00, 0x01]))
    await assert.rejects(readText(root, 'photo.bin'), /不是文本文件/)
  })

  it('只新建文件，同名文件不覆盖；需要时建子文件夹', async () => {
    assert.deepEqual(await writeNewText(root, 'plans/周末.md', '去爬山'), { bytes: Buffer.byteLength('去爬山') })
    assert.equal(await readFile(path.join(root, 'plans', '周末.md'), 'utf8'), '去爬山')
    await assert.rejects(writeNewText(root, 'notes/a.md', '覆盖'), /同名文件已存在/)
    assert.equal(await readFile(path.join(root, 'notes', 'a.md'), 'utf8'), '今天去看了桂花')
    await assert.rejects(writeNewText(root, '../escape.md', 'x'), /授权文件夹以外/)
  })
})

describe('handleJob', () => {
  it('把可说明的失败原因原样交回，未知操作不执行', async () => {
    assert.deepEqual(await handleJob(root, { tool: 'read', args: { path: 'missing.md' } }), { ok: false, error: '找不到这个文件或文件夹' })
    assert.deepEqual(await handleJob(root, { tool: 'delete', args: { path: 'notes/a.md' } }), { ok: false, error: '这个助手版本不支持这项操作' })
    const listed = await handleJob(root, { tool: 'list', args: { path: 'notes' } })
    assert.equal(listed.ok, true)
    assert.equal(listed.result.entries[0].name, 'a.md')
  })
})
