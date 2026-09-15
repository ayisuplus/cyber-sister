import { useEffect, useState } from 'react'
import { Download, FileText } from 'lucide-react'
import api from '../../services/api'

export default function ArtifactCard({ artifact }) {
  const [downloading, setDownloading] = useState(false)
  const [error, setError] = useState('')
  const [preview, setPreview] = useState(null)
  useEffect(() => {
    setPreview(null)
    if (!['png', 'jpg'].includes(artifact.format)) return undefined
    let active = true
    let url
    api.get(`/work/artifacts/${encodeURIComponent(artifact.id)}/download`, { responseType: 'blob' })
      .then(({ data }) => { if (active) { url = URL.createObjectURL(data); setPreview(url) } })
      .catch(() => {}) // Download remains available when a preview fails.
    return () => { active = false; if (url) URL.revokeObjectURL(url) }
  }, [artifact.id, artifact.format])
  const download = async () => {
    setDownloading(true)
    setError('')
    try {
      const { data } = await api.get(`/work/artifacts/${encodeURIComponent(artifact.id)}/download`, { responseType: 'blob' })
      const url = URL.createObjectURL(data)
      const link = document.createElement('a')
      link.href = url
      link.download = `${artifact.title}.${artifact.format}`
      document.body.appendChild(link)
      link.click()
      link.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch {
      setError('下载失败，请重试')
    } finally {
      setDownloading(false)
    }
  }
  return (
    <div className="mt-2 rounded-xl border border-border-hairline bg-surface-card p-3">
      <div className="flex items-center gap-2 text-sm text-text-primary"><FileText size={16} aria-hidden="true" /><span className="min-w-0 break-all">{artifact.title}.{artifact.format}</span></div>
      {preview && <img src={preview} alt={artifact.title} className="mt-2 max-h-96 w-full rounded-lg object-contain" />}
      <button type="button" disabled={downloading} onClick={download} className="mt-1 flex min-h-11 items-center gap-2 text-xs text-action-primary disabled:opacity-50">
        <Download size={14} aria-hidden="true" />{downloading ? '正在下载…' : '下载文件'} · {Math.max(1, Math.ceil(artifact.sizeBytes / 1024))} KB
      </button>
      {error && <p role="alert" className="text-xs text-danger">{error}</p>}
    </div>
  )
}
