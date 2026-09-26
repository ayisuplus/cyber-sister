import { afterEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { startPaletteSync, usePaletteStore } from './paletteStore'
import PaletteSetting from '../components/profile/PaletteSetting'

const injected = () => document.getElementById('amie-palette')

afterEach(() => {
  localStorage.clear()
  injected()?.remove()
  delete document.documentElement.dataset.palette
})

describe('主题色', () => {
  it('默认鼠尾草：什么都不贴，也不存；存过别的颜色，启动时贴上并更新缓存；乱写的当默认', () => {
    startPaletteSync()
    expect(injected()).toBeNull()
    expect(document.documentElement.dataset.palette).toBeUndefined()

    localStorage.setItem('amie-palette', JSON.stringify({ id: 'sakura' }))
    startPaletteSync()
    expect(usePaletteStore.getState().choice).toMatchObject({ id: 'sakura' })
    expect(document.documentElement.dataset.palette).toBe('sakura')
    expect(injected().textContent).toContain(':root[data-palette]{--cs-pastel-blush:')
    // 启动脚本下次贴的就是按现在规则算出来的
    expect(localStorage.getItem('amie-palette-css')).toBe(injected().textContent)

    localStorage.setItem('amie-palette', '{不是 JSON')
    startPaletteSync()
    expect(injected()).toBeNull()
    expect(usePaletteStore.getState().choice.id).toBe('sage')
  })

  it('设置里选樱花粉：立刻整页换色、这台设备记住；换回鼠尾草就撤掉、清掉缓存', async () => {
    const user = userEvent.setup()
    startPaletteSync()
    render(<PaletteSetting />)
    expect(screen.getByRole('radio', { name: '主题色：鼠尾草' })).toBeChecked()

    await user.click(screen.getByRole('radio', { name: '主题色：樱花粉' }))
    expect(document.documentElement.dataset.palette).toBe('sakura')
    expect(JSON.parse(localStorage.getItem('amie-palette'))).toEqual({ id: 'sakura' })
    expect(localStorage.getItem('amie-palette-css')).toContain('[data-theme="dark"]')

    await user.click(screen.getByRole('radio', { name: '主题色：鼠尾草' }))
    expect(injected()).toBeNull()
    expect(document.documentElement.dataset.palette).toBeUndefined()
    expect(localStorage.getItem('amie-palette')).toBeNull()
    expect(localStorage.getItem('amie-palette-css')).toBeNull()
  })

  it('拖「自己调」的滑条就是自己调：记下色相，读屏报「色相 N 度」', () => {
    startPaletteSync()
    render(<PaletteSetting />)
    const slider = screen.getByRole('slider', { name: '自己调：色相' })

    fireEvent.change(slider, { target: { value: '200' } })
    expect(screen.getByRole('radio', { name: '主题色：自己调' })).toBeChecked()
    expect(slider).toHaveAttribute('aria-valuetext', '色相 200 度')
    expect(JSON.parse(localStorage.getItem('amie-palette'))).toEqual({ id: 'custom', hue: 200 })
    expect(document.documentElement.dataset.palette).toBe('custom')
  })
})
