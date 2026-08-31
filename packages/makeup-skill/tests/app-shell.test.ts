import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import App, { EXPLAIN_REQUEST_TIMEOUT_MS } from '../src/frontend/App';
import { ToastProvider } from '../src/frontend/components/Toast';

describe('Makeup application shell', () => {
  it('等待姆教桥接完成后才在浏览器降级', () => {
    expect(EXPLAIN_REQUEST_TIMEOUT_MS).toBe(70_000);
  });

  it('在所有流程共用的页头提供返回主应用工具页的入口', () => {
    const html = renderToStaticMarkup(createElement(ToastProvider, null, createElement(App)));

    expect(html).toContain('href="/tools"');
    expect(html).toContain('返回赛博姐妹');
  });
});
