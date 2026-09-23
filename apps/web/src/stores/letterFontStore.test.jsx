import { afterEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { startLetterFontSync, useLetterFontStore } from './letterFontStore'
import LetterFontSetting from '../components/profile/LetterFontSetting'

afterEach(() => {
  localStorage.clear()
  delete document.documentElement.dataset.letterFont
})

describe('信纸上的字', () => {
  it('默认手写；存过印刷体就用印刷体；乱写的值当手写', () => {
    startLetterFontSync()
    expect(document.documentElement.dataset.letterFont).toBe('hand')
    localStorage.setItem('amie-letter-font', 'print')
    startLetterFontSync()
    expect(useLetterFontStore.getState().font).toBe('print')
    expect(document.documentElement.dataset.letterFont).toBe('print')
    localStorage.setItem('amie-letter-font', 'comic-sans')
    startLetterFontSync()
    expect(document.documentElement.dataset.letterFont).toBe('hand')
  })

  it('设置里换成印刷体：立刻生效，这台设备记住', async () => {
    const user = userEvent.setup()
    startLetterFontSync()
    render(<LetterFontSetting />)
    expect(screen.getByRole('radio', { name: '信纸上的字：手写' })).toBeChecked()

    await user.click(screen.getByRole('radio', { name: '信纸上的字：印刷' }))
    expect(document.documentElement.dataset.letterFont).toBe('print')
    expect(localStorage.getItem('amie-letter-font')).toBe('print')
  })
})
