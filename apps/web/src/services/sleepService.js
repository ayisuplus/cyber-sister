import api from './api'

// 睡眠卡（路线图 C28）：晚安提醒与早安闹钟。get 顺带拿回到点还没收起的便签（早安那张带着那句话）；
// 「起来了」「知道了」走对话便签同一个确认（nudgeService.ack）。
export const sleepService = {
  get: async () => (await api.get('/reminders/sleep')).data,
  save: async (payload) => (await api.put('/reminders/sleep', payload)).data,
}
