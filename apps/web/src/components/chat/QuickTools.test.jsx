import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import QuickTools from './QuickTools'

const renderWithRouter = () => render(
  <MemoryRouter initialEntries={['/chat']}>
    <Routes>
      <Route path="/chat" element={<QuickTools />} />
      <Route path="/tools" element={<h1>工具页</h1>} />
      <Route path="/tools/period" element={<h1>经期页</h1>} />
      <Route path="/tools/todo" element={<h1>待办页</h1>} />
    </Routes>
  </MemoryRouter>,
)

describe('QuickTools', () => {
  it('offers the four quick entries', () => {
    renderWithRouter()

    for (const label of ['天气', '提醒', '大姨妈', '待办']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument()
    }
  })

  it.each([
    ['天气', '工具页'],
    ['大姨妈', '经期页'],
    ['待办', '待办页'],
  ])('navigates %s to its tool page', async (label, heading) => {
    const user = userEvent.setup()
    renderWithRouter()

    await user.click(screen.getByRole('button', { name: label }))

    expect(screen.getByRole('heading', { name: heading })).toBeInTheDocument()
  })
})
