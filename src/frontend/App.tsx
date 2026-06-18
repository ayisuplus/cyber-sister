// 妆语 - 主应用入口
// 状态机: idle → loading_model → ready → analyzing → analysis_done
//        → recommending → looks_ready → tutorial_step → tutorial_done → result / error
// 视觉层: 新拟态 + 毛玻璃 + 粉系调色板,移动端优先 (max-width: 430px)

import { useEffect, useReducer, useRef, useState, type ChangeEvent } from 'react';
import type { FaceFeatures, MakeupLook, MakeupStep } from '../shared/types';
import { loadModel } from './face/loader';
import { extractLandmarks, NoFaceError, type LandmarkPoint } from './face/landmarks';
import { analyzeFeatures, type Landmark } from '../shared/faceFeatures';
import { track, startTimer } from '../shared/analytics';
import MakeupCanvas from './tutorial/MakeupCanvas';
import TutorialPanel from './tutorial/TutorialPanel';
import ResultCard from './result/ResultCard';

// ---------- 状态机 ----------

type AppState =
  | { stage: 'idle' }
  | { stage: 'loading_model'; progress: number }
  | {
      stage: 'ready';
      imageData: ImageData;
      previewUrl: string;
      imageWidth: number;
      imageHeight: number;
    }
  | { stage: 'analyzing' }
  | { stage: 'analysis_done'; features: FaceFeatures; warnings: string[] }
  | { stage: 'recommending' }
  | { stage: 'looks_ready'; looks: MakeupLook[]; selected: number }
  | {
      stage: 'tutorial_step';
      look: MakeupLook;
      stepIndex: number;
      previewUrl: string;
      imageWidth: number;
      imageHeight: number;
    }
  | { stage: 'tutorial_done'; look: MakeupLook }
  | { stage: 'result'; look: MakeupLook; features: FaceFeatures }
  | { stage: 'error'; message: string; recoverable: boolean };

type Action =
  | { type: 'START_LOAD_MODEL' }
  | { type: 'MODEL_PROGRESS'; progress: number }
  | { type: 'MODEL_READY'; imageData: ImageData; previewUrl: string; imageWidth: number; imageHeight: number }
  | { type: 'START_ANALYZE' }
  | { type: 'ANALYSIS_DONE'; features: FaceFeatures; warnings: string[] }
  | { type: 'START_RECOMMEND' }
  | { type: 'LOOKS_READY'; looks: MakeupLook[]; selected: number }
  | { type: 'SELECT_LOOK'; index: number }
  | { type: 'START_TUTORIAL'; previewUrl: string; imageWidth: number; imageHeight: number }
  | { type: 'NEXT_STEP' }
  | { type: 'PREV_STEP' }
  | { type: 'GOTO_STEP'; index: number }
  | { type: 'TUTORIAL_DONE' }
  | { type: 'ENTER_RESULT'; look: MakeupLook; features: FaceFeatures }
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
      return {
        stage: 'ready',
        imageData: action.imageData,
        previewUrl: action.previewUrl,
        imageWidth: action.imageWidth,
        imageHeight: action.imageHeight,
      };
    case 'START_ANALYZE':
      return { stage: 'analyzing' };
    case 'ANALYSIS_DONE':
      return {
        stage: 'analysis_done',
        features: action.features,
        warnings: action.warnings,
      };
    case 'START_RECOMMEND':
      return { stage: 'recommending' };
    case 'LOOKS_READY':
      return { stage: 'looks_ready', looks: action.looks, selected: action.selected };
    case 'SELECT_LOOK':
      if (state.stage !== 'looks_ready') return state;
      return { ...state, selected: action.index };
    case 'START_TUTORIAL':
      if (state.stage !== 'looks_ready') return state;
      return {
        stage: 'tutorial_step',
        look: state.looks[state.selected]!,
        stepIndex: 0,
        previewUrl: action.previewUrl,
        imageWidth: action.imageWidth,
        imageHeight: action.imageHeight,
      };
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
    case 'ENTER_RESULT':
      return { stage: 'result', look: action.look, features: action.features };
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
const MAX_FILE_SIZE = 10 * 1024 * 1024;

