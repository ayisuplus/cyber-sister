// 输入校验中间件 — 极简版 "类型守卫" 校验器.
//
// 拒绝以下输入:
// - 非 JSON 语法错 (Express 4xx handler 已经覆盖)
// - body 不是对象 / 缺必填字段
// - 字段值类型不对 (number 必须是 finite number,string 必须非空等)
// - 字段值不匹配 pattern (新): 防止注入
// - 未知字段 (strict 模式): 防止 mass assignment 攻击
//
// 每个路由自己写 schema,失败返回 400 + 字段级错误信息.

import type { NextFunction, Request, Response } from 'express';

export interface FieldRule {
  type: 'string' | 'number' | 'integer' | 'boolean' | 'object' | 'enum';
  required?: boolean;
  /** 字符串: 最小长度 (默认 1). 数组/对象: 至少 1 个 key. */
  min?: number;
  /** 字符串: 最大长度. 数字: 最大值. */
  max?: number;
  /** enum 时必须给出. */
  values?: ReadonlyArray<string>;
  /** number 时可选,大于等于 min. */
  ge?: number;
  le?: number;
  /** 字符串正则约束, 防止注入. */
  pattern?: RegExp;
}

export type Schema = Record<string, FieldRule>;

export interface ValidateBodyOptions {
  /**
   * 是否拒绝 schema 之外的字段.
   * - true (默认): 防止 mass assignment 攻击 (攻击者尝试 POST { isAdmin: true } 等)
   * - false: 宽松模式, 允许额外字段
   */
  strict?: boolean;
}

interface FieldError {
  field: string;
  message: string;
}

function checkField(field: string, rule: FieldRule, raw: unknown): FieldError | null {
  const present = raw !== undefined && raw !== null;
  if (!present) {
    if (rule.required) return { field, message: '字段必填' };
    return null;
  }
  switch (rule.type) {
    case 'string': {
      if (typeof raw !== 'string') return { field, message: '必须是字符串' };
      if (rule.min !== undefined && raw.length < rule.min) {
        return { field, message: `长度需 >= ${rule.min}` };
      }
      if (rule.max !== undefined && raw.length > rule.max) {
        return { field, message: `长度需 <= ${rule.max}` };
      }
      if (rule.pattern && !rule.pattern.test(raw)) {
        return { field, message: '格式不合法' };
      }
      return null;
    }
    case 'number': {
      if (typeof raw !== 'number' || !Number.isFinite(raw)) {
        return { field, message: '必须是有限数字' };
      }
      if (rule.min !== undefined && raw < rule.min) {
        return { field, message: `应 >= ${rule.min}` };
      }
      if (rule.max !== undefined && raw > rule.max) {
        return { field, message: `应 <= ${rule.max}` };
      }
      if (rule.ge !== undefined && raw < rule.ge) {
        return { field, message: `应 >= ${rule.ge}` };
      }
      if (rule.le !== undefined && raw > rule.le) {
        return { field, message: `应 <= ${rule.le}` };
      }
      return null;
    }
    case 'integer': {
      if (typeof raw !== 'number' || !Number.isInteger(raw)) {
        return { field, message: '必须是整数' };
      }
      if (rule.min !== undefined && raw < rule.min) {
        return { field, message: `应 >= ${rule.min}` };
      }
      if (rule.max !== undefined && raw > rule.max) {
        return { field, message: `应 <= ${rule.max}` };
      }
      if (rule.ge !== undefined && raw < rule.ge) {
        return { field, message: `应 >= ${rule.ge}` };
      }
      if (rule.le !== undefined && raw > rule.le) {
        return { field, message: `应 <= ${rule.le}` };
      }
      return null;
    }
    case 'boolean': {
      if (typeof raw !== 'boolean') return { field, message: '必须是布尔' };
      return null;
    }
    case 'object': {
      if (typeof raw !== 'object' || Array.isArray(raw) || raw === null) {
        return { field, message: '必须是对象' };
      }
      return null;
    }
    case 'enum': {
      if (typeof raw !== 'string') return { field, message: '必须是字符串' };
      if (!rule.values?.includes(raw)) {
        return { field, message: `取值应为 ${rule.values?.join('/')}` };
      }
      return null;
    }
  }
}

export function validateBody(schema: Schema, opts: ValidateBodyOptions = {}) {
  const strict = opts.strict ?? true;
  return (req: Request, res: Response, next: NextFunction): void => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      res.status(400).json({ error: '请求体必须是对象' });
      return;
    }
    const errors: FieldError[] = [];

    // 严格模式: 拒绝未知字段 (防 mass assignment)
    if (strict) {
      const known = new Set(Object.keys(schema));
      for (const key of Object.keys(body)) {
        if (!known.has(key)) {
          errors.push({ field: key, message: '字段不在白名单中' });
        }
      }
    }

    for (const [field, rule] of Object.entries(schema)) {
      const err = checkField(field, rule, body[field]);
      if (err) errors.push(err);
    }
    if (errors.length > 0) {
      res.status(400).json({ error: '字段校验失败', details: errors });
      return;
    }
    next();
  };
}
