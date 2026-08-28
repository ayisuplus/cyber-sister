// MediaPipe FaceLandmarker singleton loader.
// 模型文件从 /mp-models/ 本地加载,避免 Google CDN 在国内访问慢.
// delegate 默认 GPU,设备不支持时降级 CPU (MediaPipe 内部 try/catch 自动处理).

import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

let landmarker: FaceLandmarker | null = null;
let loadPromise: Promise<FaceLandmarker> | null = null;

const WASM_PATH = '/mp-models/wasm';
const MODEL_PATH = '/mp-models/face_landmarker.task';

/**
 * 加载 MediaPipe FaceLandmarker,首次加载后复用单例.
 * @param onProgress 进度回调,值域 0..1
 * @throws 模型加载失败时抛出原始错误 (网络/WASM 不支持等)
 */
export async function loadModel(onProgress: (pct: number) => void): Promise<FaceLandmarker> {
  if (landmarker) {
    onProgress(1);
    return landmarker;
  }
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    try {
      onProgress(0.05);
      const vision = await FilesetResolver.forVisionTasks(WASM_PATH);
      onProgress(0.5);

      landmarker = await FaceLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: MODEL_PATH,
          delegate: 'GPU',
        },
        runningMode: 'IMAGE',
        numFaces: 3, // 多人脸时取最大,这里给 3 留余量
        outputFaceBlendshapes: false,
        outputFacialTransformationMatrixes: false,
      });
      onProgress(1);
      return landmarker;
    } catch (err) {
      // GPU 失败常见于 iOS Safari/部分 Android. 降级 CPU 重试一次.
      const isGpuError = err instanceof Error && /gpu|webgl/i.test(err.message);
      if (isGpuError && landmarker === null) {
        loadPromise = null;
        onProgress(0.05);
        const vision = await FilesetResolver.forVisionTasks(WASM_PATH);
        onProgress(0.5);
        landmarker = await FaceLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: MODEL_PATH,
            delegate: 'CPU',
          },
          runningMode: 'IMAGE',
          numFaces: 3,
          outputFaceBlendshapes: false,
          outputFacialTransformationMatrixes: false,
        });
        onProgress(1);
        return landmarker;
      }
      loadPromise = null;
      throw err;
    }
  })();

  return loadPromise;
}

/** 释放单例 (测试用). */
export function disposeModel(): void {
  landmarker?.close();
  landmarker = null;
  loadPromise = null;
}
