# MediaPipe 模型文件

> 这里存放 MediaPipe FaceLandmarker 运行所需的 `.task` 模型 + WASM 文件,**不**走 Google CDN.

## 下载步骤

### 1. FaceLandmarker `.task` 模型 (≈ 4 MB)

到 [Google AI Edge 官方模型托管](https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task) 下载 `face_landmarker.task`,放到本目录:

```
public/mp-models/face_landmarker.task
```

### 2. WASM 文件 (≈ 8 MB)

到 `@mediapipe/tasks-vision` npm 包内的 `vision_bundle_web_dts` 目录,把 `wasm/` 子目录整个复制过来,或直接从 unpkg/jsdelivr 下载:

```bash
# 创建目录后用 curl 取 wasm 文件
mkdir -p public/mp-models/wasm
# 从 jsdelivr 拉 @mediapipe/tasks-vision 0.10.35 的 wasm
for f in vision_wasm_internal.js vision_wasm_internal.wasm vision_wasm_internal.worker.js; do
  curl -L -o public/mp-models/wasm/$f \
    https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm/$f
done
```

如果你 `pnpm install` 后,文件已经存在于:

```
node_modules/@mediapipe/tasks-vision/wasm/
```

直接复制过来即可:

```bash
# Windows PowerShell
Copy-Item -Recurse node_modules/@mediapipe/tasks-vision/wasm/* public/mp-models/wasm/
```

### 3. 目录结构 (完成后)

```
public/mp-models/
├── face_landmarker.task
├── README.md
└── wasm/
    ├── vision_wasm_internal.js
    ├── vision_wasm_internal.wasm
    └── vision_wasm_internal.worker.js
```

## 模型找不到时的行为

`src/frontend/face/loader.ts` 加载失败时:

- 网络错误 → 上层 catch 后进入 `error` 状态,提示"网络不太稳定,请刷新重试"
- 文件缺失 (404) → 同样的 error 状态
- GPU 不支持 → 自动降级到 CPU 重试一次
