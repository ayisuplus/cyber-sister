// 妆语 - 主应用入口
// 状态机: idle → loading_model → ready → analyzing → analysis_done
//        → recommending → looks_ready → tutorial_step → tutorial_done → result / error

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
    <main className="min-h-screen flex items-center justify-center px-4 py-6">
      <section className="max-w-xl w-full bg-white rounded-card shadow-soft p-6 sm:p-8 text-center">
        <h1 className="font-hand text-5xl text-accent mb-4">妆语</h1>

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
      <h2 className="text-2xl font-semibold text-ink mb-2">找到最适合你的妆容</h2>
      <p className="text-ink/70 mb-8">三步拥有你的专属妆容方案</p>

      <ol className="space-y-4 text-left mb-8">
        <Step n={1} title="拍一张正面照" desc="光线充足、表情自然，效果最好" />
        <Step n={2} title="AI 分析你的脸型" desc="三庭五眼、肤色、轮廓，一键读取" />
        <Step n={3} title="手把手教你画" desc="从底妆到唇色，跟着步骤一步步来" />
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

      <p className="mt-6 text-xs text-ink/50">图片仅在浏览器内分析，不会上传到服务器</p>
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

function AnalyzingView() {
  return (
    <div>
      <div className="text-4xl mb-4 animate-spin">🪞</div>
      <p className="text-lg text-ink">正在分析你的五官...</p>
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
      <h2 className="text-xl font-semibold text-ink mb-3">分析完成 ✨</h2>
      <dl className="text-sm space-y-1 text-ink/80">
        <Row k="脸型" v={cnFaceShape(features.faceShape)} />
        <Row k="肤色" v={cnSkinTone(features.skinTone)} />
        <Row k="眼型" v={cnEyeType(features.eyeType)} />
        <Row k="鼻型" v={features.noseType} />
        <Row
          k="三庭"
          v={`${features.upperThirdRatio.toFixed(2)} / ${features.middleThirdRatio.toFixed(2)} / ${features.lowerThirdRatio.toFixed(2)}`}
        />
        <Row k="五眼" v={features.fiveEyeFit.toFixed(2)} />
        <Row k="置信度" v={features.confidence.toFixed(2)} />
      </dl>
      {warnings.length > 0 && (
        <ul className="mt-3 text-xs text-accent bg-accent/5 rounded-xl p-2 space-y-1">
          {warnings.map((w, i) => (
            <li key={i}>⚠️ {w}</li>
          ))}
        </ul>
      )}
      <button
        type="button"
        onClick={onContinue}
        className="mt-6 w-full bg-gradient-to-r from-primary to-accent text-white font-medium px-6 py-3 rounded-full shadow-soft"
      >
        查看推荐妆容 →
      </button>
    </div>
  );
}

function RecommendingView() {
  return (
    <div>
      <div className="text-4xl mb-4 animate-spin">🌸</div>
      <p className="text-lg text-ink">正在为你挑选妆容...</p>
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
      <h2 className="text-xl font-semibold text-ink mb-3 text-left">为你推荐 3 套妆容</h2>
      <div className="space-y-2 text-left">
        {looks.map((look, i) => (
          <button
            key={look.id}
            type="button"
            onClick={() => onSelect(i)}
            className={`w-full text-left p-3 rounded-2xl border-2 transition-colors ${
              i === selected
                ? 'border-accent bg-accent/5'
                : 'border-secondary/40 bg-white hover:border-accent/50'
            }`}
          >
            <div className="flex justify-between items-baseline">
              <span className="font-medium text-ink">{look.name}</span>
              <span className="text-xs text-ink/60">{look.scenario}</span>
            </div>
            <p className="text-sm text-ink/70 mt-1">{look.reason}</p>
          </button>
        ))}
      </div>
      <div className="mt-4 flex flex-col sm:flex-row gap-2">
        <button
          type="button"
          onClick={onRetake}
          className="bg-white border-2 border-primary text-accent hover:bg-secondary/30 font-medium px-4 py-2.5 rounded-full text-sm"
        >
          换一张
        </button>
        <button
          type="button"
          onClick={onStart}
          className="flex-1 bg-gradient-to-r from-primary to-accent text-white font-medium px-6 py-2.5 rounded-full shadow-soft"
        >
          开始跟妆教程 →
        </button>
      </div>
    </div>
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
    <div className="space-y-3">
      {landmarks && landmarks.length === 478 ? (
        <MakeupCanvas
          imageSrc={previewUrl}
          imageWidth={imageWidth}
          imageHeight={imageHeight}
          landmarks={landmarks}
          currentZones={step?.overlayZones ?? []}
          brushDirection={step?.brushDirection}
        />
      ) : (
        <div className="w-full h-64 bg-secondary/30 rounded-card flex items-center justify-center text-ink/50 text-sm">
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
    <div className="py-8">
      <div className="text-5xl mb-4">🎉</div>
      <h2 className="text-2xl font-semibold text-ink mb-2">恭喜完成 {lookName}！</h2>
      <p className="text-ink/70">正在准备你的专属分享卡...</p>
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

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between border-b border-secondary/40 py-1">
      <dt className="text-ink/60">{k}</dt>
      <dd className="font-medium text-ink">{v}</dd>
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
