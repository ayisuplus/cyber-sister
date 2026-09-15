# Amie 的 RunningHub 自建图像工作流

状态：✅ 当前有效。更新于 2026-09-15。两条工作流已在用户的 RunningHub 工作空间保存并完成真实出图：合成人像及单图妆容编辑均成功，合计消耗 54 RH 币。工作模式 Agent 已接入生图与取回工具，后端适配、逐次确认、云端编号持久化和会话图片交付通过自动化测试。用户已提供 API Key，私有密钥文件和本地启动配置已接入；真实账户鉴权与已有生图任务的 V2 查询通过。当前本地 API/前端进程未启动，启动后配置生效；新建生成 API 与更多场景效果验收尚未完成，仓库默认配置仍关闭。妆容/衣柜原有模拟入口不因此变为真实生成。

## 已保存的工作流

| 工作流 | 用途 | 输入 | 输出 |
| --- | --- | --- | --- |
| [Amie · 通用生图 · Z-Image Turbo v1](https://www.runninghub.cn/workflow/2099692630371299330) | 工作配图、插画、视觉灵感、虚构角色设定 | 提示词、宽高、随机种子 | 单张 PNG |
| [Amie · 参考图编辑 · Qwen 2511 v1](https://www.runninghub.cn/workflow/2099730232960970754) | 原图上的妆容、文字指定的穿搭或场景修改 | 原图、编辑要求、随机种子 | 保留原图比例、约 1 MP 的单张 PNG |

版本文件位于 [`deploy/runninghub/`](../../deploy/runninghub/)，[`workflows.json`](../../deploy/runninghub/workflows.json) 保存工作流 ID 和字段映射。ID 必须按字符串处理。两个 `.workflow.json` 是本次自建并导入的平面节点图，不依赖子图、付费闭源模型节点或第三方加速 LoRA。

两条流程独立调度，避免一次请求加载两套扩散模型。工作流只保存到工作空间，没有点击“发布”，没有开通会员或充值。

## 模型和计算链路

| 流程 | 扩散模型 | 编码器 / VAE | 采样 |
| --- | --- | --- | --- |
| 通用生图 | `z_image_turbo_bf16.safetensors` | `qwen_3_4b.safetensors` / `ae.safetensors` | shift 3，8 步，CFG 1，res_multistep / simple，denoise 1 |
| 参考图编辑 | `qwen_image_edit_2511_fp8mixed.safetensors` | `qwen_2.5_vl_7b_fp8_scaled.safetensors` / `qwen_image_vae.safetensors` | shift 3.1，CFGNorm，20 步，CFG 4，euler / simple，denoise 1 |

[Z-Image Turbo 上游](https://huggingface.co/Tongyi-MAI/Z-Image-Turbo)和 [Qwen-Image-Edit-2511 上游](https://huggingface.co/Qwen/Qwen-Image-Edit-2511)模型卡均标注 Apache 2.0。RunningHub 模型库已找到对应主模型文件；平台提供的具体权重文件尚未做哈希比对。开源权重许可不表示平台 GPU 服务免费。

原生节点和采样参数依据 [ComfyUI Z-Image 教程](https://docs.comfy.org/tutorials/image/z-image/z-image-turbo)与 [Qwen 2511 教程](https://docs.comfy.org/tutorials/image/qwen/qwen-image-edit-2511)。仅使用其节点接口和官方参数作为依据；按产品用途重新组织原图、提示词、单张输出与说明。

编辑时，原图缩放后同时送入正负两路 `TextEncodeQwenImageEditPlus` 和 VAE 编码；两路条件使用 `index_timestep_zero`，再采样、解码并保存。默认示例要求保留人物身份、五官比例、肤色、姿态和背景，只改变自然通勤妆。提示词约束需要实际效果检验，不保证身份逐像素一致。

## 使用与接入字段

生图只需修改画布节点 5 的文本；节点 7 默认 `1024×1024`、batch 1，也可使用 `832×1216` 或 `1216×832`；节点 8 的固定种子便于比较效果。编辑需先在节点 4 选择有权使用的原图，再修改节点 8 的要求。仓库和画布未内置私人人像。

| 流程 | 产品参数 | nodeId | fieldName |
| --- | --- | --- | --- |
| 生图 | 画面描述 | `5` | `text` |
| 生图 | 宽 / 高 | `7` | `width` / `height` |
| 生图 | 随机种子 | `8` | `seed` |
| 编辑 | 上传接口返回的图片文件名 | `4` | `image` |
| 编辑 | 编辑要求 | `8` | `prompt` |
| 编辑 | 随机种子 | `13` | `seed` |

映射已与两张生成 PNG 内嵌的实际运行 `prompt` 核对，字段和节点 ID 均一致；尚未完成 `nodeInfoList` 云 API 调用验证。`nodeId` 和 `fieldName` 使用字符串，`fieldValue` 保持对应字段类型（本实现提示词/文件名为字符串，尺寸/种子为整数）；图片先上传取得文件名，不能把本机路径直接发给云端节点。[官方高级工作流接口](https://www.runninghub.cn/runninghub-api-doc-cn/api-425749013)

生图结果来自节点 10，编辑结果来自节点 15。后端复用已有 WorkTask/WorkAction 生命周期，展示提示词、所选文件和付费说明后逐次确认，提交后先持久化供应商任务 ID，再查询和保存可下载副本。超时不盲目重提，照片仅用于本次确认的工作流。

## Agent 接入与启用

- `generate_image`：仅工作模式后台执行。允许 `text-to-image` 和 `reference-edit`，每个后台任务最多申请一次生成；文字生图固定 1024×1024，编辑使用 Plus 与单张当前会话 PNG/JPG（最多 5 MB）。模型不能指定任意工作流、模型、步数或地址。
- `get_generated_image`：工作会话中查询原任务；可省略确认记录 id，取最近一次已保存云端编号的记录。数据库核对用户及会话归属，不能通过猜测云端 taskId 查询其他任务。
- 用户确认前不上传照片、不提交任务；确认卡展示提示词、图片文件名及摘要、付费和取消说明。API 当前没有预先报价或金额硬上限，不把此前网页的 RH 币记录用作 API 报价。
- 提交调用不重试、不跟随重定向。响应丢失或服务在付费步骤中断时暂停，不自动重发；已保存云端编号可在本会话发送“取回上次生成的图片”。未知编号先核对 RunningHub 账单。取消本地任务不保证云端停止或退款。
- 正常后台任务最多等待云端结果 5 分钟（HTTP 请求本身最多 60 秒），超时返回已保存编号；查询工具不再次生成。成功结果仅接受单张 PNG，从已验证的 RunningHub CDN 下载（最多 5 MB），通过原有会话文件事务保存；前端使用认证下载接口预览和下载，不直接展示第三方图片链接。
- 成本只使用 V2 查询实际返回的 `usage` 数值；未返回的费用保持未知，最终以平台账单为准。无凭据的测试没有调用付费云端服务。

先执行迁移 `20260915160000_runninghub_actions`，然后在服务端运行配置中设置：

```dotenv
WORK_TASKS_ENABLED=true
RUNNINGHUB_ENABLED=true
RUNNINGHUB_API_KEY_FILE=E:/projects/电子闺蜜/.local-secrets/runninghub_api_key
```

最后一行是本机文件路径示例，文件内容仅为有权限调用这两条工作流的 API Key。不要把 Key 放进前端、Git 或聊天记录；Docker 部署需将该文件只读挂载，并把路径改为容器内路径。加载沿用现有 `loadRuntimeSecrets`，修改后重启 API。Key 账户权限和 API 余额须独立核对，网页充值并不证明某类 API Key 已开通。

启用后进入工作模式，选择“后台执行”，发送“生成一张……插画”；编辑先上传 PNG/JPG，再发送“把这张图……，保留……”。确认卡出现后点击“确认付费生成一次”。取回原图可在本会话直接发送，无需再批准一次生成。

实现：`apps/api/src/services/runningHubService.js` 适配官方上传、`/task/openapi/create` 和 `/openapi/v2/query`；`workImageTools.js` 负责会话文件、确认和交付；`workActionService.js` 保存字符串类型的供应商 taskId。工作流字段唯一配置位于 `deploy/runninghub/workflows.json`，Docker 镜像已包含此文件。[官方 V2 查询](https://www.runninghub.cn/runninghub-api-doc-cn/api-425767306)、[官方上传实现](https://github.com/HM-RunningHub/RH_CLI/blob/main/src/rh_cli/media.py)。

本版编辑只接一张原图，`image2` / `image3` 可选端口未连线。上传服装商品图后的双图试穿、精确局部遮罩、视频、语音和 3D 尚未搭建。编辑输出不等于 3D 服装模型，也不等于现有妆容页面四个滑杆的逐像素滤镜。

## 验证与剩余工作

- 本地结构检查：生图 11 个节点 / 10 条连线，编辑 16 个节点 / 20 条连线；节点 ID 唯一，输入输出类型匹配，无必需输入漏接、无循环，每图一个保存输出。
- 云端：两张画布成功导入，显示完整节点和连线，没有缺失节点弹窗；工作空间保存名称和链接已确认。
- 生图与编辑的主模型、编码器、VAE、采样节点均已通过实际 GPU 执行；两张结果均为 1024×1024 PNG，固定种子 20260915。
- “导出工作流 API”的浏览器下载等待曾超时；此次从已下载的生成 PNG 提取了平台内嵌的 `prompt` 和 `workflow`，作为实际运行参数及工作流回读记录。`deploy/runninghub/` 中的图仍是可再次导入的模板，原图输入不携带本次样本。
- 用户明确授权后只发起两次生成，没有重试、充值或订阅操作。费用来自控制台“任务与账单”；两次钱包扣费均为 0，算力消耗以 RH 币记录，不把 RH 币推算成人民币报价。

| 任务 | taskId | 档位 | 运行时长 | RH 币 | 结果 |
| --- | --- | --- | --- | --- | --- |
| 合成人像生图 | `2099741730948743170` | Standard | 34 秒 | 7 | 成功，1024×1024 |
| 原图妆容编辑 | `2099745287877918722` | Plus | 1 分 57 秒 | 47 | 成功，1024×1024 |

原图采用虚构成年人物、正面半身、奶油白上衣和中性背景。编辑增加豆沙色唇妆与腮红，整体人物外观和构图基本延续；皮肤纹理同时变柔，部分发丝细节变化。因此本次只接受为妆容效果预览样本，不视为精确局部修图、身份一致性保证或完整试衣验收。

本地证据位于 `../asset-work/runninghub-workflows-20260915/`（相对仓库根目录）：两张原始 PNG、`generation-verification.json`、`source-runtime-prompt.json` / `edited-runtime-prompt.json` 及对应的实际工作流。原图 SHA-256 为 `0447fa154e44b961de58c0e5706fa95b7e1985c4224a063c866dcd8f88be9247`，编辑结果为 `ae80ce9edf0b0bce8cec6181de12e7d64846851540334672de3bbc80926539c5`；编辑输入文件名与原图哈希一致。平台显示结果 14 天后过期，本地副本已保存。

Agent 接入验证：API 1053 项通过、61 项数据库测试在普通回归中跳过；独立 PostgreSQL 回归 61 项通过，包含 Agent → 确认 → 模拟云端响应 → 编号保存 → PNG 会话事务，以及中断后禁止重发。Web 732 项通过，包含付费确认说明、已提交状态与认证图片预览。类型检查、构建及 lint 通过（API 149 / Web 25 条 warning，0 error）。本地调试库已备份并执行新增列迁移，30 张现有表的数据摘要前后相同。测试证据保存在 `../asset-work/runninghub-agent-20260915/`，不把模拟响应计为真实 API 验收；首次 API 四 worker 回归出现 worker 异常退出，单 worker 全量通过，原失败日志保留。

2026-09-15 密钥接入：从用户指定文档的 RunningHub 条目提取单一 Key，独立保存到仓库外私有目录，本地 `run-local.mjs` 仅记录文件路径。官方账户接口鉴权通过，返回共享类型；项目 V2 查询成功读取已完成任务，两个 Agent 图片工具加载正常。本次没有调用创建任务接口，脱敏证据见 `credential-verification.json`。`apiExecutionTested` 仍为 false，不能把账户查询当成新建生图成功。

后续完成真实新建生成 API 联调，并用更多妆容、穿搭及非人像样本验收；如要保证修改范围，应另外验证遮罩与局部编辑链路。该阶段不宣称完成整个工作 Agent 的优化目标。
