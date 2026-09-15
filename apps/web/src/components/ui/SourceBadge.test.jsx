import { render, screen } from '@testing-library/react'
import { expect, it } from 'vitest'
import SourceBadge from './SourceBadge'

it('distinguishes mock results from a connected cloud model', () => {
  render(<SourceBadge source="cloud_mock" />)
  expect(screen.getByText('模拟结果 · 未连接云端')).toBeInTheDocument()
  expect(screen.queryByText('云端模型')).not.toBeInTheDocument()
})
