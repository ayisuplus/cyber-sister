import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../../services/letterService', () => ({ letterService: { read: vi.fn(() => Promise.resolve()), decide: vi.fn() } }))

import LetterView from './LetterView'

describe('看信', () => {
  it('像一封寄来的信：信头一张邮票、信尾一枚火漆印，都是装饰，读屏只读信的内容', () => {
    render(<MemoryRouter><LetterView letter={{ id: 'l1', content: '见信好。\n\n这周你辛苦了。' }} /></MemoryRouter>)
    const letter = screen.getByRole('article', { name: '她的来信' })
    const [stamp, seal] = letter.querySelectorAll('img.decor')
    expect(stamp).toHaveAttribute('src', '/design-assets/decor/stamp.webp')
    expect(stamp).toHaveClass('decor-stamp')
    expect(seal).toHaveAttribute('src', '/design-assets/decor/wax-seal.webp')
    expect(seal).toHaveClass('decor-seal-end')
    for (const image of [stamp, seal]) expect(image).toHaveAttribute('alt', '')
    expect(screen.getByText('见信好。')).toBeInTheDocument()
  })
})
