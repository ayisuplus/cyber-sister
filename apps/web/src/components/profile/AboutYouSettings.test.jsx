import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../services/userService', () => ({
  profileService: { get: vi.fn(), update: vi.fn() },
}))
const updateProfile = vi.fn()
vi.mock('../../stores/authStore', () => ({
  useAuthStore: { getState: () => ({ updateProfile }) },
}))

import { profileService } from '../../services/userService'
import AboutYouSettings from './AboutYouSettings'

beforeEach(() => {
  vi.clearAllMocks()
  profileService.get.mockResolvedValue({ nickname: '内测', birthDate: '1999-09-21T00:00:00.000Z' })
  profileService.update.mockImplementation((payload) => Promise.resolve(payload))
})

describe('关于你', () => {
  it('带出现在的称呼和生日', async () => {
    render(<AboutYouSettings />)

    expect(await screen.findByDisplayValue('内测')).toBeInTheDocument()
    expect(screen.getByLabelText('生日')).toHaveValue('1999-09-21')
  })

  it('改了称呼和生日就按原样存，并同步到页面上', async () => {
    const user = userEvent.setup()
    render(<AboutYouSettings />)
    const name = await screen.findByDisplayValue('内测')

    await user.clear(name)
    await user.type(name, ' 小鱼 ')
    await user.clear(screen.getByLabelText('生日'))
    await user.type(screen.getByLabelText('生日'), '2000-05-03')
    await user.click(screen.getByRole('button', { name: '保存' }))

    expect(profileService.update).toHaveBeenCalledWith({ nickname: '小鱼', birthDate: '2000-05-03' })
    expect(updateProfile).toHaveBeenCalledWith({ nickname: '小鱼' })
    expect(await screen.findByText('记下了')).toBeInTheDocument()
  })

  it('清空生日就是不告诉她', async () => {
    const user = userEvent.setup()
    render(<AboutYouSettings />)
    await screen.findByDisplayValue('内测')

    await user.clear(screen.getByLabelText('生日'))
    await user.click(screen.getByRole('button', { name: '保存' }))

    expect(profileService.update).toHaveBeenCalledWith({ nickname: '内测', birthDate: null })
  })

  it('说清楚生日平时不发给模型', async () => {
    render(<AboutYouSettings />)
    expect(await screen.findByText(/生日平时不发给模型/)).toBeInTheDocument()
  })

  it('没存上时如实说，填的还在', async () => {
    const user = userEvent.setup()
    profileService.update.mockRejectedValue(new Error('offline'))
    render(<AboutYouSettings />)
    const name = await screen.findByDisplayValue('内测')

    await user.type(name, '呀')
    await user.click(screen.getByRole('button', { name: '保存' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('没保存上')
    expect(screen.getByDisplayValue('内测呀')).toBeInTheDocument()
  })
})
