import { useState } from 'react'
import Header from '../components/layout/Header'
import { Brain, Search, Trash2, Star, Tag } from 'lucide-react'

// Mock记忆数据
const MOCK_MEMORIES = [
  { id: '1', type: 'semantic', content: '用户叫小雨，在上海工作，做产品经理', importance: 9, tags: ['基本信息'], createdAt: '2026-07-01' },
  { id: '2', type: 'semantic', content: '不吃香菜，对芒果过敏', importance: 8, tags: ['饮食', '健康'], createdAt: '2026-07-03' },
  { id: '3', type: 'episodic', content: '上周和老板吵架了，因为项目方向问题', importance: 6, tags: ['工作', '情绪'], createdAt: '2026-07-08' },
  { id: '4', type: 'semantic', content: '男朋友叫小明，异地恋，在北京', importance: 8, tags: ['感情'], createdAt: '2026-07-05' },
  { id: '5', type: 'episodic', content: '最近在减肥，目标是瘦到100斤', importance: 5, tags: ['健康'], createdAt: '2026-07-10' },
  { id: '6', type: 'procedural', content: '喜欢听毒舌风格的回复，不要太温柔', importance: 7, tags: ['偏好'], createdAt: '2026-07-02' },
]

const TYPE_LABELS = {
  semantic: { label: '语义记忆', color: 'bg-brand-purple/10 text-brand-purple' },
  episodic: { label: '情景记忆', color: 'bg-brand-blue/10 text-brand-blue' },
  procedural: { label: '程序记忆', color: 'bg-brand-green/10 text-brand-green' },
}

export default function MemoriesPage() {
  const [memories, setMemories] = useState(MOCK_MEMORIES)
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')

  const filtered = memories.filter(m => {
    if (filter !== 'all' && m.type !== filter) return false
    if (search && !m.content.includes(search)) return false
    return true
  })

  const handleDelete = (id) => {
    setMemories(prev => prev.filter(m => m.id !== id))
  }

  return (
    <div className="flex-1 flex flex-col bg-bg-message overflow-hidden">
      <Header title="记忆管理" showBack />

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {/* 搜索 */}
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="搜索记忆..."
            className="w-full h-10 bg-white rounded-xl pl-10 pr-4 text-sm outline-none shadow-card"
          />
        </div>

        {/* 筛选 */}
        <div className="flex gap-2">
          {[
            { key: 'all', label: '全部' },
            { key: 'semantic', label: '语义' },
            { key: 'episodic', label: '情景' },
            { key: 'procedural', label: '程序' },
          ].map(f => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                filter === f.key ? 'bg-brand-pink text-white' : 'bg-white text-text-secondary'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* 记忆统计 */}
        <div className="bg-white rounded-[20px] p-4 shadow-card flex items-center justify-around">
          <div className="text-center">
            <p className="text-2xl font-mono font-bold text-brand-purple">{memories.length}</p>
            <p className="text-xs text-text-muted">总记忆</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-mono font-bold text-brand-pink">{memories.filter(m => m.importance >= 8).length}</p>
            <p className="text-xs text-text-muted">核心记忆</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-mono font-bold text-brand-green">{memories.filter(m => m.type === 'semantic').length}</p>
            <p className="text-xs text-text-muted">永久记忆</p>
          </div>
        </div>

        {/* 记忆列表 */}
        <div className="space-y-2">
          {filtered.map(memory => {
            const typeInfo = TYPE_LABELS[memory.type]
            return (
              <div key={memory.id} className="bg-white rounded-[16px] p-4 shadow-card">
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className={`text-[10px] px-2 py-0.5 rounded-full ${typeInfo.color}`}>
                      {typeInfo.label}
                    </span>
                    <div className="flex items-center gap-0.5">
                      {Array.from({ length: Math.min(5, Math.ceil(memory.importance / 2)) }).map((_, i) => (
                        <Star key={i} size={10} className="text-brand-yellow fill-brand-yellow" />
                      ))}
                    </div>
                  </div>
                  <button
                    onClick={() => handleDelete(memory.id)}
                    className="text-text-muted hover:text-red-500 transition-colors"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
                <p className="text-sm text-text-primary leading-relaxed">{memory.content}</p>
                <div className="flex items-center gap-2 mt-2">
                  {memory.tags.map(tag => (
                    <span key={tag} className="flex items-center gap-0.5 text-[10px] text-text-muted">
                      <Tag size={8} />
                      {tag}
                    </span>
                  ))}
                  <span className="text-[10px] text-text-muted ml-auto">{memory.createdAt}</span>
                </div>
              </div>
            )
          })}
        </div>

        {filtered.length === 0 && (
          <div className="text-center py-12">
            <Brain size={48} className="text-text-muted mx-auto mb-3" />
            <p className="text-text-muted text-sm">没有找到相关记忆</p>
          </div>
        )}
      </div>
    </div>
  )
}
