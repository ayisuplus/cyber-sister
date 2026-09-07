import { Component } from 'react'

// 路由级错误边界：任何页面渲染异常只降级到本组件，不让整个应用白屏。
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error) {
    // 只记录错误名，不把组件树/道具写进日志，避免泄漏用户内容。
    console.error('页面渲染异常:', error?.name ?? 'Error')
  }

  render() {
    if (this.state.hasError) {
      return (
        <main className="flex flex-1 flex-col items-center justify-center gap-3 bg-transparent px-8 text-center">
          <p className="text-sm font-semibold text-text-primary">这一页出了点问题</p>
          <p className="text-xs leading-relaxed text-text-secondary">你的数据都还在。返回上一页或刷新重试。</p>
          <button
            type="button"
            onClick={() => window.location.assign('/chat')}
            className="mt-2 min-h-11 rounded-2xl bg-action-primary px-6 text-sm font-semibold text-text-inverse shadow-card"
          >
            回到聊天
          </button>
        </main>
      )
    }
    return this.props.children
  }
}
