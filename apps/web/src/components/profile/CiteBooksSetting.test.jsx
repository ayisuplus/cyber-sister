import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../services/userService', () => ({ profileService: { get: vi.fn(), update: vi.fn() } }))

import { profileService } from '../../services/userService'
import CiteBooksSetting from './CiteBooksSetting'

beforeEach(() => {
  vi.clearAllMocks()
  profileService.get.mockResolvedValue({ citeBooks: false })
  profileService.update.mockImplementation((payload) => Promise.resolve(payload))
})

describe('设置里的「回答里提到书」', () => {
  it('默认不提；选「提一句」存到账户上', async () => {
    const user = userEvent.setup()
    render(<CiteBooksSetting />)
    expect(await screen.findByRole('radio', { name: '回答里提到书：不提' })).toBeChecked()

    await user.click(screen.getByRole('radio', { name: '回答里提到书：提一句' }))

    expect(profileService.update).toHaveBeenCalledWith({ citeBooks: true })
    expect(screen.getByRole('radio', { name: '回答里提到书：提一句' })).toBeChecked()
    expect(screen.getByText(/跟着账户走，换设备也一样/)).toBeInTheDocument()
  })

  it('没保存上就退回原来的选择并说一声', async () => {
    const user = userEvent.setup()
    profileService.update.mockRejectedValue(new Error('offline'))
    render(<CiteBooksSetting />)
    await screen.findByRole('radio', { name: '回答里提到书：不提' })

    await user.click(screen.getByRole('radio', { name: '回答里提到书：提一句' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('没保存上')
    expect(screen.getByRole('radio', { name: '回答里提到书：不提' })).toBeChecked()
  })

  it('读不到设置时两个都不选，也点不了', async () => {
    profileService.get.mockRejectedValue(new Error('offline'))
    render(<CiteBooksSetting />)

    expect(await screen.findByRole('alert')).toHaveTextContent('暂时读不到')
    expect(screen.getByRole('radio', { name: '回答里提到书：提一句' })).toBeDisabled()
    expect(screen.getByRole('radio', { name: '回答里提到书：不提' })).not.toBeChecked()
  })
})
