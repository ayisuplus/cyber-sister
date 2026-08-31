// AI 妆教（赛博姐妹）- 主应用入口
// 状态机: idle → loading_model → ready → analyzing → analysis_done
//        → recommending → looks_ready → tutorial_step → tutorial_done → result / error
// 视觉层: 新拟态 + 毛玻璃 + 粉系调色板,移动端优先 (max-width: 430px)

import { useEffect, useReducer, useRef, useState, Suspense, lazy } from 'react';
import type { FaceFeatures, MakeupLook } from '../shared/types';
import { loadModel } from './face/loader';
import {
  extractAllLandmarks,
  NoFaceError,
  toSharedLandmarks,
  type LandmarkPoint,
} from './face/landmarks';
import { analyzeFeatures } from '../shared/faceFeatures';
import { diagnoseSelfie, readExifOrientation, applyExifToImageData } from './face/edgeCases';
import { track, startTimer } from '../shared/analytics';
import { useToast } from './components/Toast';
import { compressImage, blobToDataUrl } from './utils/image';
import { fetchJson } from './utils/fetch';
import { getMainAccessToken } from './utils/runtime';
import { reducer, initialState } from './state/appReducer';

import { FloatingOrbs } from './views/FloatingOrbs';
import { OnboardingView } from './views/OnboardingView';
import { LoadingModelView } from './views/LoadingModelView';
import { ReadyView } from './views/ReadyView';
import { AnalyzingView } from './views/AnalyzingView';
import { AnalysisDoneView } from './views/AnalysisDoneView';
import { RecommendingView } from './views/RecommendingView';
import { LooksReadyView } from './views/LooksReadyView';
import { TutorialView } from './views/TutorialView';
import { TutorialDoneView } from './views/TutorialDoneView';
import { SurveyView } from './views/SurveyView';
import { ErrorView } from './views/ErrorView';
import { ResourcesLoadingFallback, ResultLoadingFallback } from './views/fallbacks';

// 延迟加载重型组件 — 首次进入 result / 教学资源时才下载 + 解析.
const ResourcesView = lazy(
  () =>
    import(
      /* webpackChunkName: "resources-view", webpackPrefetch: true */ './resources/ResourcesView'
    ),
);
const ResultCard = lazy(() => import(/* webpackChunkName: "result-card" */ './result/ResultCard'));

export const EXPLAIN_REQUEST_TIMEOUT_MS = 70_000;

