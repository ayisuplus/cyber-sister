import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { DayPartDoodle, PAGE_STICKERS, STICKERS, Sticker, WashiTape, pageStickerFor, stickerSrc } from './Decor'
import { dayPhase } from './letterDate'

// jsdom 环境里 import.meta.url 不是 file:// 地址：按 web 包目录找（pnpm 在包目录里跑测试；从仓库根目录跑也兜一下）
const DECOR_DIR = ['public/design-assets/decor', 'apps/web/public/design-assets/decor']
  .map((dir) => path.resolve(dir))
  .find((dir) => existsSync(dir))
const decorFile = (name) => readFileSync(path.join(DECOR_DIR, name))

describe('手帐小装饰', () => {
  it('贴纸是纯装饰：读屏读不到，按长边等比缩放，先占好位置', () => {
    const { container } = render(<Sticker name="daisy" size={46} className="decor-cover-flower" />)
    const image = container.querySelector('img')
    expect(image).toHaveAttribute('alt', '')
    expect(image).toHaveAttribute('aria-hidden', 'true')
    expect(image).toHaveAttribute('src', '/design-assets/decor/daisy.webp')
    expect(image).toHaveClass('decor', 'decor-sticker', 'decor-cover-flower')
    // 雏菊是竖长的：长边 46，宽按 59:96 算
    expect(image).toHaveAttribute('height', '46')
    expect(image).toHaveAttribute('width', '28')
    expect(render(<Sticker name="unicorn" size={30} />).container).toBeEmptyDOMElement()
    expect(stickerSrc('unicorn')).toBeNull()
  })

  it('页码那一行只轮植物，按页码固定，负数也不出错', () => {
    expect(PAGE_STICKERS).not.toContain('stamp')
    expect(PAGE_STICKERS).not.toContain('wax-seal')
    expect(pageStickerFor(0)).toBe(PAGE_STICKERS[0])
    expect(pageStickerFor(PAGE_STICKERS.length + 2)).toBe(PAGE_STICKERS[2])
    expect(pageStickerFor(-1)).toBe(PAGE_STICKERS[PAGE_STICKERS.length - 1])
  })

  it('日期旁的小画：一天分四段，画随时段变，读屏读不到', () => {
    expect(dayPhase('2026-09-23T01:40:00')).toBe('night')
    expect(dayPhase('2026-09-23T06:30:00')).toBe('dawn')
    expect(dayPhase('2026-09-23T12:00:00')).toBe('day')
    expect(dayPhase('2026-09-23T18:10:00')).toBe('dusk')
    expect(dayPhase('2026-09-23T23:30:00')).toBe('night')

    const { container } = render(<DayPartDoodle phase="night" />)
    const svg = container.querySelector('svg')
    expect(svg).toHaveAttribute('aria-hidden', 'true')
    expect(svg).toHaveAttribute('focusable', 'false')
    expect(svg).toHaveAttribute('data-phase', 'night')
    expect(svg).toHaveClass('decor', 'decor-doodle')
    expect(render(<WashiTape />).container.querySelector('span')).toHaveAttribute('aria-hidden', 'true')
  })

  it('清单、来源记录和文件三方一致：宽高、字节数、sha256 对得上，整套不超过 150KB', () => {
    const manifest = JSON.parse(decorFile('decor-assets.json').toString('utf8'))
    expect(manifest.model.license).toContain('非商业')
    const listed = Object.fromEntries(manifest.files.map((entry) => [entry.file, entry]))
    expect(Object.keys(listed).sort()).toEqual(Object.values(STICKERS).map((sticker) => sticker.file).sort())
    let total = 0
    for (const sticker of Object.values(STICKERS)) {
      const entry = listed[sticker.file]
      const bytes = decorFile(sticker.file)
      expect({ width: entry.width, height: entry.height }).toEqual({ width: sticker.width, height: sticker.height })
      expect(bytes.length).toBe(entry.bytes)
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(entry.sha256)
      expect(entry.bytes).toBeLessThanOrEqual(20 * 1024)
      total += entry.bytes
    }
    expect(total).toBeLessThanOrEqual(150 * 1024)
  })
})
