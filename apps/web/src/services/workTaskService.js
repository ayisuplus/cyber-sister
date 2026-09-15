import api from './api'

export const workTaskService = {
  async status() { return (await api.get('/work/status')).data },
  /** @param {{ signal?: AbortSignal }} [options] */
  async list({ signal } = {}) { return (await api.get('/work/tasks', { signal })).data.tasks },
  async create(conversationId, content, files, requestKey) {
    const body = new FormData()
    body.append('content', content)
    for (const file of files) body.append('files', file, file.name)
    return (await api.post(`/work/conversations/${conversationId}/tasks`, body, {
      headers: { 'Content-Type': undefined, 'Idempotency-Key': requestKey },
    })).data.task
  },
  async cancel(id) { return (await api.post(`/work/tasks/${id}/cancel`)).data.task },
  async retry(id) { return (await api.post(`/work/tasks/${id}/retry`)).data.task },
  async decide(id, actionId, decision) { return (await api.post(`/work/tasks/${id}/actions/${actionId}`, { decision })).data.task },
}
