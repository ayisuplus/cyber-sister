# MediaPipe 受控模型资产

MediaPipe `.task` 与 WASM 二进制不进入 Git，也不会在浏览器运行时下载。运维必须在构建前将已批准的文件按 `model-assets.lock.json` 的相对路径放到 `packages/makeup-skill/.assets/`。

正式构建会先执行 `pnpm --filter ai-makeup-tutor verify:model-assets`：逐个核对清单和 SHA-256，通过后才复制到本目录。文件缺失、摘要不匹配、清单占位值或越界路径都会使构建失败。

预期的受控源目录结构：

```
.assets/
├── face_landmarker.task
└── wasm/
    ├── vision_wasm_internal.js
    ├── vision_wasm_internal.wasm
    ├── vision_wasm_module_internal.js
    ├── vision_wasm_module_internal.wasm
    ├── vision_wasm_nosimd_internal.js
    └── vision_wasm_nosimd_internal.wasm
```

资产批准后，把实际 SHA-256 写入 `model-assets.lock.json`；不要在构建脚本中跳过校验，也不要把二进制直接复制进 Git 工作区作为发布来源。

浏览器只从同源 `/makeup/mp-models/` 加载通过校验的产物。GPU 不支持时会本地降级到 CPU；模型缺失或损坏时流程进入明确错误态，不回退到 CDN。