function App() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [explanation, setExplanation] = useState<{
    text: string;
    source: 'local_model' | 'qwen' | 'local_template';
  } | null>(null);
  const imageDataRef = useRef<ImageData | null>(null);
  const landmarksRef = useRef<ReturnType<typeof toSharedLandmarks> | null>(null);
  const featuresRef = useRef<FaceFeatures | null>(null);
  const tutorialStartRef = useRef<number | null>(null);
  // 跨阶段保留 ready 的图片信息 (previewUrl/尺寸),tutorial 阶段需要用
  const previewUrlRef = useRef<string>('');
  const imageSizeRef = useRef<{ width: number; height: number }>({ width: 0, height: 0 });
  const exifOrientationRef = useRef<number>(1);
  const toast = useToast();
  const selectedLookForExplanation =
    state.stage === 'looks_ready' ? state.looks[state.selected] : undefined;

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

        // 1) 一次性拿到所有人脸,diagnoseSelfie 需要所有脸 + 单张最大脸的 landmarks
        const allFaces = extractAllLandmarks(landmarker, canvas);
        if (cancelled) return;
        if (allFaces.length === 0) throw new NoFaceError();
        const largest = allFaces.reduce<LandmarkPoint[]>(
          (best, cur) => (cur.length > best.length ? cur : best),
          allFaces[0]!,
        );

        const features = analyzeFeatures(largest, {
          data: imageData.data,
          width: imageData.width,
          height: imageData.height,
        });
        if (cancelled) return;

        // 2) 诊断:暗光 / 模糊 / 戴眼镜 / 刘海 / 浓妆 / 偏转 → 友好文案警告
        const diagnosis = diagnoseSelfie({
          faces: allFaces.map(toSharedLandmarks),
          pixels: {
            data: imageData.data,
            width: imageData.width,
            height: imageData.height,
          },
          exifOrientation: exifOrientationRef.current,
          baseConfidence: features.confidence,
        });
        if (cancelled) return;
        if (diagnosis.blocked) {
          track('selfie_blocked', { reason: diagnosis.blockedReason ?? 'unknown' });
          dispatch({
            type: 'ERROR',
            message: diagnosis.blockedReason ?? '请上传清晰的正面照 📷',
            recoverable: true,
          });
          return;
        }

        landmarksRef.current = toSharedLandmarks(largest);
        featuresRef.current = features;
        track('analysis_complete', {
          confidence: features.confidence,
          duration_ms: elapsed(),
        });
        track('selfie_diagnosis', {
          confidence: features.confidence,
          warnings: diagnosis.warnings.length,
          skipped: diagnosis.skippedFeatures.length,
        });
        dispatch({ type: 'ANALYSIS_DONE', features, warnings: diagnosis.warnings });
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

  // 用户确认分析结果后进入 recommending，再请求确定性推荐。
  useEffect(() => {
    if (state.stage !== 'recommending') return;
    const features = featuresRef.current;
    if (!features) return;
    const ctrl = new AbortController();
    fetchJson<{ looks: MakeupLook[] }>('/api/recommend', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(features),
      signal: ctrl.signal,
      timeoutMs: 20_000,
      retries: 1,
    })
      .then((data) => {
        if (ctrl.signal.aborted) return;
        track('recommend_view', { count: data.looks.length });
        dispatch({ type: 'LOOKS_READY', looks: data.looks, selected: 0 });
      })
      .catch((err: unknown) => {
        if (ctrl.signal.aborted) return;
        const msg = err instanceof Error ? `推荐失败：${err.message}` : '推荐失败';
        toast.error(msg);
        dispatch({ type: 'ERROR', message: msg, recoverable: true });
      });
    return () => ctrl.abort();
  }, [state.stage, toast]);

  // 只发送规范化标签和 lookId；模型路由与外部回退授权由主 API 统一执行。
  useEffect(() => {
    if (state.stage !== 'looks_ready') return;
    const look = selectedLookForExplanation;
    const features = featuresRef.current;
    if (!look || !features) return;
    const ctrl = new AbortController();
    setExplanation(null);
    const token = getMainAccessToken();
    fetchJson<{
      explanation: string;
      source: 'local_model' | 'qwen' | 'local_template';
    }>('/api/explain', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        features: {
          faceShape: features.faceShape,
          skinTone: features.skinTone,
          eyeType: features.eyeType,
        },
        lookId: look.id,
      }),
      signal: ctrl.signal,
      timeoutMs: EXPLAIN_REQUEST_TIMEOUT_MS,
      retries: 0,
    })
      .then((result) => {
        if (!ctrl.signal.aborted) {
          setExplanation({ text: result.explanation, source: result.source });
        }
      })
      .catch(() => {
        if (!ctrl.signal.aborted) {
          setExplanation({
            text: Array.from(look.reason).slice(0, 50).join(''),
            source: 'local_template',
          });
        }
      });
    return () => ctrl.abort();
  }, [state.stage, selectedLookForExplanation]);

  // tutorial_step 变化时埋点 + 启动计时
  useEffect(() => {
    if (state.stage !== 'tutorial_step') return;
    const step = state.look.steps[state.stepIndex];
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    state.stage,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    state.stage === 'tutorial_step' ? state.stepIndex : 0,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    state.stage === 'tutorial_step' ? state.look.id : '',
  ]);

  // tutorial_done 只记录完成；进入总结必须由用户主动触发。
  useEffect(() => {
    if (state.stage !== 'tutorial_done') return;
    const currentLook = state.look;
    const elapsed = tutorialStartRef.current ? Date.now() - tutorialStartRef.current : 0;
    track('tutorial_complete', {
      look_id: currentLook.id,
      total_duration_ms: elapsed,
    });
    tutorialStartRef.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.stage, state.stage === 'tutorial_done' ? state.look.id : '']);

  function reset() {
    imageDataRef.current = null;
    landmarksRef.current = null;
    featuresRef.current = null;
    tutorialStartRef.current = null;
    previewUrlRef.current = '';
    imageSizeRef.current = { width: 0, height: 0 };
    exifOrientationRef.current = 1;
    setExplanation(null);
    dispatch({ type: 'RESET' });
  }

  // 选图 — 先压缩,再走原流程.
  function onPick(file: File) {
    track('upload_start', { size: file.size, type: file.type });
    dispatch({ type: 'START_LOAD_MODEL' });
    compressAndProcess(file).catch((err) => {
      const msg = err instanceof Error ? `图片处理失败：${err.message}` : '图片处理失败';
      track('image_process_fail', { error: msg });
      toast.error('图片处理失败,请换一张');
      dispatch({ type: 'ERROR', message: msg, recoverable: true });
    });
  }

  async function compressAndProcess(file: File): Promise<void> {
    // 0. 先读 EXIF orientation — 压缩后的 JPEG 会丢失 EXIF,必须在压缩前读取
    let orientation = 1;
    try {
      orientation = await readExifOrientation(file);
      exifOrientationRef.current = orientation;
    } catch (err) {
      track('exif_read_fail', { error: err instanceof Error ? err.message : 'unknown' });
    }

    // 1. 压缩(失败回退到原图)
    let processed: Blob = file;
    try {
      const compressed = await compressImage(file);
      if (compressed.size < file.size) {
        processed = compressed;
        track('image_compressed', {
          original: file.size,
          compressed: compressed.size,
          ratio: Math.round((compressed.size / file.size) * 100),
        });
      }
    } catch (err) {
      track('image_compress_fail', { error: err instanceof Error ? err.message : 'unknown' });
      // 压缩失败不影响主流程,继续用原图
    }
    // 2. 转 dataURL 给 MediaPipe + 预览
    const dataUrl = await blobToDataUrl(processed);
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('图片加载失败'));
      img.src = dataUrl;
    });

    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      dispatch({ type: 'ERROR', message: '浏览器不支持画布', recoverable: false });
      return;
    }
    ctx.drawImage(img, 0, 0);
    const rawImageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

    // 3. 应用 EXIF 旋转校正 — MediaPipe 与后续 Canvas 都基于校正后的方向
    let imageData = rawImageData;
    try {
      imageData = await applyExifToImageData(rawImageData, orientation);
    } catch (err) {
      track('exif_apply_fail', { error: err instanceof Error ? err.message : 'unknown' });
    }

    // 4. 如果发生了 EXIF 变换,重新生成预览图,保证预览方向正确
    let previewUrl = dataUrl;
    if (orientation && orientation !== 1) {
      const orientedCanvas = document.createElement('canvas');
      orientedCanvas.width = imageData.width;
      orientedCanvas.height = imageData.height;
      const oCtx = orientedCanvas.getContext('2d');
      if (oCtx) {
        oCtx.putImageData(imageData, 0, 0);
        previewUrl = orientedCanvas.toDataURL('image/jpeg', 0.92);
      }
    }

    const t = startTimer();
    try {
      await loadModel((p) => dispatch({ type: 'MODEL_PROGRESS', progress: p }));
      track('model_load', { duration_ms: t() });
      track('upload_success', { size: file.size, type: file.type });
      // 把图片信息存到 ref,跨阶段供 tutorial 使用
      previewUrlRef.current = previewUrl;
      imageSizeRef.current = { width: imageData.width, height: imageData.height };
      dispatch({
        type: 'MODEL_READY',
        imageData,
        previewUrl,
        imageWidth: imageData.width,
        imageHeight: imageData.height,
      });
    } catch (err) {
      track('model_load_fail', { error: err instanceof Error ? err.message : 'unknown' });
      const msg = err instanceof Error ? `模型加载失败：${err.message}` : '模型加载失败';
      toast.error(msg);
      dispatch({ type: 'ERROR', message: msg, recoverable: true });
    }
  }

  // ---------- 渲染 ----------

  return (
    <main className="app-shell">
      <FloatingOrbs />
      <section className="app-card animate-fade-up">
        <div className="card-glass p-6 sm:p-8">
          <header className="text-center mb-6">
            <a
              href="/tools"
              className="inline-flex min-h-[44px] items-center text-sm text-ink-soft/70 hover:text-primary"
            >
              ← 返回赛博姐妹
            </a>
            <h1 className="font-hand text-5xl text-primary">妆教</h1>
            <div className="mt-1 text-[10px] tracking-[0.4em] text-ink-soft/70">ZHUANG · JIAO</div>
          </header>

          {state.stage === 'idle' && <OnboardingView onImagePicked={onPick} />}
          {state.stage === 'loading_model' && <LoadingModelView progress={state.progress} />}
          {state.stage === 'ready' && (
            <ReadyView
              previewUrl={state.previewUrl}
              onRetake={reset}
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
              onSelect={(i) => dispatch({ type: 'SELECT_LOOK', index: i })}
              onStart={() =>
                dispatch({
                  type: 'START_TUTORIAL',
                  previewUrl: previewUrlRef.current,
                  imageWidth: imageSizeRef.current.width,
                  imageHeight: imageSizeRef.current.height,
                })
              }
              onRetake={reset}
              onOpenTeaching={(lookId) => dispatch({ type: 'OPEN_TEACHING_RESOURCES', lookId })}
              explanation={explanation}
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
            <TutorialDoneView
              look={state.look}
              features={featuresRef.current}
              onOpenSurvey={() => dispatch({ type: 'OPEN_SURVEY' })}
              onContinue={() => {
                const features = featuresRef.current;
                if (!features) {
                  dispatch({ type: 'ERROR', message: '分析结果丢失', recoverable: true });
                  return;
                }
                dispatch({ type: 'ENTER_RESULT', look: state.look, features });
              }}
            />
          )}
          {state.stage === 'survey' && (
            <SurveyView onClose={() => dispatch({ type: 'CLOSE_SURVEY' })} />
          )}
          {state.stage === 'result' && (
            <Suspense fallback={<ResultLoadingFallback />}>
              <ResultCard features={state.features} look={state.look} />
            </Suspense>
          )}
          {state.stage === 'teaching_resources' && (
            <Suspense fallback={<ResourcesLoadingFallback />}>
              <ResourcesView
                lookId={state.lookId}
                onBack={() => dispatch({ type: 'CLOSE_TEACHING_RESOURCES' })}
              />
            </Suspense>
          )}
          {state.stage === 'error' && (
            <ErrorView message={state.message} recoverable={state.recoverable} onRetry={reset} />
          )}
        </div>
      </section>
    </main>
  );
}

export default App;
