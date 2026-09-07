/**
 * 确定性计算与单位换算服务（工作模式 calc_convert 工具的执行体）。
 * 无第三方依赖：手写 tokenizer + shunting-yard，只支持 + - * / % ^ ( ) 与数字；
 * 单位换算覆盖长度/重量（线性表，基准单位互转）与温度（公式互转）。
 * 所有失败统一抛 HttpError 400，由 agentService 错误映射转为模型可读的失败反馈。
 */
import { HttpError } from '../utils/dbHelpers.js'

const invalidExpression = () => new HttpError('算式无效', 400)
const invalidConversion = () => new HttpError('不支持该单位换算', 400)

const OPERATORS = {
  '+': { precedence: 1, apply: (a, b) => a + b },
  '-': { precedence: 1, apply: (a, b) => a - b },
  '*': { precedence: 2, apply: (a, b) => a * b },
  '/': {
    precedence: 2,
    apply: (a, b) => {
      if (b === 0) throw invalidExpression()
      return a / b
    },
  },
  '%': {
    precedence: 2,
    apply: (a, b) => {
      if (b === 0) throw invalidExpression()
      return a % b
    },
  },
  '^': { precedence: 4, rightAssociative: true, apply: (a, b) => a ** b },
  // 一元负号：优先级低于 ^（-2^2 = -4），高于乘除
  'u-': { precedence: 3, unary: true, apply: (a) => -a },
}

function tokenize(expression) {
  const tokens = []
  let index = 0
  while (index < expression.length) {
    const char = expression[index]
    if (char === ' ' || char === '\t') {
      index += 1
      continue
    }
    if (/[0-9.]/.test(char)) {
      let end = index
      let dots = 0
      while (end < expression.length && /[0-9.]/.test(expression[end])) {
        if (expression[end] === '.') dots += 1
        end += 1
      }
      const value = Number(expression.slice(index, end))
      if (dots > 1 || !Number.isFinite(value)) throw invalidExpression()
      tokens.push({ type: 'number', value })
      index = end
      continue
    }
    if (Object.hasOwn(OPERATORS, char)) {
      tokens.push({ type: 'operator', value: char })
      index += 1
      continue
    }
    if (char === '(') {
      tokens.push({ type: 'lparen' })
      index += 1
      continue
    }
    if (char === ')') {
      tokens.push({ type: 'rparen' })
      index += 1
      continue
    }
    throw invalidExpression()
  }
  return tokens
}

/** 结合上下文折叠一元正负号：位于开头、运算符或左括号之后的 +/- 为一元。 */
function markUnaryOperators(tokens) {
  const marked = []
  for (const token of tokens) {
    if (token.type === 'operator' && (token.value === '-' || token.value === '+')) {
      const previous = marked.at(-1)
      const unary = !previous || previous.type === 'operator' || previous.type === 'lparen'
      if (unary) {
        if (token.value === '-') marked.push({ type: 'operator', value: 'u-' })
        continue // 一元加号直接丢弃
      }
    }
    marked.push(token)
  }
  return marked
}

/** shunting-yard 转逆波兰式后求值；括号不配平/余下非二元结构一律判无效。 */
export function evaluateExpression(expression) {
  if (typeof expression !== 'string' || !expression.trim()) throw invalidExpression()
  const tokens = markUnaryOperators(tokenize(expression))
  const output = []
  const stack = []
  for (const token of tokens) {
    if (token.type === 'number') {
      output.push(token)
    } else if (token.type === 'operator') {
      const current = OPERATORS[token.value]
      for (;;) {
        const top = stack.at(-1)
        if (!top || top.type !== 'operator') break
        const topOp = OPERATORS[top.value]
        const shouldPop = current.rightAssociative
          ? topOp.precedence > current.precedence
          : topOp.precedence >= current.precedence
        if (!shouldPop) break
        output.push(stack.pop())
      }
      stack.push(token)
    } else if (token.type === 'lparen') {
      stack.push(token)
    } else {
      for (;;) {
        const top = stack.at(-1)
        if (!top) throw invalidExpression()
        if (top.type === 'lparen') break
        output.push(stack.pop())
      }
      stack.pop() // 丢弃左括号
    }
  }
  while (stack.length > 0) {
    const top = stack.pop()
    if (top.type !== 'operator') throw invalidExpression()
    output.push(top)
  }

  const values = []
  for (const token of output) {
    if (token.type === 'number') {
      values.push(token.value)
      continue
    }
    const operator = OPERATORS[token.value]
    if (operator.unary) {
      if (values.length < 1) throw invalidExpression()
      values.push(operator.apply(values.pop()))
      continue
    }
    if (values.length < 2) throw invalidExpression()
    const right = values.pop()
    const left = values.pop()
    values.push(operator.apply(left, right))
  }
  if (values.length !== 1 || !Number.isFinite(values[0])) throw invalidExpression()
  // 抹平浮点尾差（0.1+0.2），结果仍按原语义比较
  return Number(values[0].toPrecision(12))
}

// 线性单位表：value * factors[from] / factors[to]（基准分别为 m 与 kg，1 斤 = 0.5kg）
const LINEAR_UNIT_TABLES = [
  { units: { m: 1, km: 1000, cm: 0.01, mm: 0.001, in: 0.0254, ft: 0.3048 } },
  { units: { kg: 1, g: 0.001, lb: 0.45359237, jin: 0.5 } },
]

const TEMPERATURE_UNITS = new Set(['c', 'f', 'k'])

const temperatureToCelsius = {
  c: (value) => value,
  f: (value) => (value - 32) / 1.8,
  k: (value) => value - 273.15,
}

const celsiusToTemperature = {
  c: (value) => value,
  f: (value) => value * 1.8 + 32,
  k: (value) => value + 273.15,
}

export function convertUnit(value, from, to) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) throw invalidConversion()
  const source = String(from ?? '').trim().toLowerCase()
  const target = String(to ?? '').trim().toLowerCase()
  if (!source || !target) throw invalidConversion()

  if (TEMPERATURE_UNITS.has(source) || TEMPERATURE_UNITS.has(target)) {
    if (!TEMPERATURE_UNITS.has(source) || !TEMPERATURE_UNITS.has(target)) throw invalidConversion()
    const result = celsiusToTemperature[target](temperatureToCelsius[source](numeric))
    return Number(result.toPrecision(12))
  }

  for (const table of LINEAR_UNIT_TABLES) {
    const sourceFactor = table.units[source]
    const targetFactor = table.units[target]
    if (sourceFactor !== undefined || targetFactor !== undefined) {
      if (sourceFactor === undefined || targetFactor === undefined) throw invalidConversion()
      return Number(((numeric * sourceFactor) / targetFactor).toPrecision(12))
    }
  }
  throw invalidConversion()
}
