import { describe, expect, it, vi } from 'vitest'
import {
  ValidationError,
  validate,
  validateCode,
  validateDate,
  validateEnum,
  validateLength,
  validatePhone,
  validateRequired,
  validateUUID,
} from './validate.js'

describe('validatePhone', () => {
  it('接受合法的 11 位手机号', () => {
    expect(validatePhone('13800138000')).toBeNull()
  })

  it('拒绝空值、非字符串与不符合号段的号码', () => {
    expect(validatePhone('')).toBe('请输入手机号')
    expect(validatePhone(null)).toBe('请输入手机号')
    expect(validatePhone(123)).toBe('请输入手机号')
    expect(validatePhone('12345678901')).toBe('请输入正确的手机号')
    expect(validatePhone('1380013800')).toBe('请输入正确的手机号')
  })
})

describe('validateCode', () => {
  it('接受 6 位数字验证码', () => {
    expect(validateCode('888888')).toBeNull()
  })

  it('拒绝空值、非字符串与非 6 位数字', () => {
    expect(validateCode('')).toBe('请输入验证码')
    expect(validateCode(undefined)).toBe('请输入验证码')
    expect(validateCode(888888)).toBe('请输入验证码')
    expect(validateCode('12345')).toBe('验证码为6位数字')
    expect(validateCode('abcdef')).toBe('验证码为6位数字')
  })
})

describe('validateRequired', () => {
  it('undefined、null 和空字符串都视为缺失', () => {
    expect(validateRequired(undefined, '内容')).toBe('内容不能为空')
    expect(validateRequired(null, '内容')).toBe('内容不能为空')
    expect(validateRequired('', '内容')).toBe('内容不能为空')
  })

  it('0 与 false 是有效值', () => {
    expect(validateRequired(0, '数量')).toBeNull()
    expect(validateRequired(false, '开关')).toBeNull()
  })
})

describe('validateLength', () => {
  it('非字符串直接放行（由其他校验负责类型）', () => {
    expect(validateLength(123, '内容', 1, 10)).toBeNull()
  })

  it('长度越界时分别报告下限与上限', () => {
    expect(validateLength('', '内容', 1, 10)).toBe('内容至少需要1个字符')
    expect(validateLength('x'.repeat(11), '内容', 1, 10)).toBe('内容不能超过10个字符')
    expect(validateLength('ok', '内容', 1, 10)).toBeNull()
  })
})

describe('validateEnum', () => {
  it('枚举外的值报错并列出允许值', () => {
    expect(validateEnum('wild', '人格', ['toxic', 'gentle']))
      .toBe('人格必须是以下值之一: toxic, gentle')
    expect(validateEnum('toxic', '人格', ['toxic', 'gentle'])).toBeNull()
  })
})

describe('validateDate', () => {
  it('空值放行，非法日期报错', () => {
    expect(validateDate('', '开始日期')).toBeNull()
    expect(validateDate('not-a-date', '开始日期')).toBe('开始日期格式不正确')
    expect(validateDate('2026-01-01', '开始日期')).toBeNull()
  })
})

describe('validateUUID', () => {
  it('校验 UUID 格式', () => {
    expect(validateUUID('', '标识')).toBeNull()
    expect(validateUUID('not-uuid', '标识')).toBe('标识格式不正确')
    expect(validateUUID('3f6b2c44-1a2b-4c5d-8e9f-0a1b2c3d4e5f', '标识')).toBeNull()
  })
})

describe('validate 中间件', () => {
  function runMiddleware(validations, req) {
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    }
    const next = vi.fn()
    validate(validations)({ body: {}, params: {}, ...req }, res, next)
    return { res, next }
  }

  it('全部通过时调用 next 且不写响应', () => {
    const { res, next } = runMiddleware(
      [{ field: 'content', validate: (v) => validateRequired(v, '内容') }],
      { body: { content: 'hello' } },
    )
    expect(next).toHaveBeenCalledOnce()
    expect(res.status).not.toHaveBeenCalled()
  })

  it('聚合所有字段错误并以 400 返回', () => {
    const { res, next } = runMiddleware(
      [
        { field: 'content', validate: (v) => validateRequired(v, '内容') },
        { field: 'title', validate: (v) => validateRequired(v, '标题') },
      ],
      { body: {} },
    )
    expect(next).not.toHaveBeenCalled()
    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({
      error: '参数验证失败',
      details: [
        { field: 'content', message: '内容不能为空' },
        { field: 'title', message: '标题不能为空' },
      ],
    })
  })

  it('source 为 params 时从路径参数取值', () => {
    const { next } = runMiddleware(
      [{ field: 'id', source: 'params', validate: (v) => validateRequired(v, '标识') }],
      { params: { id: 'abc' } },
    )
    expect(next).toHaveBeenCalledOnce()
  })
  it('非字符串输入直接 400，不再放行到 service 层', () => {
    const { res, next } = runMiddleware(
      [{ field: 'content', validate: (v) => validateRequired(v, '消息内容') }],
      { body: { content: 12345 } },
    )
    expect(next).not.toHaveBeenCalled()
    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({
      error: '参数验证失败',
      details: [{ field: 'content', message: 'content必须是字符串' }],
    })

    // null/undefined 仍走各字段自身的必填校验
    const { next: nextMissing } = runMiddleware(
      [{ field: 'content', validate: (v) => validateRequired(v, '消息内容') }],
      { body: {} },
    )
    expect(nextMissing).not.toHaveBeenCalled()
  })
})

describe('ValidationError', () => {
  it('携带错误明细', () => {
    const error = new ValidationError([{ field: 'a', message: 'bad' }])
    expect(error.name).toBe('ValidationError')
    expect(error.errors).toEqual([{ field: 'a', message: 'bad' }])
    expect(error).toBeInstanceOf(Error)
  })
})
