# 当前功能范围 vs MVP 范围

> 用于在后续迭代中判断“哪些代码应该保留在主分支、哪些应该剥离”。

## MVP 核心流程（应在主分支保持精简稳定）

```
[上传自拍] → [AI 分析五官] → [推荐 3 个妆容] → [分步教学] → [教学资源] → [分享结果卡]
```

| 模块          | 当前状态  | 说明                                                  |
| ------------- | --------- | ----------------------------------------------------- |
| 上传自拍      | ✅ 已实现 | 支持拍照、相册、拖拽、粘贴；前端本地压缩；10MB 限制   |
| AI 分析五官   | ✅ 已实现 | 三庭五眼、脸型、肤色、眼型、鼻型；暗光/模糊/遮挡诊断  |
| 推荐 3 个妆容 | ✅ 已实现 | `/api/recommend` 按特征匹配，返回妆容列表             |
| 分步教学      | ✅ 已实现 | `TutorialView` + `MakeupCanvas` 分区覆盖标注          |
| 教学资源整理  | ✅ 已实现 | `ResourcesView` + `/api/resources` 按妆容聚合教程链接 |
| 分享结果卡    | ✅ 已实现 | `ResultCard` 生成分享图与种草文案                     |

## 超范围 / 实验性功能

| 模块                                                   | 当前状态                  | 与 MVP 关系                         | 建议                                                        |
| ------------------------------------------------------ | ------------------------- | ----------------------------------- | ----------------------------------------------------------- |
| AI 图像生成 (`src/frontend/generate`, `/api/generate`) | ✅ 已剥离 | 明确不在 MVP 内；属于“虚拟试妆”方向 | 已从主分支剥离，需要真实 provider 时再重新集成 |
| 品牌落地页 (`brandsite/index.html`)                    | ⚠️ 独立静态页             | 不是产品 MVP 的一部分               | 作为独立部署产物保留，不耦合主应用                          |
| 训练/采集脚本 (`scripts/`)                             | ❄️ 已冻结                 | 早期数据工程脚本，当前未运行        | 归档到 `scripts/archive/`，或另开仓库                       |

## 关键文件归属

```
src/frontend/
  App.tsx              # MVP 入口，应保持精简
  state/appReducer.ts  # MVP 状态机
  views/               # MVP 各阶段视图
  tutorial/            # MVP 分步教学 + 画布标注
  result/              # MVP 分享结果卡
  face/                # MVP 人脸分析与诊断
  resources/           # MVP 教学资源整理
  generate/            # ⚠️ 超范围：图像生成

src/backend/
  routes/recommend.ts  # MVP 推荐
  routes/upload.ts     # MVP 上传
  routes/resources.ts  # MVP 教学资源
  routes/generate.ts   # ⚠️ 超范围：图像生成任务
```

## 下一步决策点

1. **是否剥离 image generation？**
   - 保留：需要持续维护 provider、job store、轮询逻辑，增加测试与配置复杂度。
   - 剥离：核心 MVP 更干净，但未来接真实 provider 时需要重新集成。

2. **教学资源模块如何继续打磨？**
   - 当前 `ResourcesView` 聚合外部链接，可考虑增加：收藏/历史、按肤质/场景筛选、与推荐妆容的关联权重。

3. **scripts/ 是否归档？**
   - 建议把 `collect_bilibili.py`、`collect_xhs.py`、`annotate_images.py` 等训练相关脚本移到独立仓库或 `scripts/archive/`，减少主仓库噪音。
