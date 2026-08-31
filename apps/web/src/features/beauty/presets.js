// 美颜预设单一来源：相机页滑杆初始值与预设按钮共用。
// settings 四项均为 0-100 整数：smooth 磨皮 / whiten 美白 / slim 瘦脸 / eye 大眼。
// 100 档对应的安全上限（防止形变伪影，定义在 faceGeometry.js）：
// slim 最多内收脸宽 15%（位移场向面颊平滑衰减）、eye 最多外扩眼半径 35%（环外径向衰减）。

/**
 * @typedef {{ smooth: number, whiten: number, slim: number, eye: number }} BeautySettings
 * @typedef {{ id: string, name: string, settings: BeautySettings }} BeautyPreset
 */

/** @type {BeautyPreset[]} */
export const BEAUTY_PRESETS = [
  {
    id: 'off',
    name: '原图',
    settings: { smooth: 0, whiten: 0, slim: 0, eye: 0 },
  },
  {
    id: 'natural',
    name: '自然',
    settings: { smooth: 25, whiten: 20, slim: 10, eye: 10 },
  },
  {
    id: 'clear',
    name: '清透',
    settings: { smooth: 40, whiten: 45, slim: 15, eye: 15 },
  },
  {
    id: 'defined',
    name: '立体',
    settings: { smooth: 30, whiten: 25, slim: 40, eye: 35 },
  },
]

export const DEFAULT_BEAUTY_PRESET_ID = 'natural'

/**
 * @param {string | null | undefined} id
 * @returns {BeautyPreset}
 */
export const getBeautyPreset = (id) =>
  BEAUTY_PRESETS.find(preset => preset.id === id)
  || BEAUTY_PRESETS.find(preset => preset.id === DEFAULT_BEAUTY_PRESET_ID)
  || BEAUTY_PRESETS[0]
