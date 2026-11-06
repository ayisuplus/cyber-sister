import { describe, it, expect, vi } from 'vitest'
const files = vi.hoisted(() => new Map())
const sharing = vi.hoisted(() => ({ fail: false, path: '' }))
vi.mock('./native', () => ({ isIOSApp: () => true }))
vi.mock('@capacitor/filesystem', () => ({ Directory: { Cache: 'CACHE' }, Encoding: { UTF8: 'utf8' }, Filesystem: {
  writeFile: async ({ path, data }) => { files.set(path, data); return { uri: `file:///cache/${path}` } },
  deleteFile: async ({ path }) => { files.delete(path) },
} }))
vi.mock('@capacitor/share', () => ({ Share: { share: async ({ files: urls }) => {
  sharing.path = urls[0]
  expect([...files.values()]).toEqual(['{"hello":"你好"}'])
  if (sharing.fail) throw new Error('cancelled')
} } }))
import { shareExport } from './files'

describe('native export', () => {
  it('shares an actual UTF-8 file and removes the private temporary file after sharing', async () => {
    sharing.fail = false
    await shareExport(new Blob(['{"hello":"你好"}']), '../../export.json')
    expect(sharing.path).toMatch(/^file:\/\/\/cache\/amie-export-.*\.json$/)
    expect(files.size).toBe(0)
  })
  it('also removes private data when the share sheet fails or is cancelled', async () => {
    sharing.fail = true
    await expect(shareExport(new Blob(['{"hello":"你好"}']), 'export.json')).rejects.toThrow('cancelled')
    expect(files.size).toBe(0)
  })
})
