import { useEffect, useState } from 'react'
import { useToolsStore } from '../stores/toolsStore'
import Header from '../components/layout/Header'
import { Plus, Check, Trash2, Calendar } from 'lucide-react'

export default function TodoPage() {
  const { todos, addTodo, toggleTodo, deleteTodo } = useToolsStore()
  const loadTodos = useToolsStore(s => s.loadTodos)
  const [newContent, setNewContent] = useState('')
  useEffect(() => {
    loadTodos()
  }, [loadTodos])
  const [showInput, setShowInput] = useState(false)

  const handleAdd = () => {
    if (!newContent.trim()) return
    addTodo(newContent.trim())
    setNewContent('')
    setShowInput(false)
  }

  const pendingTodos = todos.filter(t => !t.isDone)
  const doneTodos = todos.filter(t => t.isDone)

  return (
    <div className="flex-1 flex flex-col bg-surface-page overflow-hidden">
      <Header title="待办提醒" showBack />

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {/* 待办列表 */}
        {pendingTodos.length > 0 && (
          <div className="bg-white rounded-[20px] shadow-card overflow-hidden">
            <div className="px-4 py-3 border-b border-border-subtle">
              <h3 className="text-sm font-semibold text-text-primary">待完成 ({pendingTodos.length})</h3>
            </div>
            {pendingTodos.map(todo => (
              <div key={todo.id} className="flex items-center gap-3 px-4 py-3 border-b border-border-subtle last:border-0">
                <button
                  onClick={() => toggleTodo(todo.id)}
                  className="w-5 h-5 rounded-full border-2 border-brand-pink flex items-center justify-center shrink-0 hover:bg-brand-pink/10 transition-colors"
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-text-primary truncate">{todo.content}</p>
                  {todo.dueDate && (
                    <span className="text-xs text-text-muted flex items-center gap-1 mt-0.5">
                      <Calendar size={10} />
                      {todo.dueDate}
                    </span>
                  )}
                </div>
                <button
                  onClick={() => deleteTodo(todo.id)}
                  className="text-text-muted hover:text-red-500 transition-colors"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* 已完成 */}
        {doneTodos.length > 0 && (
          <div className="bg-white rounded-[20px] shadow-card overflow-hidden">
            <div className="px-4 py-3 border-b border-border-subtle">
              <h3 className="text-sm font-semibold text-text-muted">已完成 ({doneTodos.length})</h3>
            </div>
            {doneTodos.map(todo => (
              <div key={todo.id} className="flex items-center gap-3 px-4 py-3 border-b border-border-subtle last:border-0 opacity-60">
                <button
                  onClick={() => toggleTodo(todo.id)}
                  className="w-5 h-5 rounded-full bg-brand-green flex items-center justify-center shrink-0"
                >
                  <Check size={12} className="text-white" />
                </button>
                <p className="flex-1 text-sm text-text-muted line-through">{todo.content}</p>
                <button
                  onClick={() => deleteTodo(todo.id)}
                  className="text-text-muted hover:text-red-500 transition-colors"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
          </div>
        )}

        {todos.length === 0 && (
          <div className="text-center py-12">
            <p className="text-text-muted text-sm">暂无待办事项</p>
            <p className="text-text-muted text-xs mt-1">点击下方按钮添加</p>
          </div>
        )}
      </div>

      {/* 添加待办 */}
      <div className="px-4 py-3 bg-white shadow-input">
        {showInput ? (
          <div className="flex gap-2">
            <input
              type="text"
              value={newContent}
              onChange={e => setNewContent(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleAdd()}
              placeholder="输入待办内容..."
              autoFocus
              className="flex-1 h-10 bg-surface-input rounded-xl px-4 text-sm outline-none focus:ring-2 focus:ring-brand-pink/30"
            />
            <button
              onClick={handleAdd}
              className="h-10 px-4 bg-brand-pink text-white text-sm rounded-xl"
            >
              添加
            </button>
            <button
              onClick={() => { setShowInput(false); setNewContent('') }}
              className="h-10 px-3 text-text-muted text-sm"
            >
              取消
            </button>
          </div>
        ) : (
          <button
            onClick={() => setShowInput(true)}
            className="w-full h-10 bg-brand-pink/10 text-brand-pink text-sm font-medium rounded-xl flex items-center justify-center gap-1"
          >
            <Plus size={16} />
            添加待办
          </button>
        )}
      </div>
    </div>
  )
}
