// AI妆教 — 前端单页应用
// 流程: 上传照片 → 选风格(可多选) → 生成 → 教学
// 纯原生 TS,无框架,无构建依赖(直接被 esbuild 打包成浏览器可执行 JS)

import { STYLE_META, TUTORIALS, getTutorial, type Tutorial, type Technique } from './data.js';
import type { UploadResponse, GenerateResponse } from './types.js';

const API = '/api';

// ---------- 状态 ----------

interface State {
  uploadedImage: string | null;   // dataURL
  uploadedId: string | null;
  selectedStyles: Set<string>;
  generating: boolean;
  results: Map<string, string>;    // style → resultUrl
  activeStyle: string | null;      // 展示教学的风格
}

const state: State = {
  uploadedImage: null,
  uploadedId: null,
  selectedStyles: new Set(),
  generating: false,
  results: new Map(),
  activeStyle: null,
};

// ---------- 入口 ----------

function start() {
  injectCSS();
  document.body.innerHTML = renderLayout();
  bindEvents();
}

function injectCSS() {
  const css = `
:root{
  --bg:#fafafa; --fg:#1a1a1a; --muted:#777;
  --primary:#ff4d6d; --primary-soft:#ffe0e6;
  --card:#fff; --border:#eee; --radius:16px;
  --shadow:0 10px 30px rgba(0,0,0,0.06);
  --shadow-hover:0 20px 40px rgba(0,0,0,0.1);
}
*{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%}
body{
  font-family:-apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei',sans-serif;
  background:linear-gradient(180deg,#fff5f7 0%,#fafafa 30%);
  color:var(--fg);
  min-height:100vh;
  line-height:1.6;
}
.container{max-width:1100px;margin:0 auto;padding:32px 24px 80px}
header{text-align:center;margin-bottom:48px}
header h1{font-size:42px;font-weight:800;background:linear-gradient(135deg,#ff4d6d,#c9184a);-webkit-background-clip:text;background-clip:text;color:transparent;letter-spacing:-1px}
header p{color:var(--muted);margin-top:8px;font-size:15px}

.section{background:var(--card);border-radius:var(--radius);box-shadow:var(--shadow);padding:28px;margin-bottom:24px;transition:box-shadow .2s}
.section:hover{box-shadow:var(--shadow-hover)}
.section h2{font-size:20px;margin-bottom:6px;display:flex;align-items:center;gap:8px}
.section .sub{color:var(--muted);font-size:13px;margin-bottom:20px}
.section .step-num{display:inline-flex;width:28px;height:28px;background:var(--primary);color:#fff;border-radius:50%;align-items:center;justify-content:center;font-size:14px;font-weight:700}

/* 上传区 */
.upload{border:2px dashed #ffc2cc;border-radius:var(--radius);padding:48px 24px;text-align:center;cursor:pointer;transition:all .2s;background:#fff8fa}
.upload:hover,.upload.dragover{border-color:var(--primary);background:#fff0f3;transform:scale(1.005)}
.upload-icon{font-size:48px;margin-bottom:12px;display:block}
.upload-text{font-size:16px;color:var(--muted)}
.upload-text strong{color:var(--primary)}
.upload-preview{max-width:200px;max-height:240px;border-radius:12px;margin:0 auto;box-shadow:var(--shadow)}

/* 风格卡片网格 */
.styles{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:16px}
.style-card{
  border-radius:var(--radius);padding:20px;color:#fff;cursor:pointer;
  position:relative;transition:all .25s;overflow:hidden;
  box-shadow:var(--shadow);min-height:160px;display:flex;flex-direction:column;justify-content:space-between;
}
.style-card:hover{transform:translateY(-4px);box-shadow:var(--shadow-hover)}
.style-card.selected{outline:3px solid var(--primary);outline-offset:2px;transform:translateY(-4px)}
.style-card .emoji{font-size:36px;line-height:1}
.style-card .name{font-size:20px;font-weight:700;margin-top:8px}
.style-card .tagline{font-size:12px;opacity:.9;margin-top:4px}
.style-card .check{position:absolute;top:12px;right:12px;width:24px;height:24px;border-radius:50%;background:rgba(255,255,255,.3);display:flex;align-items:center;justify-content:center;font-size:14px;transition:all .2s}
.style-card.selected .check{background:#fff;color:var(--primary)}

/* 操作按钮 */
.actions{display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-top:20px}
.btn{padding:12px 28px;border-radius:999px;font-size:15px;font-weight:600;border:none;cursor:pointer;transition:all .2s;font-family:inherit}
.btn-primary{background:linear-gradient(135deg,#ff4d6d,#c9184a);color:#fff;box-shadow:0 4px 12px rgba(255,77,109,.3)}
.btn-primary:hover:not(:disabled){transform:translateY(-2px);box-shadow:0 6px 20px rgba(255,77,109,.4)}
.btn-primary:disabled{opacity:.4;cursor:not-allowed}
.btn-ghost{background:transparent;color:var(--muted);border:1px solid var(--border)}
.btn-ghost:hover{color:var(--fg)}

/* 结果区 */
.results{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:20px;margin-top:20px}
.result-card{background:#fff;border-radius:var(--radius);overflow:hidden;box-shadow:var(--shadow);transition:all .2s}
.result-card:hover{box-shadow:var(--shadow-hover)}
.result-card img{width:100%;aspect-ratio:4/3;object-fit:cover;display:block;background:#f5f5f5}
.result-card .body{padding:16px}
.result-card .title{font-size:16px;font-weight:700;display:flex;align-items:center;gap:8px}
.result-card .meta{color:var(--muted);font-size:12px;margin-top:4px}
.result-card .view-btn{margin-top:12px;width:100%;padding:8px;background:var(--primary-soft);color:var(--primary);border:none;border-radius:8px;cursor:pointer;font-weight:600;font-family:inherit}
.result-card .view-btn:hover{background:var(--primary);color:#fff}

.spinner{display:inline-block;width:16px;height:16px;border:2px solid rgba(255,255,255,.3);border-top-color:#fff;border-radius:50%;animation:spin 1s linear infinite;vertical-align:middle;margin-right:8px}
@keyframes spin{to{transform:rotate(360deg)}}

/* 教学区 */
.tutorial{background:linear-gradient(135deg,#fff,#fff8fa);border-radius:var(--radius);padding:28px;margin-top:16px;border:1px solid var(--border)}
.tutorial h3{font-size:22px;margin-bottom:4px;display:flex;align-items:center;gap:10px}
.tutorial .desc{color:var(--muted);font-size:14px;margin-bottom:20px}
.tutorial-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:20px;margin-top:20px}
.tutorial-block h4{font-size:14px;color:var(--muted);text-transform:uppercase;letter-spacing:1px;margin-bottom:12px;font-weight:600}
.tech-list{list-style:none;display:flex;flex-direction:column;gap:8px}
.tech-item{display:flex;align-items:center;gap:12px;background:#fff;padding:10px 14px;border-radius:10px;font-size:14px}
.tech-bar{flex:1;height:6px;background:#f5f5f5;border-radius:3px;overflow:hidden}
.tech-bar-fill{height:100%;background:linear-gradient(90deg,#ff4d6d,#c9184a);border-radius:3px;transition:width .6s}
.tech-pct{font-size:12px;color:var(--muted);min-width:36px;text-align:right}
.tag-list{display:flex;flex-wrap:wrap;gap:8px}
.tag{padding:6px 12px;background:#fff;border:1px solid var(--border);border-radius:999px;font-size:13px;color:#555}
.diff-easy{color:#52c41a}.diff-medium{color:#fa8c16}.diff-hard{color:#f5222d}
.empty{text-align:center;color:var(--muted);padding:40px 20px;font-size:14px}

footer{text-align:center;color:var(--muted);font-size:12px;margin-top:40px}
`;
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);
}

