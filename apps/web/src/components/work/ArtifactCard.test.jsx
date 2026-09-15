import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import api from '../../services/api'
import ArtifactCard from './ArtifactCard'
vi.mock('../../services/api', () => ({ default: { get: vi.fn() } }))
const artifact = { id: 'a1', title: '任务报告', format: 'md', sizeBytes: 1200 }
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('交付文件下载', () => {
  it('previews images through the authenticated artifact endpoint and releases the URL on unmount', async () => {
    api.get.mockResolvedValue({ data: new Blob(['png'], { type: 'image/png' }) })
    URL.createObjectURL = vi.fn(() => 'blob:preview'); URL.revokeObjectURL = vi.fn()
    const { unmount } = render(<ArtifactCard artifact={{ ...artifact, format: 'png' }} />)
    expect(await screen.findByRole('img', { name: artifact.title })).toHaveAttribute('src', 'blob:preview')
    expect(api.get).toHaveBeenCalledWith('/work/artifacts/a1/download', { responseType: 'blob' })
    unmount()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview')
  })
  it('does not create a preview URL when a late download finishes after unmount', async () => {
    let resolve
    api.get.mockReturnValue(new Promise(done => { resolve = done }))
    URL.createObjectURL = vi.fn(); URL.revokeObjectURL = vi.fn()
    const { unmount } = render(<ArtifactCard artifact={{ ...artifact, format: 'png' }} />)
    unmount(); resolve({ data: new Blob(['png']) })
    await Promise.resolve()
    expect(URL.createObjectURL).not.toHaveBeenCalled()
  })
  it('通过认证 API 取得 Blob，下载真实内容', async () => {
    const data = new Blob(['# 报告'])
    api.get.mockResolvedValue({ data })
    URL.createObjectURL = vi.fn(() => 'blob:download')
    URL.revokeObjectURL = vi.fn()
    const clicked = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    render(<ArtifactCard artifact={artifact} />)
    fireEvent.click(screen.getByRole('button', { name: /下载文件/ }))
    await waitFor(() => expect(clicked).toHaveBeenCalledOnce())
    expect(api.get).toHaveBeenCalledWith('/work/artifacts/a1/download', { responseType: 'blob' })
    expect(URL.createObjectURL).toHaveBeenCalledWith(data)
    expect(clicked.mock.instances[0].download).toBe('任务报告.md')
  })
  it('下载失败呈现可重试错误，不伪造下载成功', async () => {
    api.get.mockRejectedValue(new Error('not found'))
    render(<ArtifactCard artifact={artifact} />)
    fireEvent.click(screen.getByRole('button', { name: /下载文件/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent('下载失败')
    expect(screen.getByRole('button', { name: /下载文件/ })).not.toBeDisabled()
  })
})
