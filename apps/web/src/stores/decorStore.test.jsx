import { afterEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { startDecorSync, useDecorStore } from './decorStore'
import DecorSetting from '../components/profile/DecorSetting'

afterEach(() => {
  localStorage.clear()
  delete document.documentElement.dataset.decor
})

describe('小装饰', () => {
  it('默认有；存过「没有」就不显示；乱写的值当「有」', () => {
    startDecorSync()
    expect(document.documentElement.dataset.decor).toBe('on')
    localStorage.setItem('amie-decor', 'off')
    startDecorSync()
    expect(useDecorStore.getState().decor).toBe('off')
    expect(document.documentElement.dataset.decor).toBe('off')
    localStorage.setItem('amie-decor', 'lots')
    startDecorSync()
    expect(document.documentElement.dataset.decor).toBe('on')
  })

  it('设置里关掉：立刻生效，这台设备记住；样例图不跟着消失', async () => {
    const user = userEvent.setup()
    startDecorSync()
    const { container } = render(<DecorSetting />)
    expect(screen.getByRole('radio', { name: '小装饰：有' })).toBeChecked()

    await user.click(screen.getByRole('radio', { name: '小装饰：没有' }))
    expect(document.documentElement.dataset.decor).toBe('off')
    expect(localStorage.getItem('amie-decor')).toBe('off')
    // 样例图不带 .decor：关掉之后也看得到「有」是什么样子
    expect(container.querySelector('img')).not.toHaveClass('decor')
  })
})