// ---------- 渲染 ----------

function renderLayout(): string {
  return `
<div class="container">
  <header>
    <h1>💄 AI 妆教</h1>
    <p>上传人脸照片,一键预览 5 大妆容风格,附赠详细教学</p>
  </header>

  <div class="section" id="step-upload">
    <h2><span class="step-num">1</span> 上传人脸照片</h2>
    <p class="sub">支持拖拽或点击上传,推荐正面无遮挡,效果更佳</p>
    <div class="upload" id="upload">
      <div id="upload-content">${renderUploadContent()}</div>
    </div>
    <input type="file" id="file-input" accept="image/jpeg,image/png,image/webp" style="display:none">
  </div>

  <div class="section" id="step-style">
    <h2><span class="step-num">2</span> 选择妆容风格(可多选)</h2>
    <p class="sub">${STYLE_META.length} 种风格,基于 Flux2 + LoRA 微调</p>
    <div class="styles" id="styles">
      ${STYLE_META.map((s) => `
        <div class="style-card ${state.selectedStyles.has(s.id) ? 'selected' : ''}" data-style="${s.id}" style="background:${s.gradient}">
          <div>
            <span class="emoji">${s.emoji}</span>
            <div class="name">${s.name}</div>
            <div class="tagline">${s.tagline}</div>
          </div>
          <div class="check">${state.selectedStyles.has(s.id) ? '✓' : '+'}</div>
        </div>
      `).join('')}
    </div>
    <div class="actions">
      <button class="btn btn-primary" id="generate-btn" disabled>
        ${state.generating ? '<span class="spinner"></span>生成中…' : '✨ 一键生成妆容预览'}
      </button>
      <button class="btn btn-ghost" id="reset-btn">重置</button>
    </div>
  </div>

  <div class="section" id="step-result" style="display:${state.results.size ? 'block' : 'none'}">
    <h2><span class="step-num">3</span> 生成结果</h2>
    <p class="sub">点击卡片查看对应风格的教学内容</p>
    <div class="results" id="results">
      ${renderResults()}
    </div>
  </div>

  <div class="section" id="step-tutorial" style="display:${state.activeStyle ? 'block' : 'none'}">
    <h2><span class="step-num">4</span> 教学内容</h2>
    <p class="sub">来自 ${TUTORIALS.reduce((s, t) => s + t.sampleCount, 0)} 条妆容样本的技法聚合</p>
    <div id="tutorial-content">${renderTutorial(state.activeStyle)}</div>
  </div>

  <footer>AI妆教 · 基于扩散模型 LoRA 微调 · 论文级毕设项目</footer>
</div>
`;
}