// ---------- 装饰: 浮动光球 ----------

function FloatingOrbs() {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden>
      <div
        className="float-orb animate-orb-a"
        style={{ width: 280, height: 280, top: '-80px', left: '-60px' }}
      />
      <div
        className="float-orb animate-orb-b"
        style={{ width: 220, height: 220, bottom: '-40px', right: '-50px' }}
      />
      <div
        className="float-orb animate-orb-c"
        style={{ width: 160, height: 160, top: '40%', right: '-30px' }}
      />
    </div>
  );
}

// ---------- 主组件 ----------

function App() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const imageDataRef = useRef<ImageData | null>(null);
  const landmarksRef = useRef<Landmark[] | null>(null);
  const featuresRef = useRef<FaceFeatures | null>(null);
  const tutorialStartRef = useRef<number | null>(null);
  // 跨阶段保留 ready 的图片信息 (previewUrl/尺寸),tutorial 阶段需要用
  const previewUrlRef = useRef<string>('');
  const imageSizeRef = useRef<{ width: number; height: number }>({ width: 0, height: 0 });

  // app_open
  useEffect(() => {
    track('app_open');
  }, []);

  // analyzing 阶段
  useEffect(() => {
    if (state.stage !== 'analyzing') return;
    const imageData = imageDataRef.current;
    if (!imageData) {
      dispatch({ type: 'ERROR', message: '图片数据丢失，请重新上传', recoverable: true });
      return;
    }
    const elapsed = startTimer();
    let cancelled = false;
    (async () => {
      try {
        const landmarker = await loadModel(() => {});
        // 用普通 HTMLCanvasElement,MediaPipe 的 detect 接受 HTMLCanvasElement
        // (OffscreenCanvas 不在签名里,会被 TS 6.0 拒)
        const canvas = document.createElement('canvas');
        canvas.width = imageData.width;
        canvas.height = imageData.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Canvas 2D context unavailable');
        ctx.putImageData(imageData, 0, 0);
        const landmarkPoints: LandmarkPoint[] = extractLandmarks(landmarker, canvas);
        if (cancelled) return;
        const features = analyzeFeatures(landmarkPoints, {
          data: imageData.data,
          width: imageData.width,
          height: imageData.height,
        });
        if (cancelled) return;
        landmarksRef.current = landmarkPoints as unknown as Landmark[];
        featuresRef.current = features;
        const warnings: string[] =
          features.confidence < 0.5 ? ['照片质量一般，分析结果仅供参考'] : [];
        track('analysis_complete', {
          confidence: features.confidence,
          duration_ms: elapsed(),
        });
        track('selfie_diagnosis', {
          confidence: features.confidence,
          warnings: warnings.length,
        });
        dispatch({ type: 'ANALYSIS_DONE', features, warnings });
      } catch (err) {
        if (cancelled) return;
        if (err instanceof NoFaceError) {
          dispatch({ type: 'ERROR', message: '请上传清晰的正面照 📷', recoverable: true });
        } else if (err instanceof Error) {
          dispatch({ type: 'ERROR', message: `分析失败：${err.message}`, recoverable: true });
        } else {
          dispatch({ type: 'ERROR', message: '分析失败，稍后再试', recoverable: true });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [state.stage]);

  // analysis_done → recommending 自动跳
  useEffect(() => {
    if (state.stage !== 'analysis_done') return;
    const features = featuresRef.current;
    if (!features) return;
    dispatch({ type: 'START_RECOMMEND' });
    const ctrl = new AbortController();
    (async () => {
      try {
        const res = await fetch('/api/recommend', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(features),
          signal: ctrl.signal,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { looks: MakeupLook[] };
        track('recommend_view', { count: data.looks.length });
        dispatch({ type: 'LOOKS_READY', looks: data.looks, selected: 0 });
      } catch (err) {
        if (ctrl.signal.aborted) return;
        const msg = err instanceof Error ? `推荐失败：${err.message}` : '推荐失败';
        dispatch({ type: 'ERROR', message: msg, recoverable: true });
      }
    })();
    return () => ctrl.abort();
  }, [state.stage]);

  // tutorial_step 变化时埋点 + 启动计时
  useEffect(() => {
    if (state.stage !== 'tutorial_step') return;
    const step: MakeupStep | undefined = state.look.steps[state.stepIndex];
    track('tutorial_step', {
      step_index: state.stepIndex,
      area: step?.area ?? 'unknown',
      look_id: state.look.id,
    });
    if (tutorialStartRef.current === null) {
      tutorialStartRef.current = Date.now();
    }
    // deps: 只在 narrow 后读 state.stepIndex/look,TS 6.0 严格模式下
    // 顶层 deps 数组不允许访问判别式属性,所以用三元式保持 narrow.
  }, [
    state.stage,
    state.stage === 'tutorial_step' ? state.stepIndex : 0,
    state.stage === 'tutorial_step' ? state.look.id : '',
  ]);

  // tutorial_done: 展示 1.8s "恭喜完成",再进 result
  useEffect(() => {
    if (state.stage !== 'tutorial_done') return;
    const currentLook = state.look;
    const elapsed = tutorialStartRef.current
      ? Date.now() - tutorialStartRef.current
      : 0;
    track('tutorial_complete', {
      look_id: currentLook.id,
      total_duration_ms: elapsed,
    });
    tutorialStartRef.current = null;
    const features = featuresRef.current;
    if (!features) {
      dispatch({ type: 'ERROR', message: '分析结果丢失', recoverable: true });
      return;
    }
    const t = setTimeout(() => {
      dispatch({ type: 'ENTER_RESULT', look: currentLook, features });
    }, 1800);
    return () => clearTimeout(t);
  }, [state.stage, state.stage === 'tutorial_done' ? state.look.id : '']);

  // ---------- 渲染 ----------

  return (
    <main className="app-shell">
      <FloatingOrbs />
      <section className="app-card animate-fade-up">
        <div className="card-glass p-6 sm:p-8">
          <header className="text-center mb-6">
            <h1 className="font-hand text-5xl text-primary">妆语</h1>
            <div className="mt-1 text-[10px] tracking-[0.4em] text-ink-soft/70">
              ZHUANG · YU
            </div>
          </header>

          {state.stage === 'idle' && <OnboardingView onImagePicked={onPick} />}
          {state.stage === 'loading_model' && <LoadingModelView progress={state.progress} />}
          {state.stage === 'ready' && (
            <ReadyView
              previewUrl={state.previewUrl}
              onRetake={() => {
                imageDataRef.current = null;
                landmarksRef.current = null;
                featuresRef.current = null;
                dispatch({ type: 'RESET' });
              }}
              onAnalyze={() => {
                imageDataRef.current = state.imageData;
                dispatch({ type: 'START_ANALYZE' });
              }}
            />
          )}
          {state.stage === 'analyzing' && <AnalyzingView />}
          {state.stage === 'analysis_done' && (
            <AnalysisDoneView
              features={state.features}
              warnings={state.warnings}
              onContinue={() => dispatch({ type: 'START_RECOMMEND' })}
            />
          )}
          {state.stage === 'recommending' && <RecommendingView />}
          {state.stage === 'looks_ready' && (
            <LooksReadyView
              looks={state.looks}
              selected={state.selected}
              onSelect={(i) => {
                track('look_select', { look_id: state.looks[i]?.id, index: i });
                dispatch({ type: 'SELECT_LOOK', index: i });
              }}
              onStart={() =>
                dispatch({
                  type: 'START_TUTORIAL',
                  previewUrl: previewUrlRef.current,
                  imageWidth: imageSizeRef.current.width,
                  imageHeight: imageSizeRef.current.height,
                })
              }
              onRetake={() => {
                imageDataRef.current = null;
                landmarksRef.current = null;
                featuresRef.current = null;
                dispatch({ type: 'RESET' });
              }}
            />
          )}
          {state.stage === 'tutorial_step' && (
            <TutorialView
              look={state.look}
              stepIndex={state.stepIndex}
              previewUrl={state.previewUrl}
              imageWidth={state.imageWidth}
              imageHeight={state.imageHeight}
              landmarks={landmarksRef.current}
              onPrev={() => dispatch({ type: 'PREV_STEP' })}
              onNext={() => dispatch({ type: 'NEXT_STEP' })}
              onRestart={() => {
                tutorialStartRef.current = Date.now();
                dispatch({ type: 'GOTO_STEP', index: 0 });
              }}
              onFinish={() => dispatch({ type: 'TUTORIAL_DONE' })}
            />
          )}
          {state.stage === 'tutorial_done' && (
            <TutorialDoneView lookName={state.look.name} />
          )}
          {state.stage === 'result' && (
            <ResultCard features={state.features} look={state.look} />
          )}
          {state.stage === 'error' && (
            <ErrorView
              message={state.message}
              recoverable={state.recoverable}
              onRetry={() => {
                imageDataRef.current = null;
                landmarksRef.current = null;
                featuresRef.current = null;
                dispatch({ type: 'RESET' });
              }}
            />
          )}
        </div>
      </section>
    </main>
  );

  // 选图
  function onPick(file: File) {
    track('upload_start', { size: file.size, type: file.type });
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        URL.revokeObjectURL(url);
        dispatch({ type: 'ERROR', message: '浏览器不支持画布', recoverable: false });
        return;
      }
      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const t = startTimer();
      dispatch({ type: 'START_LOAD_MODEL' });
      loadModel((p) => dispatch({ type: 'MODEL_PROGRESS', progress: p }))
        .then(() => {
          track('model_load', { duration_ms: t() });
          // 把图片信息存到 ref,跨阶段供 tutorial 使用
          previewUrlRef.current = url;
          imageSizeRef.current = { width: img.naturalWidth, height: img.naturalHeight };
          dispatch({
            type: 'MODEL_READY',
            imageData,
            previewUrl: url,
            imageWidth: img.naturalWidth,
            imageHeight: img.naturalHeight,
          });
        })
        .catch((err) => {
          URL.revokeObjectURL(url);
          track('model_load_fail', { error: err instanceof Error ? err.message : 'unknown' });
          const msg =
            err instanceof Error ? `模型加载失败：${err.message}` : '模型加载失败';
          dispatch({ type: 'ERROR', message: msg, recoverable: true });
        });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      track('upload_reject', { reason: 'image_load_failed' });
      dispatch({ type: 'ERROR', message: '图片加载失败，请换一张试试', recoverable: true });
    };
    img.src = url;
  }
}

// ---------- 视图: 引导页 ----------

function OnboardingView({ onImagePicked }: { onImagePicked: (file: File) => void }) {
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  function pick(file: File | undefined) {
    if (!file) return;
    if (file.size > MAX_FILE_SIZE) {
      track('upload_reject', { reason: 'too_large', size: file.size });
      setError('图片太大啦，换个 10MB 以内的吧～');
      return;
    }
    const ok =
      file.type === 'image/jpeg' ||
      file.type === 'image/jpg' ||
      file.type === 'image/png' ||
      file.type === 'image/webp' ||
      /\.(jpe?g|png|webp)$/i.test(file.name);
    if (!ok) {
      track('upload_reject', { reason: 'wrong_type', type: file.type });
      setError('只支持 JPG / PNG / WebP 哦');
      return;
    }
    setError(null);
    onImagePicked(file);
  }

  function onChange(e: ChangeEvent<HTMLInputElement>) {
    pick(e.target.files?.[0]);
    e.target.value = '';
  }

  return (
    <div>
      {/* Hero */}
      <div className="text-center mb-8">
        <div className="inline-flex chip-rose-solid mb-4 animate-pulse-soft">
          ✨ AI 智能美妆
        </div>
        <h2 className="font-serif text-[28px] sm:text-[32px] font-bold text-ink leading-tight">
          找到最适合你的妆容
        </h2>
        <p className="text-ink-soft/80 mt-2 text-sm">
          三步拥有你的专属妆容方案
        </p>
      </div>

      {/* 三步骤预览 */}
      <ol className="space-y-4 mb-8">
        <Step
          n={1}
          title="拍一张正面照"
          desc="光线充足、表情自然，效果最好"
        />
        <Step
          n={2}
          title="AI 分析你的脸型"
          desc="三庭五眼、肤色、轮廓，一键读取"
        />
        <Step
          n={3}
          title="手把手教你画"
          desc="从底妆到唇色，跟着步骤一步步来"
        />
      </ol>

      {/* 上传按钮 */}
      <div className="space-y-3">
        <button
          type="button"
          onClick={() => cameraRef.current?.click()}
          className="btn-primary w-full flex items-center justify-center gap-2"
        >
          <span>📷</span>
          <span>开始拍照</span>
        </button>
        <button
          type="button"
          onClick={() => galleryRef.current?.click()}
          className="btn-secondary w-full flex items-center justify-center gap-2"
        >
          <span>🖼️</span>
          <span>从相册选择</span>
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

      {error && (
        <p className="mt-4 text-sm text-primary text-center bg-primary/10 rounded-2xl py-2">
          {error}
        </p>
      )}

      <p className="mt-6 text-xs text-ink-soft/60 text-center">
        🔒 图片仅在浏览器内分析，不会上传到服务器
      </p>
    </div>
  );
}

function Step({ n, title, desc }: { n: number; title: string; desc: string }) {
  return (
    <li className="flex items-start gap-3 relative">
      <div className="relative">
        <span className="step-num">{n}</span>
      </div>
      <div className="pt-1">
        <div className="font-semibold text-ink">{title}</div>
        <div className="text-sm text-ink-soft/70 mt-0.5">{desc}</div>
      </div>
      {n < 3 && (
        <div
          className="absolute left-[1.2rem] top-[2.5rem] bottom-[-1rem] w-px border-l-2 border-dashed"
          style={{ borderColor: 'rgba(200,107,119,0.25)' }}
        />
      )}
    </li>
  );
}

function LoadingModelView({ progress }: { progress: number }) {
  return (
    <div className="py-10 text-center">
      <div className="relative w-24 h-24 mx-auto mb-6">
        <div className="absolute inset-0 rounded-full bg-gradient-to-br from-primary-soft to-primary animate-pulse-soft" />
        <div className="absolute inset-2 rounded-full bg-white/80 backdrop-blur flex items-center justify-center text-3xl">
          💄
        </div>
        <div
          className="absolute inset-0 rounded-full border-2 border-dashed animate-spin-slow"
          style={{ borderColor: 'rgba(200,107,119,0.3)' }}
        />
      </div>
      <p className="font-serif text-xl text-ink mb-2">正在准备化妆台…</p>
      <p className="text-xs text-ink-soft/60 mb-6">首次加载会下载 AI 模型,请稍等</p>
      <div className="progress-track">
        <div
          className="progress-fill"
          style={{ width: `${Math.round(progress * 100)}%` }}
        />
      </div>
      <p className="text-xs text-primary mt-2 font-medium">
        {Math.round(progress * 100)}%
      </p>
    </div>
  );
}

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
      <div className="text-center mb-4">
        <h2 className="font-serif text-xl text-ink">确认这张照片 ✨</h2>
        <p className="text-sm text-ink-soft/70 mt-1">光线清晰、脸部可见,效果更好</p>
      </div>
      <div className="relative mb-6">
        <div className="card-soft p-2 inline-block w-full">
          <img
            src={previewUrl}
            alt="自拍预览"
            className="mx-auto rounded-[20px] max-h-80 w-full object-contain"
          />
        </div>
      </div>
      <div className="space-y-3">
        <button
          type="button"
          onClick={onAnalyze}
          className="btn-primary w-full flex items-center justify-center gap-2"
        >
          <span>开始分析</span>
          <span>✨</span>
        </button>
        <button
          type="button"
          onClick={onRetake}
          className="btn-secondary w-full"
        >
          重选一张
        </button>
      </div>
    </div>
  );
}

function AnalyzingView() {
  return (
    <div className="py-12 text-center">
      <div className="relative w-24 h-24 mx-auto mb-6">
        <div
          className="absolute inset-0 rounded-full animate-spin-slow"
          style={{
            background:
              'conic-gradient(from 0deg, #EAB6BC, #C86B77, #EAB6BC)',
            mask: 'radial-gradient(circle, transparent 55%, black 56%)',
            WebkitMask: 'radial-gradient(circle, transparent 55%, black 56%)',
          }}
        />
        <div className="absolute inset-2 rounded-full bg-white/80 backdrop-blur flex items-center justify-center text-3xl">
          🪞
        </div>
      </div>
      <p className="font-serif text-xl text-ink">正在分析你的五官…</p>
      <p className="text-xs text-ink-soft/60 mt-2">AI 在仔细看每一处细节</p>
    </div>
  );
}

function AnalysisDoneView({
  features,
  warnings,
  onContinue,
}: {
  features: FaceFeatures;
  warnings: string[];
  onContinue: () => void;
}) {
  return (
    <div className="text-left">
      <div className="text-center mb-5">
        <div className="inline-flex chip-rose-solid mb-2">✨ 分析完成</div>
        <h2 className="font-serif text-2xl font-bold text-ink">你的专属脸型报告</h2>
      </div>

      <div className="card-soft p-5 mb-4">
        <div className="grid grid-cols-2 gap-3">
          <FeatureChip label="脸型" value={cnFaceShape(features.faceShape)} color="rose" />
          <FeatureChip label="肤色" value={cnSkinTone(features.skinTone)} color="pink" />
          <FeatureChip label="眼型" value={cnEyeType(features.eyeType)} color="rose" />
          <FeatureChip label="鼻型" value={features.noseType} color="pink" />
        </div>

        <div className="mt-4 pt-4 border-t border-dashed" style={{ borderColor: 'rgba(200,107,119,0.2)' }}>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div>
              <div className="text-[10px] text-ink-soft/60">上庭</div>
              <div className="font-semibold text-primary">
                {features.upperThirdRatio.toFixed(2)}
              </div>
            </div>
            <div>
              <div className="text-[10px] text-ink-soft/60">中庭</div>
              <div className="font-semibold text-primary">
                {features.middleThirdRatio.toFixed(2)}
              </div>
            </div>
            <div>
              <div className="text-[10px] text-ink-soft/60">下庭</div>
              <div className="font-semibold text-primary">
                {features.lowerThirdRatio.toFixed(2)}
              </div>
            </div>
          </div>
          <div className="mt-3 flex justify-between text-xs text-ink-soft/70">
            <span>五眼比例: {features.fiveEyeFit.toFixed(2)}</span>
            <span>置信度: {features.confidence.toFixed(2)}</span>
          </div>
        </div>
      </div>

      {warnings.length > 0 && (
        <div className="rounded-2xl p-3 mb-4 space-y-1" style={{ background: 'rgba(234,182,188,0.2)' }}>
          {warnings.map((w, i) => (
            <div key={i} className="text-xs text-primary-deep">
              ⚠️ {w}
            </div>
          ))}
        </div>
      )}

      <button
        type="button"
        onClick={onContinue}
        className="btn-primary w-full"
      >
        查看推荐妆容 →
      </button>
    </div>
  );
}

function FeatureChip({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color: 'rose' | 'pink';
}) {
  return (
    <div
      className="rounded-2xl p-3"
      style={{
        background:
          color === 'rose'
            ? 'linear-gradient(135deg, rgba(253,242,243,0.9), rgba(234,182,188,0.4))'
            : 'linear-gradient(135deg, rgba(234,182,188,0.25), rgba(200,107,119,0.15))',
        border: '1px solid rgba(234,182,188,0.4)',
      }}
    >
      <div className="text-[10px] text-ink-soft/60 uppercase tracking-wide">
        {label}
      </div>
      <div className="font-semibold text-primary text-sm mt-0.5">{value}</div>
    </div>
  );
}

function RecommendingView() {
  return (
    <div className="py-12 text-center">
      <div className="relative w-24 h-24 mx-auto mb-6">
        <div
          className="absolute inset-0 rounded-full animate-spin-slow"
          style={{
            background:
              'conic-gradient(from 0deg, #C86B77, #EAB6BC, #C86B77)',
            mask: 'radial-gradient(circle, transparent 55%, black 56%)',
            WebkitMask: 'radial-gradient(circle, transparent 55%, black 56%)',
          }}
        />
        <div className="absolute inset-2 rounded-full bg-white/80 backdrop-blur flex items-center justify-center text-3xl">
          🌸
        </div>
      </div>
      <p className="font-serif text-xl text-ink">正在为你挑选妆容…</p>
      <p className="text-xs text-ink-soft/60 mt-2">根据你的脸型匹配最合适的风格</p>
    </div>
  );
}

function LooksReadyView({
  looks,
  selected,
  onSelect,
  onStart,
  onRetake,
}: {
  looks: MakeupLook[];
  selected: number;
  onSelect: (i: number) => void;
  onStart: () => void;
  onRetake: () => void;
}) {
  return (
    <div>
      <div className="text-center mb-5">
        <div className="inline-flex chip-rose-solid mb-2">💄 为你推荐</div>
        <h2 className="font-serif text-2xl font-bold text-ink">3 套妆容方案</h2>
        <p className="text-xs text-ink-soft/60 mt-1">横向滑动浏览 · 点击选择</p>
      </div>

      <div className="flex gap-3 overflow-x-auto no-scrollbar pb-2 -mx-2 px-2 mb-5">
        {looks.map((look, i) => (
          <LookCard
            key={look.id}
            look={look}
            selected={i === selected}
            onClick={() => onSelect(i)}
          />
        ))}
      </div>

      <div className="flex gap-2 mb-3">
        {looks.map((_, i) => (
          <div
            key={i}
            className="h-1.5 rounded-full transition-all"
            style={{
              width: i === selected ? 24 : 6,
              background:
                i === selected
                  ? 'linear-gradient(90deg,#EAB6BC,#C86B77)'
                  : 'rgba(234,182,188,0.4)',
            }}
          />
        ))}
      </div>

      <div className="space-y-2">
        <button
          type="button"
          onClick={onStart}
          className="btn-primary w-full"
        >
          开始跟妆教程 →
        </button>
        <button
          type="button"
          onClick={onRetake}
          className="btn-secondary w-full text-sm py-2"
        >
          换一张照片
        </button>
      </div>
    </div>
  );
}

function LookCard({
  look,
  selected,
  onClick,
}: {
  look: MakeupLook;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-left flex-shrink-0 w-[260px] rounded-3xl p-4 transition-all"
      style={{
        background: selected
          ? 'linear-gradient(135deg,#FFFFFF,#FDF2F3)'
          : 'rgba(255,255,255,0.6)',
        border: selected
          ? '2px solid #C86B77'
          : '1.5px solid rgba(234,182,188,0.4)',
        boxShadow: selected
          ? '0 12px 32px rgba(200,107,119,0.18)'
          : '0 4px 12px rgba(200,107,119,0.06)',
        transform: selected ? 'translateY(-2px)' : 'none',
        backdropFilter: 'blur(12px)',
      }}
    >
      <div className="flex items-center gap-2 mb-2">
        <div
          className="w-10 h-10 rounded-2xl flex items-center justify-center text-lg"
          style={{
            background: 'linear-gradient(135deg,#EAB6BC,#C86B77)',
            boxShadow: '0 4px 12px rgba(200,107,119,0.3)',
          }}
        >
          💄
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-serif font-bold text-ink truncate">{look.name}</div>
          <div className="chip-tag mt-1">{look.scenario}</div>
        </div>
        {selected && (
          <div className="w-6 h-6 rounded-full bg-primary text-white flex items-center justify-center text-xs">
            ✓
          </div>
        )}
      </div>
      <p className="text-sm text-ink-soft/80 leading-relaxed mt-2 line-clamp-3">
        {look.reason}
      </p>
    </button>
  );
}

function TutorialView({
  look,
  stepIndex,
  previewUrl,
  imageWidth,
  imageHeight,
  landmarks,
  onPrev,
  onNext,
  onRestart,
  onFinish,
}: {
  look: MakeupLook;
  stepIndex: number;
  previewUrl: string;
  imageWidth: number;
  imageHeight: number;
  landmarks: Landmark[] | null;
  onPrev: () => void;
  onNext: () => void;
  onRestart: () => void;
  onFinish: () => void;
}) {
  const step = look.steps[stepIndex];
  return (
    <div className="space-y-4">
      {landmarks && landmarks.length === 478 ? (
        <div className="card-soft p-2">
          <MakeupCanvas
            imageSrc={previewUrl}
            imageWidth={imageWidth}
            imageHeight={imageHeight}
            landmarks={landmarks}
            currentZones={step?.overlayZones ?? []}
            brushDirection={step?.brushDirection}
          />
        </div>
      ) : (
        <div className="w-full h-64 card-soft flex items-center justify-center text-ink-soft/60 text-sm">
          关键点不可用，分区预览略过
        </div>
      )}
      <TutorialPanel
        look={look}
        stepIndex={stepIndex}
        onPrev={onPrev}
        onNext={onNext}
        onRestart={onRestart}
        onFinish={onFinish}
      />
    </div>
  );
}

function TutorialDoneView({ lookName }: { lookName: string }) {
  return (
    <div className="py-12 text-center">
      <div
        className="w-20 h-20 rounded-full mx-auto mb-5 flex items-center justify-center text-4xl animate-glow"
        style={{ background: 'linear-gradient(135deg,#EAB6BC,#C86B77)' }}
      >
        🎉
      </div>
      <h2 className="font-serif text-2xl font-bold text-ink mb-2">
        恭喜完成 {lookName}！
      </h2>
      <p className="text-ink-soft/70">正在准备你的专属分享卡…</p>
      <div className="mt-6 mx-auto w-32 progress-track">
        <div
          className="progress-fill animate-shimmer"
          style={{
            background:
              'linear-gradient(90deg,#EAB6BC 0%,#C86B77 50%,#EAB6BC 100%)',
            backgroundSize: '200% 100%',
            width: '100%',
          }}
        />
      </div>
    </div>
  );
}

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
    <div className="py-10 text-center">
      <div
        className="w-20 h-20 rounded-full mx-auto mb-5 flex items-center justify-center text-4xl"
        style={{ background: 'rgba(234,182,188,0.4)' }}
      >
        🥺
      </div>
      <p className="font-serif text-lg text-ink mb-6 px-4">{message}</p>
      {recoverable && (
        <button
          type="button"
          onClick={onRetry}
          className="btn-primary"
        >
          再试一次
        </button>
      )}
    </div>
  );
}

function cnFaceShape(s: string): string {
  return (
    ({
      oval: '椭圆脸',
      round: '圆脸',
      square: '方脸',
      heart: '心形脸',
      long: '长脸',
      diamond: '菱形脸',
    } as Record<string, string>)[s] ?? s
  );
}
function cnSkinTone(s: string): string {
  return (
    ({
      cool_fair: '冷白皮',
      cool_medium: '冷黄一白',
      neutral_fair: '中性一白',
      neutral_medium: '中性二白',
      warm_fair: '暖白皮',
      warm_medium: '暖黄一白',
      warm_deep: '暖黄二白',
      warm_deep_dark: '暖深色',
    } as Record<string, string>)[s] ?? s
  );
}
function cnEyeType(s: string): string {
  return (
    ({
      almond: '杏眼',
      round: '圆眼',
      hooded: '肿泡眼',
      monolid: '单眼皮',
      downturned: '下垂眼',
      upturned: '上挑眼',
      close_set: '眼距近',
      wide_set: '眼距远',
    } as Record<string, string>)[s] ?? s
  );
}

export default App;
