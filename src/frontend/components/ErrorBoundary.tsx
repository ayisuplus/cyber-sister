// Error Boundary — React 19 风格, 用 componentDidCatch 兜底未知错误.
// 渲染时显示一个友好的兜底页,带"再试一次"按钮.

import { Component, type ErrorInfo, type ReactNode } from 'react';
import { track } from '../../shared/analytics';

interface Props {
  children: ReactNode;
  /** 自定义 fallback,默认用 ErrorBoundary 内部实现. */
  fallback?: (error: Error, reset: () => void) => ReactNode;
  /** 上层自定义 reset 行为 (例如重新加载分析), 默认 reload 整个页面. */
  onReset?: () => void;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    track('app_error', {
      message: error.message,
      stack: error.stack?.slice(0, 200),
      componentStack: info.componentStack?.slice(0, 200),
    });
    // 也打 console.error 方便开发定位
    console.error('[ErrorBoundary] caught:', error, info);
  }

  reset = () => {
    this.setState({ error: null });
    if (this.props.onReset) this.props.onReset();
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (this.props.fallback) return this.props.fallback(error, this.reset);
    return <DefaultFallback error={error} onRetry={this.reset} />;
  }
}

function DefaultFallback({ error, onRetry }: { error: Error; onRetry: () => void }) {
  return (
    <main className="app-shell">
      <section className="app-card animate-fade-up">
        <div className="card-glass p-6 sm:p-8 text-center">
          <div
            className="w-20 h-20 rounded-full mx-auto mb-5 flex items-center justify-center text-4xl"
            style={{ background: 'rgba(234,182,188,0.4)' }}
            aria-hidden
          >
            🥺
          </div>
          <h1 className="font-serif text-2xl font-bold text-ink mb-2">出错了</h1>
          <p className="text-sm text-ink-soft/70 mb-6">
            页面遇到了一些意外,可以刷新一下重试
          </p>
          <details className="text-left text-xs text-ink-soft/60 mb-6 bg-white/40 rounded-xl p-3">
            <summary className="cursor-pointer text-ink-soft/80">错误详情</summary>
            <pre className="mt-2 whitespace-pre-wrap break-words font-mono text-[11px]">
              {error.message}
            </pre>
          </details>
          <button type="button" onClick={onRetry} className="btn-primary w-full">
            再试一次
          </button>
        </div>
      </section>
    </main>
  );
}
