// AI 妆教 - 主应用入口
// 状态机: idle → loading_model → ready → analyzing → analysis_done → ...
//        → recommending → looks_ready → tutorial_step → tutorial_done → result / error

import { useReducer, useRef, useState, type ChangeEvent } from 'react';
import type { FaceFeatures, MakeupLook } from '../shared/types';

// ---------- 状态机 ----------

type AppState =
  | { stage: 'idle' }
  | { stage: 'loading_model'; progress: number }
  | { stage: 'ready'; imageData: ImageData; previewUrl: string }
  | { stage: 'analyzing' }
  | { stage: 'analysis_done'; features: FaceFeatures }
  | { stage: 'recommending' }
  | { stage: 'looks_ready'; looks: MakeupLook[]; selected: number }
  | { stage: 'tutorial_step'; look: MakeupLook; stepIndex: number }
  | { stage: 'tutorial_done'; look: MakeupLook }
  | { stage: 'result'; look: MakeupLook; features: FaceFeatures }
  | { stage: 'error'; message: string; recoverable: boolean };

type Action =
  | { type: 'START_LOAD_MODEL' }
  | { type: 'MODEL_PROGRESS'; progress: number }
  | { type: 'MODEL_READY' }
  | { type: 'IMAGE_SELECTED'; imageData: ImageData; previewUrl: string }
  | { type: 'START_ANALYZE' }
  | { type: 'ANALYSIS_DONE'; features: FaceFeatures }
  | { type: 'START_RECOMMEND' }
  | { type: 'LOOKS_READY'; looks: MakeupLook[]; selected: number }
  | { type: 'SELECT_LOOK'; index: number }
  | { type: 'START_TUTORIAL' }
  | { type: 'NEXT_STEP' }
  | { type: 'PREV_STEP' }
  | { type: 'GOTO_STEP'; index: number }
  | { type: 'TUTORIAL_DONE' }
  | { type: 'SHOW_RESULT' }
  | { type: 'ERROR'; message: string; recoverable: boolean }
  | { type: 'RESET' };

const initialState: AppState = { stage: 'idle' };

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'START_LOAD_MODEL':
      return { stage: 'loading_model', progress: 0 };
    case 'MODEL_PROGRESS':
      if (state.stage !== 'loading_model') return state;
      return { stage: 'loading_model', progress: action.progress };
    case 'MODEL_READY':
      // 保留已选图,直接回 ready
      if (state.stage === 'loading_model') {
        return { stage: 'idle' }; // 没有图,回到 idle 等用户操作
      }
      return state;
    case 'IMAGE_SELECTED':
      return { stage: 'ready', imageData: action.imageData, previewUrl: action.previewUrl };
    case 'START_ANALYZE':
      return { stage: 'analyzing' };
    case 'ANALYSIS_DONE':
      return { stage: 'analysis_done', features: action.features };
    case 'START_RECOMMEND':
      return { stage: 'recommending' };
    case 'LOOKS_READY':
      return { stage: 'looks_ready', looks: action.looks, selected: action.selected };
    case 'SELECT_LOOK':
      if (state.stage !== 'looks_ready') return state;
      return { ...state, selected: action.index };
    case 'START_TUTORIAL':
      if (state.stage !== 'looks_ready') return state;
      return { stage: 'tutorial_step', look: state.looks[state.selected], stepIndex: 0 };
    case 'NEXT_STEP':
      if (state.stage !== 'tutorial_step') return state;
      {
        const next = state.stepIndex + 1;
        if (next >= state.look.steps.length) {
          return { stage: 'tutorial_done', look: state.look };
        }
        return { ...state, stepIndex: next };
      }
    case 'PREV_STEP':
      if (state.stage !== 'tutorial_step') return state;
      return { ...state, stepIndex: Math.max(0, state.stepIndex - 1) };
    case 'GOTO_STEP':
      if (state.stage !== 'tutorial_step') return state;
      return { ...state, stepIndex: action.index };
    case 'TUTORIAL_DONE':
      if (state.stage !== 'tutorial_step') return state;
      return { stage: 'tutorial_done', look: state.look };
    case 'SHOW_RESULT':
      if (state.stage !== 'tutorial_done') return state;
      // features 来自 analysis_done,这里需要从更早状态拿 — 简化:由上层组件注入
      return state;
    case 'ERROR':
      return { stage: 'error', message: action.message, recoverable: action.recoverable };
    case 'RESET':
      return { stage: 'idle' };
    default:
      return state;
  }
}

// ---------- 常量 ----------