function renderUploadContent(): string {
  if (state.uploadedImage) {
    return `<img src="${state.uploadedImage}" class="upload-preview" alt="uploaded">`;
  }
  return `<span class="upload-icon">📷</span><div class="upload-text">拖拽图片到此处,或<strong>点击上传</strong></div>`;
}

function renderResults(): string {
  if (state.results.size === 0) return '';
  return [...state.results.entries()].map(([style, url]) => {
    const meta = STYLE_META.find((s) => s.id === style)!;
    return `
      <div class="result-card">
        <img src="${url}" alt="${style}">
        <div class="body">
          <div class="title">${meta.emoji} ${meta.name}</div>
          <div class="meta">${meta.tagline}</div>
          <button class="view-btn" data-tutorial="${style}">📖 查看教学</button>
        </div>
      </div>
    `;
  }).join('');
}

function renderTutorial(styleId: string | null): string {
  if (!styleId) return '<div class="empty">点击生成结果下方的"查看教学"按钮查看</div>';
  const t = getTutorial(styleId);
  const meta = STYLE_META.find((s) => s.id === styleId);
  if (!t || !meta) return '<div class="empty">未找到教学数据</div>';

  return `
    <div class="tutorial">
      <h3>${meta.emoji} ${t.name}</h3>
      <p class="desc">${t.description}</p>
      <div class="tutorial-grid">
        <div class="tutorial-block">
          <h4>核心技法 Top 8</h4>
          <ul class="tech-list">
            ${t.techniques.map((tech) => renderTechItem(tech)).join('')}
          </ul>
        </div>
        <div class="tutorial-block">
          <h4>风格信息</h4>
          <div style="display:flex;flex-direction:column;gap:10px;font-size:14px">
            <div>难度:<span class="diff-${t.difficulty}">${difficultyLabel(t.difficulty)}</span></div>
            <div>肤质:${t.skinFinish || '—'}</div>
            <div>样本量:${t.sampleCount} 张</div>
            <div>氛围:${t.vibe || '—'}</div>
          </div>
        </div>
        <div class="tutorial-block">
          <h4>适合场合</h4>
          <div class="tag-list">${t.occasions.map((o) => `<span class="tag">${o}</span>`).join('')}</div>
        </div>
        <div class="tutorial-block">
          <h4>主导色</h4>
          <div class="tag-list">${t.colors.map((c) => `<span class="tag">${c}</span>`).join('')}</div>
        </div>
      </div>
    </div>
  `;
}

function renderTechItem(tech: Technique): string {
  return `
    <li class="tech-item">
      <span style="flex:0 0 auto;min-width:90px">${tech.name}</span>
      <div class="tech-bar"><div class="tech-bar-fill" style="width:${tech.weight}%"></div></div>
      <span class="tech-pct">${tech.weight}%</span>
    </li>
  `;
}

