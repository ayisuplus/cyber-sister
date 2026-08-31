import { describe, expect, it } from 'vitest'
import { BEAUTY_PRESETS, DEFAULT_BEAUTY_PRESET_ID, getBeautyPreset } from './presets'

const SETTING_KEYS = ['smooth', 'whiten', 'slim', 'eye']

describe('BEAUTY_PRESETS', () => {
  it('包含 off 原图预设与三个风格预设，id 唯一', () => {
    const ids = BEAUTY_PRESETS.map(p => p.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toContain('off')
    expect(ids.length).toBeGreaterThanOrEqual(4)
  })

  it('off 预设四项强度全为 0', () => {
    const off = BEAUTY_PRESETS.find(p => p.id === 'off')
    expect(off.name).toBe('原图')
    expect(off.settings).toEqual({ smooth: 0, whiten: 0, slim: 0, eye: 0 })
  })

  it('每个预设的 settings 都是 0-100 的整数，且有中文名', () => {
    for (const preset of BEAUTY_PRESETS) {
      expect(preset.name).toMatch(/\S/)
      for (const key of SETTING_KEYS) {
        const value = preset.settings[key]
        expect(Number.isInteger(value)).toBe(true)
        expect(value).toBeGreaterThanOrEqual(0)
        expect(value).toBeLessThanOrEqual(100)
      }
    }
  })

  it('默认预设是"自然"，且不是全 0', () => {
    const preset = getBeautyPreset(DEFAULT_BEAUTY_PRESET_ID)
    expect(preset.name).toBe('自然')
    expect(SETTING_KEYS.some(key => preset.settings[key] > 0)).toBe(true)
  })
})

describe('getBeautyPreset', () => {
  it('按 id 取回预设', () => {
    expect(getBeautyPreset('off').id).toBe('off')
  })

  it.each([undefined, null, '', 'no-such-preset'])('未知 id %s 回落到默认预设', (id) => {
    expect(getBeautyPreset(id).id).toBe(DEFAULT_BEAUTY_PRESET_ID)
  })
})
