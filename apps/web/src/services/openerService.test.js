import { describe, expect, it, vi } from 'vitest'

vi.mock('./api', () => ({
  default: {
    get: vi.fn(),
  },
}))

import api from './api'
import { openerService } from './openerService'

describe('openerService', () => {
  it('reads the openers from the chat endpoint', async () => {
    api.get.mockResolvedValue({ data: { openers: [{ id: 'note:n1', text: '上次我记下的那句我还想着：有点累', draft: true }] } })

    const openers = await openerService.listOpeners()

    expect(api.get).toHaveBeenCalledWith('/chat/openers')
    expect(openers).toEqual([{ id: 'note:n1', text: '上次我记下的那句我还想着：有点累', draft: true }])
  })

  it('没拿到一个数组就当作没有候选：调用方留着本机静态池', async () => {
    api.get.mockResolvedValue({ data: {} })

    await expect(openerService.listOpeners()).resolves.toEqual([])
  })
})
