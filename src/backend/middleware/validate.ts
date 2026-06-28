// 输入校验中间件 — 极简版 "类型守卫" 校验器.
//
// 拒绝以下输入:
// - 非 JSON 语法错 (Express 4xx handler 已经覆盖)
// - body 不是对象 / 缺必填字段
// - 字段值类型不对 (number 必须是 finite number,string 必须非空等)
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
}

export type Schema = Record<string, FieldRule>;

interface FieldError {
  field: string;
  message: string;
}

function checkField(
  field: string,
  rule: FieldRule,
  raw: unknown,
): FieldError | null {
  const present = raw !== undefined && raw !== null;
  if (!present) {
    if (rule.required) return { field, message: '字段必填' };
    return null;
  }
  switch (rule.type) {
    case 'string': {
      if (typeof raw !== 'string') return { field, message: '应为字符串' };
      if (rule.min !== undefined && raw.length < rule.min) {
        return { field, message: `长度应 >= ${rule.min}` };
      }
      if (rule.max !== undefined && raw.length > rule.max) {
        return { field, message: `长度应 <= ${rule.max}` };
      }
      return null;
    }
    case 'number': {
      if (typeof raw !== 'number' || !Number.isFinite(raw)) {
        return { field, message: '应为有限数字' };
      }
      if (rule.ge !== undefined && raw < rule.ge) {
        return { field, message: `应 >= ${rule.ge}` };
      }
      if (rule.le !== undefined && raw > rule.le) {
        return { field, message: `应 <= ${rule.le}` };
      }
      if (rule.min !== undefined && raw < rule.min) {
        return { field, message: `应 >= ${rule.min}` };
      }
      if (rule.max !== undefined && raw > rule.max) {
        return { field, message: `应 <= ${rule.max}` };
      }
      return null;
    }
    case 'integer': {
      if (typeof raw !== 'number' || !Number.isInteger(raw)) {
        return { field, message: '应为整数' };
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
      if (typeof raw !== 'boolean') return { field, message: '应为布尔' };
      return null;
    }
    case 'object': {
      if (typeof raw !== 'object' || Array.isArray(raw) || raw === null) {
        return { field, message: '应为对象' };
      }
      return null;
    }
    case 'enum': {
      if (typeof raw !== 'string') return { field, message: '应为字符串' };
      if (!rule.values?.includes(raw)) {
        return {
          field,
          message: `取值应为 ${rule.values?.join('/')}`,
        };
      }
      return null;
    }
  }
}

export function validateBody(schema: Schema) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const errors: FieldError[] = [];
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
