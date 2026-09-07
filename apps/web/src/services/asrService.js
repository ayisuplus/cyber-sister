import api from './api'

// 语音转文字走本机 FunASR sidecar：音频以 multipart 只发送到本机 API（同机转发），
// 不经过任何外部服务。
export const asrService = {
  getAsrStatus: async () => {
    const response = await api.get('/asr/status')
    return response.data
  },

  /** @param {Blob} wavBlob 16kHz 单声道 WAV（voiceWav.webmToWav16kMono 产出） */
  transcribeAudio: async (wavBlob) => {
    const formData = new FormData()
    formData.append('file', wavBlob, 'voice.wav')
    const response = await api.postForm('/asr/transcribe', formData)
    return response.data
  },
}
