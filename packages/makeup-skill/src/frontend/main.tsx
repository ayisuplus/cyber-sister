import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ToastProvider } from './components/Toast';
import './index.css';

// 浏览器空闲时预取后续会用到的 chunk — 降低用户进入下一步时的等待.
// 实际生成 prefetch 链接需要 Vite 插件 (build.rollupOptions.output.manualChunks),
// 简单办法:动态 import 这些模块,V8/浏览器会自然命中 HTTP 缓存.
function prefetchOnIdle(): void {
  const run = () => {
    // 用动态 import 让模块进入浏览器模块图,后续 lazy() 命中时即时解析.
    // MakeupCanvas/ResourcesView 是 tutorial 路径必经,ResultCard 是终点.
    void import('./tutorial/MakeupCanvas');
    void import('./resources/ResourcesView');
    // ResultCard 在最后一步才用,延迟更长一些.
    setTimeout(() => {
      void import('./result/ResultCard');
    }, 2_000);
  };
  if (typeof window === 'undefined') return;
  const ric = (window as Window & { requestIdleCallback?: (cb: () => void) => number })
    .requestIdleCallback;
  if (typeof ric === 'function') ric(run);
  else setTimeout(run, 1_500);
}
prefetchOnIdle();

const root = document.getElementById('root');
if (!root) {
  throw new Error('root 元素未找到 — 检查 public/index.html');
}

createRoot(root).render(
  <StrictMode>
    <ErrorBoundary>
      <ToastProvider>
        <App />
      </ToastProvider>
    </ErrorBoundary>
  </StrictMode>,
);