const ACCEPT_TYPES = '.jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp';
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

// ---------- 主组件 ----------

function App() {
  const [state, dispatch] = useReducer(reducer, initialState);

  return (
    <main className="min-h-screen flex items-center justify-center px-6 py-10">
      <section className="max-w-xl w-full bg-white rounded-card shadow-soft p-8 text-center">
        <h1 className="font-hand text-5xl text-accent mb-4">妆语</h1>

        {state.stage === 'idle' && <OnboardingView onImagePicked={onPick} />}
        {state.stage === 'loading_model' && <LoadingModelView progress={state.progress} />}
        {state.stage === 'ready' && (
          <ReadyView
            previewUrl={state.previewUrl}
            onRetake={() => dispatch({ type: 'RESET' })}
            onAnalyze={() => dispatch({ type: 'START_ANALYZE' })}
          />
        )}
        {state.stage === 'analyzing' && <AnalyzingView />}
        {state.stage === 'analysis_done' && <AnalysisDoneView features={state.features} />}
        {state.stage === 'error' && (
          <ErrorView
            message={state.message}
            recoverable={state.recoverable}
            onRetry={() => dispatch({ type: 'RESET' })}
          />
        )}
        {/* 后续阶段先放占位 */}
        {(state.stage === 'recommending' ||
          state.stage === 'looks_ready' ||
          state.stage === 'tutorial_step' ||
          state.stage === 'tutorial_done' ||
          state.stage === 'result') && <ComingSoonView stage={state.stage} />}
      </section>
    </main>
  );

  // 选图后保存到 ImageData + objectURL
  function onPick(file: File) {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        dispatch({ type: 'ERROR', message: '浏览器不支持画布', recoverable: false });
        return;
      }
      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      dispatch({ type: 'IMAGE_SELECTED', imageData, previewUrl: url });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      dispatch({ type: 'ERROR', message: '图片加载失败,请换一张试试', recoverable: true });
    };
    img.src = url;
  }
}

// ---------- 视图: 引导页 (idle) ----------

function OnboardingView({ onImagePicked }: { onImagePicked: (file: File) => void }) {
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  function pick(file: File | undefined) {
    if (!file) return;
    if (file.size > MAX_FILE_SIZE) {
      setError('图片太大啦,换个 10MB 以内的吧～');
      return;
    }
    const ok =
      file.type === 'image/jpeg' ||
      file.type === 'image/jpg' ||
      file.type === 'image/png' ||
      file.type === 'image/webp' ||
      /\.(jpe?g|png|webp)$/i.test(file.name);
    if (!ok) {
      setError('只支持 JPG / PNG / WebP 哦');
      return;
    }
    setError(null);
    onImagePicked(file);
  }

  function onChange(e: ChangeEvent<HTMLInputElement>) {
    pick(e.target.files?.[0]);
    e.target.value = ''; // 允许重选同一张
  }

  return (
    <div>
      <h2 className="text-2xl font-semibold text-ink mb-2">找到最适合你的妆容</h2>
      <p className="text-ink/70 mb-8">三步拥有你的专属妆容方案</p>

      <ol className="space-y-4 text-left mb-8">
        <Step n={1} title="拍一张正面照" desc="光线充足、表情自然,效果最好" />
        <Step n={2} title="AI 分析你的脸型" desc="三庭五眼、肤色、轮廓,一键读取" />
        <Step n={3} title="手把手教你画" desc="从底妆到唇色,跟着步骤一步步来" />
      </ol>

      <div className="flex flex-col sm:flex-row gap-3 justify-center">
        <button
          type="button"
          onClick={() => cameraRef.current?.click()}
          className="bg-gradient-to-r from-primary to-accent hover:opacity-90 transition-opacity text-white font-medium px-6 py-3 rounded-full shadow-soft"
        >
          📷 开始拍照
        </button>
        <button
          type="button"
          onClick={() => galleryRef.current?.click()}
          className="bg-white border-2 border-primary text-accent hover:bg-secondary/30 transition-colors font-medium px-6 py-3 rounded-full"
        >
          🖼️ 从相册选择
        </button>
      </div>

      <input
        ref={cameraRef}
        type="file"
        accept={ACCEPT_TYPES}
        capture="user"
        onChange={onChange}
        className="hidden"
      />
      <input
        ref={galleryRef}
        type="file"
        accept={ACCEPT_TYPES}
        onChange={onChange}
        className="hidden"
      />

      {error && <p className="mt-4 text-sm text-accent">{error}</p>}

      <p className="mt-6 text-xs text-ink/50">图片仅在浏览器内分析,不会上传到服务器</p>
    </div>
  );
}

