/**
 * 「经期」操作技能：记录、预测、修正与删除（删除须确认）。
 * 敏感个人信息：读写前都过 periodService 的单独同意门。
 */
import { skillSection } from './skillCatalog.js'
import {
  createPeriodRecord, updatePeriodRecord, deletePeriodRecord, listPeriodRecords, predictNextPeriod, assertPeriodConsent,
} from './periodService.js'
import { toUtcDayString } from '../utils/dayHelpers.js'
import { nativeObject, nativeString } from '../utils/toolSchema.js'

const core = skillSection('period', '核心行为')

export const PERIOD_SKILL = {
  id: 'period',
  title: '经期',
  tools: {
    record_period: {
      description: '{"tool":"record_period","args":{"startDate":"yyyy-MM-dd","endDate":"可选","cycleDays":"可选 20-45"}} 记录一次经期（需要用户已同意记录这类数据）',
      run: async (userId, args) => {
        const record = await createPeriodRecord(userId, { startDate: args.startDate, endDate: args.endDate, cycleDays: args.cycleDays })
        const startDate = toUtcDayString(new Date(record.startDate))
        return { summary: `已记录经期 ${startDate}`, result: { id: record.id, startDate, cycleDays: record.cycleDays } }
      },
    },
    period_status: {
      description: '{"tool":"period_status","args":{}} 经期状态与下次预测（只读）',
      run: async (userId) => {
        // 读出的记录会交给云端模型，同样需要单独同意。
        await assertPeriodConsent(userId)
        const records = await listPeriodRecords(userId)
        const latest = records[0]
        if (!latest) return { summary: '暂无经期记录', result: { records: 0 } }
        const { nextDate, daysUntil, overdueDays } = predictNextPeriod(latest)
        return {
          summary: overdueDays > 0 ? `比预计晚了 ${overdueDays} 天` : `预计 ${daysUntil} 天后下次经期`,
          result: { lastStartDate: toUtcDayString(new Date(latest.startDate)), cycleDays: latest.cycleDays, nextDate, daysUntil, overdueDays },
        }
      },
    },
    update_period_record: {
      description: '{"tool":"update_period_record","args":{"id":"记录 id","startDate":"可选 yyyy-MM-dd","endDate":"可选 yyyy-MM-dd","cycleDays":"可选 20-45"}} 修正一条经期记录的日期或周期',
      run: async (userId, args) => {
        const record = await updatePeriodRecord(userId, String(args.id || ''), {
          startDate: args.startDate, endDate: args.endDate, cycleDays: args.cycleDays,
        })
        return {
          summary: '已改好这条经期记录',
          result: { id: record.id, startDate: toUtcDayString(new Date(record.startDate)), endDate: record.endDate ? toUtcDayString(new Date(record.endDate)) : null, cycleDays: record.cycleDays },
        }
      },
    },
    delete_period_record: {
      needsConfirm: () => '删掉这条经期记录',
      description: '{"tool":"delete_period_record","args":{"id":"记录 id"}} 删除一条经期记录（需要用户确认）',
      run: async (userId, args) => {
        await deletePeriodRecord(userId, String(args.id || ''))
        return { summary: '已删掉这条经期记录', result: { id: String(args.id || '') } }
      },
    },
  },
  toolParameters: {
    record_period: nativeObject({ startDate: nativeString, endDate: nativeString, cycleDays: { type: 'integer', minimum: 20, maximum: 45 } }, ['startDate']),
    period_status: nativeObject({}),
    update_period_record: nativeObject({ id: nativeString, startDate: nativeString, endDate: nativeString, cycleDays: { type: 'integer', minimum: 20, maximum: 45 } }, ['id']),
    delete_period_record: nativeObject({ id: nativeString }, ['id']),
  },
  buildContext(text, _history = [], scene = 'chat') {
    if (scene !== 'chat' || typeof text !== 'string') return []
    if (!/经期|月经|大姨妈|痛经|周期/.test(text)) return []
    return [{ role: 'system', content: `[Amie 内置技能：经期 v1]\n${core}` }]
  },
}
