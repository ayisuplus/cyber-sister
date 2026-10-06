import api from './api'

// 宠物：每天领一份零食、喂它长成长值、摸它长好感度；数值只涨不掉，都以服务端为准
export const petService = {
  list: async () => (await api.get('/pets')).data,
  claimDaily: async () => (await api.post('/pets/daily')).data,
  adopt: async (species, name) => (await api.post('/pets', { species, name })).data,
  setActive: async (species) => (await api.put('/pets/active', { species })).data,
  rename: async (species, name) => (await api.put(`/pets/${species}`, { name })).data,
  feed: async (species) => (await api.post(`/pets/${species}/feed`)).data,
  pet: async (species) => (await api.post(`/pets/${species}/pet`)).data,
}