function Step({ n, title, desc }: { n: number; title: string; desc: string }) {
  return (
    <li className="flex items-start gap-3">
      <span className="flex-shrink-0 w-8 h-8 rounded-full bg-accent text-white font-semibold flex items-center justify-center">
        {n}
      </span>
      <div className="text-left">
        <div className="font-medium text-ink">{title}</div>
        <div className="text-sm text-ink/60">{desc}</div>
      </div>
    </li>
  );
}

// ---------- 视图: 加载模型 ----------

function LoadingModelView({ progress }: { progress: number }) {
  return (
    <div>
      <div className="text-4xl mb-4 animate-pulse">💄</div>
      <p className="text-lg text-ink mb-4">正在准备化妆台...</p>
      <div className="w-full h-2 bg-secondary/40 rounded-full overflow-hidden">
        <div
          className="h-full bg-accent transition-all duration-300"
          style={{ width: `${Math.round(progress * 100)}%` }}
        />
      </div>
      <p className="text-xs text-ink/50 mt-2">{Math.round(progress * 100)}%</p>
    </div>
  );
}

// ---------- 视图: 待分析 ----------

function ReadyView({
  previewUrl,
  onRetake,
  onAnalyze,
}: {
  previewUrl: string;
  onRetake: () => void;
  onAnalyze: () => void;
}) {
  return (
    <div>
      <img
        src={previewUrl}
        alt="自拍预览"
        className="mx-auto rounded-2xl max-h-80 object-contain shadow-soft mb-6"
      />
      <div className="flex flex-col sm:flex-row gap-3 justify-center">
        <button
          type="button"
          onClick={onAnalyze}
          className="bg-gradient-to-r from-primary to-accent text-white font-medium px-6 py-3 rounded-full shadow-soft"
        >
          开始分析 ✨
        </button>
        <button
          type="button"
          onClick={onRetake}
          className="bg-white border-2 border-primary text-accent hover:bg-secondary/30 font-medium px-6 py-3 rounded-full"
        >
          重选一张
        </button>
      </div>
    </div>
  );
}

// ---------- 视图: 分析中 ----------

function AnalyzingView() {
  return (
    <div>
      <div className="text-4xl mb-4 animate-spin">🪞</div>
      <p className="text-lg text-ink">正在分析你的五官...</p>
    </div>
  );
}

// ---------- 视图: 分析完成 (T6 完善后会更详细) ----------

function AnalysisDoneView({ features }: { features: FaceFeatures }) {
  return (
    <div className="text-left">
      <h2 className="text-xl font-semibold text-ink mb-3">分析完成</h2>
      <dl className="text-sm space-y-1 text-ink/80">
        <Row k="脸型" v={features.faceShape} />
        <Row k="肤色" v={features.skinTone} />
        <Row k="眼型" v={features.eyeType} />
        <Row k="鼻型" v={features.noseType} />
        <Row k="三庭" v={`${features.upperThirdRatio.toFixed(2)} / ${features.middleThirdRatio.toFixed(2)} / ${features.lowerThirdRatio.toFixed(2)}`} />
        <Row k="五眼" v={features.fiveEyeFit.toFixed(2)} />
        <Row k="置信度" v={features.confidence.toFixed(2)} />
      </dl>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between border-b border-secondary/40 py-1">
      <dt className="text-ink/60">{k}</dt>
      <dd className="font-medium text-ink">{v}</dd>
    </div>
  );
}

// ---------- 视图: 错误 ----------

function ErrorView({
  message,
  recoverable,
  onRetry,
}: {
  message: string;
  recoverable: boolean;
  onRetry: () => void;
}) {
  return (
    <div>
      <div className="text-4xl mb-4">🥺</div>
      <p className="text-lg text-ink mb-4">{message}</p>
      {recoverable && (
        <button
          type="button"
          onClick={onRetry}
          className="bg-accent text-white font-medium px-6 py-3 rounded-full shadow-soft"
        >
          再试一次
        </button>
      )}
    </div>
  );
}

// ---------- 视图: 占位 (后续 task 填充) ----------

function ComingSoonView({ stage }: { stage: string }) {
  return (
    <div>
      <div className="text-4xl mb-4">🚧</div>
      <p className="text-lg text-ink mb-2">即将上线</p>
      <p className="text-sm text-ink/60">当前阶段: {stage}</p>
    </div>
  );
}

export default App;