function difficultyLabel(d: string): string {
  return { easy: '简单 ★☆☆', medium: '中等 ★★☆', hard: '进阶 ★★★' }[d] ?? d;
}

// ---------- 事件 ----------

function bindEvents() {
  const upload = document.getElementById('upload')!;
  const fileInput = document.getElementById('file-input') as HTMLInputElement;

  upload.addEventListener('click', () => fileInput.click());
  upload.addEventListener('dragover', (e) => { e.preventDefault(); upload.classList.add('dragover'); });
  upload.addEventListener('dragleave', () => upload.classList.remove('dragover'));
  upload.addEventListener('drop', (e) => {
    e.preventDefault();
    upload.classList.remove('dragover');
    const file = e.dataTransfer?.files?.[0];
    if (file) handleFile(file);
  });
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (file) handleFile(file);
  });

  // 风格卡片
  document.querySelectorAll<HTMLElement>('.style-card').forEach((el) => {
    el.addEventListener('click', () => {
      const id = el.dataset.style!;
      if (state.selectedStyles.has(id)) state.selectedStyles.delete(id);
      else state.selectedStyles.add(id);
      updateGenerateButton();
      el.classList.toggle('selected');
      const check = el.querySelector('.check');
      if (check) check.textContent = state.selectedStyles.has(id) ? '✓' : '+';
    });
  });

  // 生成
  document.getElementById('generate-btn')!.addEventListener('click', handleGenerate);

  // 重置
  document.getElementById('reset-btn')!.addEventListener('click', () => {
    state.uploadedImage = null;
    state.uploadedId = null;
    state.selectedStyles.clear();
    state.results.clear();
    state.activeStyle = null;
    rerender();
  });

  // 教学按钮(委托)
  document.getElementById('results')?.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const style = target.dataset.tutorial;
    if (style) {
      state.activeStyle = style;
      rerender();
      document.getElementById('step-tutorial')?.scrollIntoView({ behavior: 'smooth' });
    }
  });
}

function updateGenerateButton() {
  const btn = document.getElementById('generate-btn') as HTMLButtonElement;
  const ok = state.uploadedId && state.selectedStyles.size > 0 && !state.generating;
  btn.disabled = !ok;
}

// ---------- 文件处理 ----------

async function handleFile(file: File) {
  if (!file.type.startsWith('image/')) {
    alert('请上传图片文件');
    return;
  }
  if (file.size > 8 * 1024 * 1024) {
    alert('图片超过 8MB');
    return;
  }

  // 1) 预览
  const reader = new FileReader();
  reader.onload = () => {
    state.uploadedImage = reader.result as string;
    document.getElementById('upload-content')!.innerHTML = renderUploadContent();
  };
  reader.readAsDataURL(file);

  // 2) 上传
  const dataUrl = await fileToDataURL(file);
  try {
    const resp = await fetch(`${API}/upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: dataUrl }),
    });
    if (!resp.ok) throw new Error(await resp.text());
    const data = (await resp.json()) as UploadResponse;
    state.uploadedId = data.imageId;
    updateGenerateButton();
  } catch (err) {
    alert('上传失败: ' + (err as Error).message);
  }
}

function fileToDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

// ---------- 生成 ----------

async function handleGenerate() {
  if (!state.uploadedId || state.selectedStyles.size === 0) return;
  state.generating = true;
  state.results.clear();
  rerender();

  const styles = [...state.selectedStyles];
  await Promise.all(styles.map((style) => generateOne(style)));
  state.generating = false;
  state.activeStyle = styles[0] ?? null;
  rerender();
  document.getElementById('step-result')?.scrollIntoView({ behavior: 'smooth' });
}

async function generateOne(style: string) {
  try {
    const resp = await fetch(`${API}/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageId: state.uploadedId, style }),
    });
    if (!resp.ok) throw new Error(await resp.text());
    const data = (await resp.json()) as GenerateResponse;
    state.results.set(style, data.resultUrl);
  } catch (err) {
    console.error('生成失败', style, err);
  }
}

// ---------- 重渲染 ----------

function rerender() {
  document.body.innerHTML = renderLayout();
  bindEvents();
  updateGenerateButton();
}

// ---------- 启动 ----------

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start);
} else {
  start();
}
