import api from './api'

// 云端切割（2026-09-07）后模型只有云端一条路径：/api/llm/status 的 mode 恒为
// external_primary，local 段固定 { configured:false, state:'removed' }。
// 本服务只保留状态读取，供同意门与来源徽标判断使用。
export const modelStatusService = {
  getStatus: async () => {
    const response = await api.get('/llm/status')
    return response.data
  },
}
