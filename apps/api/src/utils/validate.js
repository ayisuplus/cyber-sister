/**
 * 输入验证工具
 * 使用简单的验证函数，无需额外依赖
 */

export class ValidationError extends Error {
  constructor(errors) {
    super('Validation failed')
    this.name = 'ValidationError'
    this.errors = errors
  }
}

// 验证手机号
export function validatePhone(phone) {
  if (!phone || typeof phone !== 'string') {
    return '请输入手机号'
  }
  if (!/^1[3-9]\d{9}$/.test(phone)) {
    return '请输入正确的手机号'
  }
  return null
}

// 验证验证码
export function validateCode(code) {
  if (!code || typeof code !== 'string') {
    return '请输入验证码'
  }
  if (!/^\d{6}$/.test(code)) {
    return '验证码为6位数字'
  }
  return null
}

// 验证必填字段
export function validateRequired(value, fieldName) {
  if (value === undefined || value === null || value === '') {
    return `${fieldName}不能为空`
  }
  return null
}

// 验证字符串长度
export function validateLength(value, fieldName, min = 0, max = Infinity) {
  if (typeof value !== 'string') return null
  if (value.length < min) {
    return `${fieldName}至少需要${min}个字符`
  }
  if (value.length > max) {
    return `${fieldName}不能超过${max}个字符`
  }
  return null
}

// 验证枚举值
export function validateEnum(value, fieldName, allowedValues) {
  if (!allowedValues.includes(value)) {
    return `${fieldName}必须是以下值之一: ${allowedValues.join(', ')}`
  }
  return null
}

// 验证日期
export function validateDate(value, fieldName) {
  if (!value) return null
  const date = new Date(value)
  if (isNaN(date.getTime())) {
    return `${fieldName}格式不正确`
  }
  return null
}

// 验证UUID
export function validateUUID(value, fieldName) {
  if (!value) return null
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    return `${fieldName}格式不正确`
  }
  return null
}

// 验证中间件
export function validate(validations) {
  return (req, res, next) => {
    const errors = []

    for (const { field, validate: validateFn, source = 'body' } of validations) {
      const value = source === 'params' ? req.params[field] : req.body[field]
      const error = validateFn(value)
      if (error) {
        errors.push({ field, message: error })
      }
    }

    if (errors.length > 0) {
      return res.status(400).json({
        error: '参数验证失败',
        details: errors,
      })
    }

    next()
  }
}

export default {
  validatePhone,
  validateCode,
  validateRequired,
  validateLength,
  validateEnum,
  validateDate,
  validateUUID,
  validate,
  ValidationError,
}
