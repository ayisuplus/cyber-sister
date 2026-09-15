import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import WorkAnswer from './WorkAnswer'
import WorkSources from './WorkSources'

describe('工作回答与来源', () => {
  it('渲染标题、列表、表格、代码和可点击的实际网页链接', () => {
    render(<WorkAnswer content={'## 分析结果\n\n- 合计 42\n\n| 项目 | 金额 |\n| --- | --- |\n| A | 42 |\n\n```python\nprint(42)\n```\n\n[Python](https://www.python.org/)'} />)
    expect(screen.getByRole('heading', { name: '分析结果' })).toBeInTheDocument()
    expect(screen.getByRole('table')).toHaveTextContent('A42')
    expect(screen.getByText('print(42)')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Python' })).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('不执行 HTML/脚本，不自动加载外部图片或危险链接', () => {
    const { container } = render(<WorkAnswer content={'<script>alert(1)</script>\n\n<img src="https://tracker.test/a">\n\n[bad](javascript:alert%281%29)\n\n![track](https://tracker.test/image.png)\n\n[private](file:///etc/passwd)'} />)
    expect(container.querySelector('script')).toBeNull()
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('[href^="javascript:"]')).toBeNull()
    expect(container.querySelector('[href^="file:"]')).toBeNull()
    expect(screen.getByRole('link', { name: 'track' })).toHaveAttribute('href', 'https://tracker.test/image.png')
  })

  it('来源只显示工具返回的目录，去重并排除危险协议', () => {
    render(<WorkSources toolRuns={[{ sources: [{ title: '研究原文', url: 'https://example.com/paper' }, { title: 'bad', url: 'javascript:alert(1)' }] }]} progress={[{ sources: [{ title: '研究原文', url: 'https://example.com/paper' }] }]} />)
    expect(screen.getByText('已查阅来源 · 1')).toBeInTheDocument()
    expect(screen.queryByText('bad')).not.toBeInTheDocument()
  })
})
