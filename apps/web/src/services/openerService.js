import api from './api'

// 开场话题：她自己的线索（她惦记的事 / 你在读的书 / 你最近的手记）。
// 只读、不发模型；调用方先摆本机静态池，取到了再替换，取不到就安静地留着。
export const openerService = {
  listOpeners: async () => {
    const { openers } = (await api.get('/chat/openers')).data
    return Array.isArray(openers) ? openers : []
  },
}
