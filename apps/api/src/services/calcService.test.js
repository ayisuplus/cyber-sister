import { describe, expect, it } from 'vitest'
import { convertUnit, evaluateExpression } from './calcService.js'

describe('calcService.evaluateExpression', () => {
  it('四则运算、乘方与优先级', () => {
    expect(evaluateExpression('(3+5)*2')).toBe(16)
    expect(evaluateExpression('1.5*8')).toBe(12)
    expect(evaluateExpression('10 % 3')).toBe(1)
    expect(evaluateExpression('2+3*4')).toBe(14)
    // 右结合与一元负号低于乘方：-2^2 = -(2^2)
    expect(evaluateExpression('2^3^2')).toBe(512)
    expect(evaluateExpression('-2^2')).toBe(-4)
  })

  it('一元负号与小数边界', () => {
    expect(evaluateExpression('-3 + 5')).toBe(2)
    expect(evaluateExpression('3 * -2')).toBe(-6)
    expect(evaluateExpression('-(3+2)')).toBe(-5)
    expect(evaluateExpression('(-3)*(-2)')).toBe(6)
    // 浮点尾差抹平
    expect(evaluateExpression('0.1+0.2')).toBe(0.3)
  })

  it('嵌套括号', () => {
    expect(evaluateExpression('((1+2)*(3+4))')).toBe(21)
  })

  it('非法输入、除零与非有限结果一律 400 算式无效', () => {
    for (const bad of ['', '   ', 'abc', '1+2;alert(1)', '1+', '()', '(1+2', '1..2', '.', '1/0', '10%0']) {
      expect(() => evaluateExpression(bad), bad).toThrowError(
        expect.objectContaining({ statusCode: 400, message: '算式无效' }),
      )
    }
  })
})

describe('calcService.convertUnit', () => {
  it('长度/重量线性表与温度公式各覆盖一例', () => {
    expect(convertUnit(1, 'km', 'm')).toBe(1000)
    expect(convertUnit(1, 'in', 'cm')).toBe(2.54)
    expect(convertUnit(1, 'jin', 'kg')).toBe(0.5)
    expect(convertUnit(1, 'lb', 'g')).toBe(453.59237)
    expect(convertUnit(100, 'c', 'f')).toBe(212)
    expect(convertUnit(32, 'f', 'k')).toBe(273.15)
    expect(convertUnit(0, 'k', 'c')).toBe(-273.15)
  })

  it('单位大小写不敏感', () => {
    expect(convertUnit(1, 'KG', 'Jin')).toBe(2)
  })

  it('跨类、未知单位与非法数值一律 400 不支持该单位换算', () => {
    for (const [value, from, to] of [
      [1, 'kg', 'm'],
      [1, 'kg', 'xxx'],
      [1, 'c', 'kg'],
      [1, '', 'm'],
      [Number.NaN, 'kg', 'g'],
    ]) {
      expect(() => convertUnit(value, from, to), `${from}→${to}`).toThrowError(
        expect.objectContaining({ statusCode: 400, message: '不支持该单位换算' }),
      )
    }
  })
})
