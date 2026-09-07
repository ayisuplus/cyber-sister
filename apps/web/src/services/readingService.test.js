import { describe, expect, it, vi } from 'vitest'

vi.mock('./api', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}))

import api from './api'
import { readingService } from './readingService'

describe('readingService', () => {
  it('lists books', async () => {
    api.get.mockResolvedValue({ data: [] })

    const result = await readingService.listBooks()

    expect(api.get).toHaveBeenCalledWith('/reading/books')
    expect(result).toEqual([])
  })

  it('adds, updates and deletes a book', async () => {
    api.post.mockResolvedValue({ data: { id: 'b1' } })
    api.put.mockResolvedValue({ data: { id: 'b1', status: 'finished' } })
    api.delete.mockResolvedValue({ data: { success: true } })

    await readingService.addBook({ title: '活着' })
    expect(api.post).toHaveBeenCalledWith('/reading/books', { title: '活着' })

    await readingService.updateBook('b1', { status: 'finished' })
    expect(api.put).toHaveBeenCalledWith('/reading/books/b1', { status: 'finished' })

    const removed = await readingService.deleteBook('b1')
    expect(api.delete).toHaveBeenCalledWith('/reading/books/b1')
    expect(removed).toEqual({ success: true })
  })

  it('lists and adds notes under a book', async () => {
    api.get.mockResolvedValue({ data: [{ id: 'n1' }] })
    api.post.mockResolvedValue({ data: { note: { id: 'n1' }, book: { id: 'b1' } } })

    const notes = await readingService.listNotes('b1')
    expect(api.get).toHaveBeenCalledWith('/reading/books/b1/notes')
    expect(notes).toHaveLength(1)

    const result = await readingService.addNote('b1', { content: '感想', page: 30 })
    expect(api.post).toHaveBeenCalledWith('/reading/books/b1/notes', { content: '感想', page: 30 })
    expect(result.note.id).toBe('n1')
  })

  it('deletes a note and requests its comment, propagating failures', async () => {
    api.delete.mockResolvedValue({ data: { success: true } })
    await readingService.deleteNote('n1')
    expect(api.delete).toHaveBeenCalledWith('/reading/notes/n1')

    api.post.mockResolvedValue({ data: { aiComment: '我在', source: 'local_model', reused: false } })
    const comment = await readingService.requestNoteComment('n1')
    expect(api.post).toHaveBeenCalledWith('/reading/notes/n1/comment')
    expect(comment.aiComment).toBe('我在')

    api.post.mockRejectedValue(new Error('offline'))
    await expect(readingService.requestNoteComment('n1')).rejects.toThrow('offline')
  })
})
