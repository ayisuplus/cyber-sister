# Amie · API 文档

> **适用版本**：内测版
> **创建日期**：2026-08-31
> **基线**：`apps/api/src/routes/` 实际实现
> **权威合同**：[`docs/Spec_Amie_v1.0.md`](../Spec_Amie_v1.0.md)（与本文冲突时以 Spec 为准）
>
> 本文面向前端与集成开发者。所有示例均为 JSON。

> **2026-09-16 功能收拢更新**（以 [Spec §1/§3/§4.1/§6.1](../Spec_Amie_v1.0.md) 为准）：界面只提供三种说话方式，新用户默认 `gentle`；角色扮演接口已移除；只有一种对话，新建会话接口拒绝 `mode=work`；日程、倒数日、旧提醒、手帐（`/api/habits`）与自习（`/api/study`）接口已下线（404），由「安排」`/api/reminders` 替代，`/api/tools` 只剩经期与关闭的天气；导出新增 `scheduledTasks`。「安排 / 手记 / 经期 / 装扮」相关接口只在本地运行时开放，网页版返回 403 `LOCAL_CLIENT_REQUIRED`。

> **2026-09-19 重构更新**：只有一个 Web 版——上述生活接口不再按分发拦截，只经登录与领域归属校验；`LOCAL_CLIENT_REQUIRED` 只用于本机能力（`/api/work` 下的文件、代码、浏览器与后台任务；装扮的模拟预览 `/api/work/media/*` 已于 2026-09-21 删除）。新增经期单独同意 `GET/PUT /api/tools/period/consent`。删除：`/api/user/membership*`、`/api/tools/weather`、`POST /api/diary/:day/comment`、`POST /api/reading/notes/:noteId/comment`、`POST /api/letters/generate`。`/api/derived/analyze` 与 `/rebuild` 随后同日删除，草稿改由用户自己打开的「做梦」产生；新建会话接口删除，改为 `GET /api/chat/thread` 唯一对话与 `DELETE /api/chat/thread/messages` 清空记录。

> **2026-09-22 更新**：新增「模型供应商」——实例管理员可在设置页配多家 OpenAI 兼容的聊天模型（`/api/admin/model-providers`，见 §十·五），网关按优先级依次尝试，不再绑死单一家厂商；`GET /api/llm/status` 增加 `isInstanceAdmin` 与 `externalFallback.providers`。没有配置任何自定义供应商时，行为与以前完全一致（仍用 `GATEWAY_QWEN_*`）。
> 同日还新增只读 `GET /api/chat/openers`（见「三、聊天」）：空白对话那一屏的开场话题从她自己的线索里来（她惦记的事 / 在读的书 / 最近的手记），只读、不发模型、不落库。

> **2026-09-25 非对称记忆架构（路线图 C23，见[非对称记忆架构](../architecture/非对称记忆架构.md)）**：她自己整理的东西——记忆之间的关系、对你的理解、惦记的事——合进一张表 `inferences`（她的组织层），旧表 `memory_edges`、`derived_insights`、`follow_ups` 先只读，2026-09-26 删除（第五步）。新增 `GET /api/memories/inferences`（「她猜的」）与 `DELETE /api/memories/inferences/:id`（删掉即否决，她不会再推出同一条），见 §四。行为变化：
> - **根一改就作废**：记忆的正文或类型一变，以它为依据的关系与理解作废，不再进聊天、不再进信（以前是转「待重审」后进信）；删记忆时连同引文一起删。
> - **聊天里标成她自己的联想**：有效的关系与理解挂在本轮选中的记忆上，单独成块、标明没经她确认，不再混在记忆数据里；关系不再只读「已确认」的。
> - **进过信的不再是「消费掉」**：记下 `letteredAt`，下一封不再重复，但仍是她的联想。
> - **写信移出只读接口**：`GET /api/chat/nudges` 只等写信 1.5 秒，写不完下次再说；同一个人同时只写一封（`POST /api/letters/generate` 走同一个入口）。
> - **经期卡片只经两项同意进模型**：「记录经期」与「聊天时顾及周期」都开着，关心卡片里的经期才作为「她今天说过的话」交给模型；便签照常显示。
> - **惦记的事要有原话作依据**：必须逐字出自你说过的话（她自己说的不算）。
> - **派生索引一张表**：记忆与她上传的书的段落，向量合进 `embeddings`（旧的 `memory_projections`、`book_passages.vector` 与 `memories.embedding` 先只读，2026-09-26 删除）；三类向量（含随代码提交的书架索引）共用一种身份写法（地址规范化后取哈希 + 模型 + 维度 + 这类对象的规则版本，`localhost` 与 `127.0.0.1`、末尾的 `/` 不再被当成不同模型）、一份相似度计算与集中登记的阈值。补算任务（`POST /api/memories/index-jobs`）同时补记忆与书段落，换了向量模型后她的书会被重算，不再显示「就绪」却每次被跳过。`POST /api/memories/embeddings/rebuild` 删除，全量重算用 `POST /api/memories/index-jobs` 的 `mode: "rebuild"`；上传书时没配向量模型的错误码统一为 `EMBEDDING_NOT_CONFIGURED`。
> - **提议通道**：来信建议新增 `merge_memories`（合并两条）、`resolve_conflict`（标出两条矛盾，处置时带 `keep`）、`promote_inference`（把她猜的记下来）；「同意采纳 / 不用」在一个事务里完成（写根、回写建议、结束她依据的整理），任何一步失败整体回滚；采纳写根的那一版在 `memory_revisions.proposal` 记下来源链 `{letterId, index, kind, inferenceIds}`，`action` 为 `accept_suggestion`。见 §十四。
> - **导出**：`derivedInsights`、`memoryEdges`、`followUps` 三节合成 `inferences`（不含你删掉的、不带内部 id），并补上会话的前情摘要 `summary`、消息的页边批注 `bookNotes`、来信的 `suggestions` 与 `readAt`；`memoryBundle` 带 `pinned`，关系改从组织层取（有效 → `canonical`，作废 → `needs_review`，v2 格式不变）。

> **2026-09-25 书架合并（路线图 C22）**：内置书与她上传的书放进同一个书架。新增 `POST/DELETE /api/reading/books/:id/content`（她确认后上传本机解析好的章节 / 撤回）与只读的 `GET /api/reading/shelf/builtin`、`GET /api/reading/shelf/builtin/:name`（见 §四·五）；书目多了 `serverIndex`、`indexedAt`、`indexProgress`；`bookNotes` 里可能出现她自己的书（见「页边批注」）；`/api/user/profile` 新增 `citeBooks`（回答里提不提书名，默认 `false`）。数据导出的 `books[]` 带上 `serverIndex`、`indexedAt` 和她上传的分段正文 `passages`（不含向量）。

> **2026-09-23 她的来信更新**：「做梦 / 待确认 / 来信」收进一层「她的来信」——按用户设定的频率（`letterFreqDays` = 3/7 或空=不写）由服务器端根据记忆与近况写信，信里带 ≤3 条建议（改记忆 / 删记忆 / 安排一件事），看信时一键「同意采纳」或「带去对话」。`dreamEnabled`/`dreamt_at` 删除；`/api/derived*` 全部下线（派生草稿仍是内部层，写信前的回想产出、进信即消费）；记忆的版本恢复与整库清空接口（`GET /api/memories/:id/revisions`、`POST /api/memories/:id/restore`、`DELETE /api/memories`）一并删除；`/api/letters` 重新上线（见 §十四）。

> **2026-09-27 每日天气与宠物**：新增 `/api/weather`（见「八·五、天气」）与 `/api/pets`（见「八·六、宠物」）。城市由用户自己填、从候选里选，不定位；取不到如实 503 `WEATHER_UNAVAILABLE`。旧的 `/api/tools/weather` 假数据路由已于 09-19 删除，不复用。导出的 `user` 段多 `weatherPlace`、`petFood`、`activePetSpecies`，另有 `pets` 段（每只的名字、好感度、成长值）。

> **2026-09-13 记忆更新**：正式记忆支持修订、来源与关系重审；新增详情、恢复与数据库索引任务，旧重建接口改为 202。导出升级 v2，记忆导入携带预览版本。当前字段以本文档与[非对称记忆架构](../architecture/非对称记忆架构.md)为准；09-13 的[记忆系统接口合同](../09-参考/历史归档/记忆系统接口-20260913.md)已归档，只作历史证据。

> **2026-09-12 对话归档更新**：会话列表默认只返回未归档记录；归档筛选、恢复接口与聊天限制见[模型连接与对话归档](../09-参考/历史归档/模型连接与对话归档-20260912.md)。

> **2026-09-12 工作模式更新**：当前工作模式处于固定云端模拟阶段。新增计时、经期修正与媒体上传接口，以及分析、来信、短评、任务执行的最新行为，以[工作模式云端接口合同](../09-参考/历史归档/工作模式云端接口-20260912.md)和 [OpenAPI](../09-参考/历史归档/工作模式云端接口-20260912.openapi.json)为准；下文对应旧版生成说明不代表当前已接入真实服务。

---

## 通用约定

### 基础路径

| 服务 | 路径 |
|------|------|
| 主 API | `/api/*` |

### 鉴权

除登录、刷新、健康检查外，所有接口需要 **Bearer access token**：

```http
Authorization: Bearer <access_token>
```

- access token 由 `/api/auth/login` 返回
- refresh token 存于 `Secure` + `HttpOnly` Cookie（路径 `/api/auth`），前端 JS 不可读
- refresh 每次使用都会**轮换**，旧 token 立即失效
- `logout` 撤销当前 refresh token，重复调用幂等

### 统一错误格式

```json
{
  "error": "人类可读的错误信息",
  "code": "ERROR_CODE"        // 部分错误带 code
}
```

### 常见状态码

| 状态码 | 含义 | 典型场景 |
|--------|------|----------|
| 200 | 成功 | — |
| 400 | 请求参数错误 | 校验失败 |
| 401 | 未认证 | token 无效/过期，**非白名单与错误验证码也统一返回 401** |
| 403 | 无权限 | 非实例管理员访问管理接口 |
| 404 | 不存在 | 资源不存在或不属于当前用户 |
| 409 | 冲突/功能关闭 | 修订版本冲突等 |
| 429 | 限流 | 登录尝试过多 |
| 500 | 服务端错误 | — |
| 503 | 依赖不可用 | 见下方"聊天专用状态码" |

### 聊天专用状态码

| 状态码 + code | 含义 |
|---------------|------|
| 503 `CLOUD_NOT_CONSENTED` | 需要先在「我的 → 云端模型」同意使用云端模型 |
| 503 `LLM_UNAVAILABLE` | 云端模型暂时不可用 |

### 健康端点

| 端点 | 说明 |
|------|------|
| `GET /api/health/live` | 进程存活 |
| `GET /api/health/ready` | 依赖就绪，可随依赖恢复自动恢复 |

> ready **不把**云端模型暂时不可用判为应用宕机——模型不可用时应用仍 ready。

---

## 一、认证 `/api/auth`

### POST /api/auth/login

白名单手机号 + 固定验证码登录。**内测无"获取验证码"交互**，不存在该端点。

**请求**

```json
{
  "phone": "13800138000",
  "code": "123456"
}
```

**响应 200**

```json
{
  "token": "<access_token>",
  "user": {
    "id": "uuid",
    "phone": "13800138000",
    "nickname": "内测用户",
    "persona": "toxic",
    "isVip": false,
    "avatarUrl": null
  }
}
```

同时下发 `refreshToken` Cookie。

**行为要点**

- 首次登录的手机号会**自动创建用户**，默认昵称"内测用户"，**默认人格 `toxic`**
- 非白名单号码与错误验证码**统一返回 401**，不区分（避免探测白名单）
- 验证码比对使用**恒定时间比较**，防时序侧信道
- 限流按 **IP + 手机号**组合，超过阈值返回 429

**错误**

| 状态码 | error |
|--------|-------|
| 400 | 手机号或验证码格式错误 |
| 401 | 手机号或验证码错误 |
| 429 | 登录尝试次数过多，请稍后再试 |
| 500 | 登录失败，请稍后重试 |

---

### POST /api/auth/refresh

用 Cookie 中的 refresh token 换新 access token。

**请求**：无 body（依赖 Cookie）

**响应 200**

```json
{ "token": "<new_access_token>" }
```

同时下发**新的** refreshToken Cookie（轮换）。

**错误**：401 `RefreshToken无效，请重新登录`（无 token、校验失败、重放）

---

### POST /api/auth/logout

撤销当前 refresh token 并清除 Cookie。重复调用幂等。

**响应 200**

```json
{ "success": true }
```

---

## 二、用户 `/api/user`

### GET /api/user/profile

获取当前用户信息。

### PUT /api/user/profile

更新昵称、头像、生日、`careEnabled`（她来想你）与 `letterFreqDays`（她的来信频率：`3` 三天一封 / `7` 七天一封 / `null` 不写信，默认 `null`；其余值 400「letterFreqDays只能是3、7或空」）。GET 同样返回这两个开关。

`citeBooks`（2026-09-25 起，路线图 C22）：「回答里提到书」，布尔值，默认 `false`；非布尔值 400「citeBooks必须是布尔值」。只影响翻到书时给模型的一行说明：`true` 时可以自然地提一句书名和章节，只许提这一轮给它的书；`false` 时不提书名、作者、章节，也不引原文。页边批注不受它影响（批注的开关在设备上）。

### 人设库（2026-09-29 起，路线图 C30）

「她」是用户自己写的**人设卡**，一人多张，至少留一个。内置说话方式预设已下线。以下接口都需要登录。

**人设卡 `card`**（字段全是字符串，保存前 trim；`samples` 是字符串数组）

| 字段 | 必填 | 上限 | 说明 |
|---|---|---|---|
| `name` | 是 | 20 | 她叫什么 |
| `identity` | 否 | 300 | 她是谁 |
| `relationship` | 否 | 200 | 和用户什么关系 |
| `speech` | 是 | 400 | 怎么说话 |
| `thinking` | 否 | 400 | 怎么看事情 |
| `decisions` | 否 | 300 | 遇事怎么判断 |
| `never` | 否 | 300 | 绝不做什么 |
| `samples` | 否 | 至多 5 条，每条 80 | 示例句 |
| `immersion` | 否 | `low` \| `medium` \| `high`，缺省或未知回落 `medium` | 沉浸深度：只改变角色表达的深浅，**所有档位都保留真实 AI 身份** |
| `tone` | 否 | `gentle` \| `toxic` \| `cool` | 语气底子（句库取口吻用） |

超限、必填缺失返回 400，文案如「她叫什么不能为空」「她怎么说话不能超过400个字符」「示例句最多5条」。保存与蒸馏走同一道校验，硬规则只有两条：

- 只做女孩子的角色：命中明显男性指称返回 400「这是闺蜜产品，不开展男性的服务」（启发式，名字拦不全）。
- 拒绝低俗、允许暧昧：露骨内容返回 400「这段写得有点太过了，改一改」。

#### GET /api/user/personas

返回 `{ "personas": [{ "id", "name", "card", "active" }] }`，按建卡时间由早到晚；`active` 为 `true` 的是当前启用的那张。

#### POST /api/user/personas — 造一个她

请求体就是一张 `card`。建卡**并立即启用**，返回 `{ id, name, card, persona }`（`persona` 是当前启用的 id，即这张卡）。

#### PUT /api/user/personas/:id — 改一改

请求体是完整的 `card`；不改变谁在启用。返回 `{ id, name, card, persona }`。不属于该用户或不存在返回 404「没有这个她」。

#### DELETE /api/user/personas/:id — 删她

只剩一个时 400「至少留一个她」；删掉当前启用的那张，会启用剩下里最早建的。返回 `{ "personas": [...] }`（同 GET）。同一用户的建、删、换共用行锁，并发删除至多成功一个。

#### POST /api/user/personas/distill — 蒸馏草稿（不落库）

`multipart/form-data`：

- `material`：素材文字，至多 5000 字符。
- `images`：至多 4 张照片，每张不超过 8MB。
- `research`：缺省为开；传 `false` 关闭。**只有实例配置了 `SEARCH_ENABLED=true` 才真的联网**，且只开 `web_search` / `read_web` 两个工具。

文字与图片至少要有一样，否则 400「先给点她的素材」。**前置条件与聊天一致**：未配置云端模型或用户未同意云端模型时拒绝，不调用模型；每次调用前复查同意。素材先脱敏再发送。

成功返回 `{ "card": {...}, "researched": true|false }`，是一份**草稿**，用户改过后再走 `POST /api/user/personas` 保存；素材主角是男性时返回 `{ "refused": "male" }`；模型没给出可用的草稿返回 502。

### PUT /api/user/persona — 换她

**请求**

```json
{ "persona": "<personas.id>" }
```

`persona` 是 `GET /api/user/personas` 里某张卡的 `id`；不属于该用户或不存在返回 404「没有这个她」。

**行为要点**

- `User.persona` 是**唯一**的「她」来源（存启用的人设卡 id），`Conversation` 不保存 persona
- 换了之后**当前及未来会话的下一条消息**立即使用新的她
- 已存在的聊天历史与记忆**不受影响**
- 提示词顺序固定：安全边界 > 身份线 > 共用前言 > 人设层；任何沉浸档都保留真实 AI 身份，输出里自称真人一律拦下

### GET /api/user/external-llm-consent

**响应**

```json
{
  "accepted": null,
  "version": "cloud-primary-v1",
  "updatedAt": null
}
```

`accepted` 三态：`null`（未选择）· `true`（接受）· `false`（拒绝/已撤回）

### PUT /api/user/external-llm-consent

**请求**

```json
{ "accepted": true }
```

**行为要点（重要）**

- 聊天只有云端一条路径：该同意是使用聊天的**前置条件**
- 未选择、拒绝、撤回时聊天不可用，且**云端调用次数必须为零**
- 同意版本不是 `cloud-primary-v1` 时按**未选择**处理（旧版同意自动失效，用户进聊天首屏需重新同意）
- 服务端在每次外部请求发出前**重新读取**同意状态——撤回会拦住尚未发出的请求
- 页面在聊天首屏引导同意/重新同意，不同意则聊天不可用

### ~~/api/care~~、~~/api/reminders/due~~、~~/api/reminders/deliveries/:id/ack~~ — 已删除（2026-09-20）

关怀卡片与提醒铃铛合并为对话里的 `GET /api/chat/nudges`；`/api/reminders/scheduled` 的增删改查不变。（`/api/letters` 当时一并下线，2026-09-23 随「她的来信」重新上线，见 §十四。）

### ~~/api/user/membership~~ — 已删除（2026-09-19）

会员没有支付能力，页面内容与现状冲突，接口与页面一并删除；`users.is_vip / vip_expire_at` 列暂留，随后续清表处理。

### ~~PUT /api/user/roleplay~~ — 已移除（2026-09-15）

角色扮演随功能收拢取消：设置与清除接口均已移除，聊天不再注入角色设定，导入也不再接收角色。已有的 `roleName / roleSetting` 只随导出带出。

### GET /api/user/companion/journal — 「她这几天」手账（2026-09-26 起）

「她」页的一本手账：最近 7 天（含今天，北京时间）她为你做过、有记录可查的事。只读，全部从已有记录按模板拼出，不调模型、不另存一份；`Cache-Control: no-store`。

```json
{
  "windowDays": 7,
  "lettersOn": false,
  "days": [
    { "date": "2026-09-26", "entries": [
      { "kind": "remember", "at": "2026-09-26T01:00:00.000Z", "text": "记住了你说的「我对芒果过敏」。" },
      { "kind": "book", "at": "2026-09-26T02:00:00.000Z", "text": "聊天时翻了《情绪急救》「失败」。" }
    ] }
  ]
}
```

- `days` 从近到远，一天里按时间先后；没有记录的日子不出现。
- `kind` 与来源：`reflect` 回想（她的组织层里 `producedBy=reflection:*` 的条目，按天合成一句：猜了几件、连了哪一对、记下几件惦记的事）；`tidy` 你改过记忆后作废的、你在「她猜的」里删掉的；`ask` 惦记的事到日子问过你的；`letter` 写了一封信；`decide` 你采纳或没用信里的建议（按建议上的 `decidedAt`，2026-09-26 起记下）；`remember` 你让她记下的记忆（「帮我记住」与手写的分开说，一天超过 3 条合成一句，导入的一句带过，采纳来信建议记下的不重复写）；`book` 聊天时翻过的书（页边批注，一天最多写两本）；`plant` 花草图鉴里她帮你认过、你收进来的花草（只算认过的，自己写名字收的不写；一天超过 2 株合成一句，2026-09-26 起）。
- `lettersOn`：写信是否开着。回想跟着写信走（路线图 C23），写信关着时她不在你不在的时候整理，页面如实说明。

### GET /api/user/export — 一键导出全部数据

登录用户导出单 JSON 包，响应头 `Content-Disposition: attachment; filename="cyber-sister-export-<yyyy-MM-dd>.json"`。永久免费，无会员门槛。

**响应 200 结构**

```json
{
  "version": 2,
  "product": "Amie cyber-sister",
  "exportedAt": "2026-09-07T08:00:00.000Z",
  "user": {
    "nickname": "...", "persona": "toxic", "roleName": "...", "roleSetting": "...",
    "birthDate": "...", "externalLlmConsent": { "accepted": true, "version": "cloud-primary-v1" },
    "createdAt": "..."
  },
  "memories": [ { "type": "semantic", "content": "...", "importance": 7, "tags": ["..."], "createdAt": "..." } ],
  "conversations": [ { "messages": [ { "role": "user", "content": "...", "emotion": null,
      "source": "qwen", "importance": null, "toolRuns": null, "createdAt": "..." } ] } ],
  "scheduledTasks": [ { "content": "妈妈生日", "freq": "yearly", "time": "09:00", "status": "active", "deliveries": [] } ],
  "todos": [], "countdowns": [], "periodRecords": [], "reminders": [],
  "diaryEntries": [], "habits": [ { "checkins": [] } ],
  "books": [ { "notes": [] } ],
  "studySessions": []
}
```

- `scheduledTasks`（2026-09-15 起）：安排的调度字段原样导出，`deliveries` 为到点记录（含她执行任务的产出）；`todos / countdowns / reminders / habits / studySessions` 是已停用功能的历史，照旧导出。

- `user` 段**不含** id、phone 与任何凭据
- **不导出**：refresh token（凭据，绝不外发）、危机日志（安全运维数据）、机器向量、头像/背景等二进制资产。
- v2 另含 `memoryBundle`（正式记忆、完整版本、来源、`pinned` 与关系）；上面保留的业务段只示意原有字段。v2 导入以 `memoryBundle` 为准，缺失时拒绝降级，不能丢弃历史后静默导入。关系取自她的组织层：有效的写作 `canonical`、作废的写作 `needs_review`，导入后进对方她的组织层（2026-09-25 起）。
- `inferences`（2026-09-25 起，取代 `derivedInsights` / `memoryEdges` / `followUps`）：她整理的关系、理解与惦记的事，按内容导出、依据只留原话（`because`），不含你删掉的，不带内部 id。
- `conversations[].summary` / `summaryUpToAt`：她整理的前情摘要；`messages[].bookNotes`：页边批注；`letters[].suggestions` / `readAt`：来信里的建议与处理结果（2026-09-25 起）。

### POST /api/user/import/preview — 迁移预览（不落库）

只接收自家导出包 JSON（自动识别 `version` + `product` 字段；v2 以 `memoryBundle` 为准）。外部人设文本（`persona-text`）随角色扮演取消不再接收，其它格式 400。

**响应 200**

```json
{
  "format": "cyber-sister-export",
  "persona": { "id": "gentle", "ok": true },
  "memoryCandidates": [ { "type": "semantic", "content": "...", "importance": 7, "tags": [] } ],
  "memoriesSkipped": 2,
  "notes": ["对话、日记、安排、经期、阅读，以及手帐、日程、倒数日、旧提醒、自习等历史数据段不导入（v1 边界）。"]
}
```

- 导入对象只有两类：人格 id、显式记忆候选（v2 含记忆关系）；其余数据段不导入，`notes` 如实说明
- 人格 id 非法时 `persona.ok:false`
- 云端模型同意状态**绝不导入**——须用户主动重新同意当前版本（`cloud-primary-v4`）
- 预览**绝不落库**；记忆候选单批最多 100 条

### POST /api/user/import/apply — 迁移应用

**2026-09-13 起**，记忆导入必须带预览返回的 `expectedMemoryEpoch`（适用于 v1 候选与 v2 包）。资料在预览后变化返回 409，不执行本批写入；重新预览再确认。v2 包里的记忆关系导入后进她的组织层（`inferences`，见 §四「她猜的」），不再单独成表。

**请求**

```json
{
  "persona": "gentle",
  "memories": [ { "type": "semantic", "content": "...", "importance": 7, "tags": [] } ]
}
```

- 人格经 `switchPersona`；记忆经 `createMemory` 既有校验
- 与现有记忆做规范化去重（NFKC + trim + 小写），候选之间同样查重；重复/非法按 skipped 计数

**响应 200**

```json
{ "personaApplied": true, "memoriesApplied": 8, "memoriesSkipped": 2 }
```

**错误**：两者全空时 400 `没有可导入的内容`。

---

## 二·五、本机助手 `/api/bridge`（2026-09-19 起）

用户电脑上的「Amie 本机助手」主动外连，服务端不连进用户电脑。设计与边界见[本机助手](../architecture/local-bridge-20260919.md)。

| 方法 | 路径 | 身份 | 说明 |
|------|------|------|------|
| POST | `/api/bridge/pairings` | 登录 | 生成一次性 8 位连接码 `{code, expiresAt}`（10 分钟；每人最多 3 台，超出 409） |
| GET | `/api/bridge` | 登录 | `{bridges:[{id, name, online, lastSeenAt, createdAt}]}` |
| DELETE | `/api/bridge/:id` | 登录 | 断开：清令牌，在途任务失败；非本人 404 |
| POST | `/api/bridge/claim` | 连接码 | `{code, name}` → `{token, bridgeId, name}`；码无效/过期/已用 400 |
| GET | `/api/bridge/poll` | `Authorization: Bridge <令牌>` | 长轮询最多 25 秒：`200 {job:{id, tool, args}}` 或 `204`；令牌失效 401 `BRIDGE_UNAUTHORIZED` |
| POST | `/api/bridge/jobs/:id/result` | 同上 | `{ok, result?, error?}`；不是发给这台电脑或已结束的任务 404 |

取任务与交结果不计入普通 `/api` 额度，另按令牌 600 次 / 15 分钟。

## 三、聊天 `/api/chat`

### GET /api/chat/nudges（2026-09-20 起）

她主动说的话：到点的安排投递、她惦记的事（写信开着时）、「她来想你」触点与她的来信合成一条时间线 `{nudges:[{id, kind, content, reason, detail?, action?}]}`。`id` 形如 `reminder:<投递 id>` / `followup:<惦记 id>` / `care:<触点键>` / `letter:<信 id>`；`followup` 的 `reason` 是「你之前说过：…」，`ack` 后记为问过。信只在没读过（`read_at` 为空）时出现。打开对话时拉取，没有推送通道。睡眠卡的两条（2026-09-28 起）另带 `sleep: 'bedtime'|'wake'`，`content` 是那句话（古诗词另起一行注出处），`reason` 如「你在日程里定的早安闹钟（工作日 07:40）」，见 §六「睡眠卡」；早安闹钟的铃声与系统通知由开着的网页自己发，服务端仍没有推送。

### POST /api/chat/nudges/:id/ack

`{action: 'shown'|'dismissed'}`：按来源交回各自的领域服务（提醒确认投递、关怀按日忽略、惦记的事记为问过）。信的 `ack` 只收起这张便签、不写读过——读没读由看信页记（`POST /api/letters/:id/read`），没读下次打开还会出现。不认识的来源 404。

### GET /api/chat/openers（2026-09-22 起）

空白对话那一屏（封面）的开场话题：从她自己的线索里来——她惦记的事（`GET /api/derived/followups`）、你在读的那本书（`GET /api/reading/books`）、你最近写下的一行手记（`GET /api/reading/notes`）。**只读、不发模型、不落库**；界面先摆本机的静态池，拿到这份就替换，取不到就安静地留着静态池，不弹错误。

**响应 200**

```json
{
  "openers": [
    { "id": "followup:<惦记 id>", "label": "惦记的：周三答辩", "text": "答辩怎么样了？", "why": "你之前说过这件事" },
    { "id": "book:<书 id>", "label": "《活着》", "text": "我在读《活着》，想跟你聊聊这本书", "why": "你正在读这本" },
    { "id": "note:<笔记 id>", "label": "上次记的那句", "text": "上次我记下的那句我还想着：……", "draft": true, "why": "你最近写下的一行" }
  ]
}
```

**排序与取舍**

| 规则 | 说明 |
|------|------|
| 顺序 | 到日子（或已过期）的「她惦记的事」→ 其它「她惦记的事」（按 `askOn` 早到晚）→ 在读的那本书（书架里最近翻过的一本）→ 最近一条手记 |
| 写信开关 | 「她惦记的事」是她写信前回想时记下来的：`letterFreqDays` 为空（不写信）时这一屏不再提它们（与对话里那条口径一致），连读都不读，只留书与手记 |
| 条数 | 最多 4 条；同一条线索只出现一次 |
| 空正文 | `text` 为空的不返回；全部来源都空就返回 `{ "openers": [] }` |
| 稳定性 | 同一份数据两次调用结果一致——不随机、不按时间抽签 |
| 单处失败 | 某个来源读不到只丢这一条，不影响其它来源，也不影响对话 |
| `label` | ≤ 14 个字，超出以省略号收尾；`text` 取一行的短句 |
| `draft` | **只给手记来源那条**：手记是用户自己写下的私密文字，前端只把它填进输入框，由用户自己决定发不发；其余来源不带这个字段 |
| `why` | 「为什么看到这条」如实写出来源（`你之前说过这件事` / `你正在读这本` / `你最近写下的一行`），前端显示给用户 |

### GET /api/chat/thread（2026-09-19 起）

只有一段对话：返回用户唯一的进行中对话（没有就创建），第 1 页是最新 50 条，`?page=&limit=` 往更早翻。升级前的多个未归档会话在第一次打开时按时间合进最近活跃的那段（锁用户行，只合一次）；已归档的保持原样。前情摘要沿用最近那段，并把最新 19 条之外视为已覆盖。

### DELETE /api/chat/thread/messages

清空聊天记录：删除这段对话的全部消息与聊天图片，清空前情摘要；正式记忆、她的状态和已归档会话不受影响。

### GET /api/chat/conversations

会话列表，支持 `?page=&limit=&archived=`。界面只用它列出以前归档的会话（`archived=true`）。

### ~~POST /api/chat/conversations~~ — 已删除（2026-09-19）

只有一段对话，不能再新建会话（404）。

### GET /api/chat/conversations/:id

会话详情，支持 `?page=&limit=` 分页获取消息。

### DELETE /api/chat/conversations/:id

删除会话。返回 `{ "success": true }`。

### POST /api/chat/conversations/:id/messages — 发送消息（核心）

**请求**

```json
{ "content": "今天被老板骂了，好烦" }
```

`content` 校验：必填，trim 后长度 1–10000。

---

**响应 200 — 正常回复**

```json
{
  "status": "ok",
  "userMessage": { "id": "...", "role": "user", "content": "...", "createdAt": "..." },
  "aiMessage":   { "id": "...", "role": "assistant", "content": "...", "createdAt": "..." },
  "source": "qwen"
}
```

`source` 取值：

| 值 | 含义 |
|----|------|
| `qwen` | 云端模型生成（需用户已同意） |
| `local_template` | 确定性本地模板（降级） |

---

**响应 200 — 危机阻断**

```json
{
  "status": "blocked",
  "userMessage": { "...": "..." },
  "intervention": {
    "level": "high",
    "message": "关心的话术…",
    "resources": [ "已核验的求助资源…" ]
  }
}
```

> 危机检测**先于**同意检查与模型调用。命中时在一个事务内写入用户消息、干预回复与**唯一一条** `CrisisLog`，**模型调用次数为零**。

---

**错误**

| 状态码 | code | 说明 |
|--------|------|------|
| 400 | — | 消息内容为空或超长 |
| 503 | `CLOUD_NOT_CONSENTED` | 未同意使用云端模型 |
| 503 | `LLM_UNAVAILABLE` | 云端模型暂时不可用 |

> **任何模型失败时该次消息都不持久化**，前端保留输入供重试。

---

### 送入模型的约束（实现约定）

- 系统提示另计；业务消息最多 **20 条**（19 条历史 + 当前输入），按旧到新
- 业务消息只含 `role` 与**脱敏后**的 `content`
- 最多注入 **5 条**与当前输入存在确定性词/标签重合的显式记忆
- 手机号、邮箱、证件号等**确定性脱敏**
- **不发送**用户 ID、手机号字段、时间戳、图片、日志、无关记忆
- 输出命中红线时替换为安全模板（见 [内容审核策略](../06-合规/内容审核策略.md)）

---

### POST /api/chat/conversations/:id/messages/stream — 发送消息（SSE 流式）

与 `POST /messages` 等价的流式版本：业务校验、危机检测、模型选择与记忆注入规则完全一致，仅响应改为 Server-Sent Events 逐条下发。旧 JSON 端点 `POST /messages` 保持原契约不变，两个端点长期并存。

**请求**

```json
{ "content": "今天被老板骂了，好烦" }
```

`content` 校验与 JSON 端点一致：必填，trim 后长度 1–10000。

伴读问答可多带一个可选的 `reading`（仅 JSON 请求，multipart 轮不读）：

```json
{ "content": "读《活着》时问：他为什么这么说？", "reading": { "bookId": "…", "passage": "选中处前后的原文" } }
```

`bookId` 必须是本人书架上的书，否则 404。`passage` 由服务端截到 1500 字，作为**明确标注的资料**进系统提示（不是指令，防电子书里夹带的提示注入），**不写入消息正文、不落库**。形状不对的 `reading` 一律当作普通一轮。

---

**响应 200 — `Content-Type: text/event-stream`**

纯 `data` 帧编码（无 `event:` 行），帧间以空行分隔：

```
data: {"event":"delta","text":"我在听，"}

data: {"event":"done","status":"ok","userMessage":{...},"aiMessage":{...},"source":"qwen","offerMemory":false}

```

连接空闲时每 **15 秒**下发一次注释心跳帧 `: ping`，仅用于保活，客户端必须忽略。

`done` 的 `offerMemory`（2026-09-21 起）：这一轮用户说了「帮我记住…」「你要记得…」这类话时为 `true`，前端在这条回复下面自动打开「帮我记住」确认卡；候选仍只从那一条用户消息里提、仍须用户确认才落库。同一轮系统提示会告诉她确认卡在下面、不许说已经记住。

**每轮都在的上下文**（2026-09-21 起）：「关于她」（她设置的称呼、放在心上的记忆；生日只在前后一天以「今天/明天/昨天是她的生日」出现）、「此刻」（北京时间与距上一句话多久）、「你今天主动对她说过」（今天的提醒、关心、惦记的事与本周的信，只读取、不会顺手生成信）。相关记忆最多 5 条都给她，内核注意力只把其中最多 2 条标为可以主动提起，其余归入「知道但不必主动提」。

**事件类型**

| event | 字段 | 说明 |
|-------|------|------|
| `delta` | `text` | 增量文本，客户端按到达顺序追加渲染 |
| `replace` | `content` | 输出命中安全过滤时整体替换此前已下发的全部文本 |
| `done` | `status:"ok"`、`userMessage`、`aiMessage`、`source` | 生成完成并已落库；`source` 取值同 JSON 端点（`qwen`/`local_template`） |
| `blocked` | `status:"blocked"`、`userMessage`、`intervention` | 危机阻断；语义同 JSON 端点的 blocked 响应 |
| `error` | `code` | 生成失败，本帧之前下发的文本一律作废 |

每条消息以 `done`/`blocked`/`error` 之一收尾，终态帧之后连接关闭。

---

**error.code 语义**

| code | 说明 |
|------|------|
| `CLOUD_NOT_CONSENTED` | 未同意使用云端模型 |
| `LLM_UNAVAILABLE` | 云端模型暂时不可用 |
| `STREAM_FAILED` | 流中断或服务端中途失败 |

> **持久化保证：中途失败、断线或客户端取消时该次消息完全不落库；只有完整成功（`done`）才落库，且只落库一组（用户消息 + AI 消息）。** 危机阻断（`blocked`）沿用 JSON 端点语义，在一个事务内写入用户消息、干预回复与唯一一条 `CrisisLog`。前端在收到 `error` 或流中断时移除临时气泡并保留原输入供重试。

---

**部署备注**：反向代理必须对该路径关闭响应缓冲并保持长连接，否则事件会被整段攒批、长连接被读超时切断。本仓库 `deploy/nginx.conf` 已为该路径单独配置 `proxy_buffering off` 与长读超时，其余 `/api/` 路径行为不变。

---

**智能体工具回路（2026-09-04 起）**

两个发送端点共用 `agentTurn` 回路。工具仅在本地分发提供，Web 没有工具目录且不执行工具请求。协议、当前工具名、开关、12 次调用上限与连续失败/重复的收尾规则统一见 [Spec §4.1](../Spec_Amie_v1.0.md#41-智能体工具回路2026-09-16-修订只有一种对话)；旧日程/倒数日/打卡/自习工具已停用。全部经领域服务校验当前用户，正式记忆不开放给工具写入。

当轮执行过工具时，`done`/`POST /messages` 响应中的 `aiMessage` 携带 `toolRuns: [{tool, ok, summary}]`（未执行为 `null`），历史消息同样返回该字段；前端据此在回复下方渲染动作标签。

**页边批注 `bookNotes`（2026-09-24 起，路线图 C21）**

当轮带上了书籍技能的章节时，`aiMessage.bookNotes` 记下她写这一段时翻过的书；没翻书、小心模式、退回本地模板时为 `null`。历史消息与数据导出同样带这个字段。它是当时的快照，以后章节卡改了也不回写。

```json
[{ "book": "emotion-reflection", "title": "嫉羡与感恩", "author": "梅兰妮·克莱因", "edition": "九州出版社，2017",
   "setAside": "死本能等病因推论作为事实、……", "boundary": "Amie 选择性改编，理论参考，不是诊断或治疗。",
   "chapters": [{ "id": "envy", "title": "比较与嫉羡", "origin": "第十章", "use": "情绪与具体愿望、行为分开" }] }]
```

- 选哪几章：先看章节卡的关键词；有书架索引、这一轮又为找记忆算过这句话的向量时，所有书的关键词都一章没认出时，再用向量从整个书架补最接近的一章；她明说要办事时不补（不另调云端）。所有书放在一起排，各书轮流出自己最靠前的一章，一轮最多两章；提示词里的章和 `bookNotes` 出自同一次选择。见 [书架选章评测](书架选章评测.md)。
- `chapters` 为空：只点名了这本书（如问到克莱因的理论），没翻到具体章。
- **她自己的书**（2026-09-25 起，路线图 C22）：她选了「让她聊天时也能翻」的书，每轮用同一个查询向量找最接近的一段（余弦 ≥ 0.55，一轮最多一段），排在内置书后面。格式不同：没有 `edition`、`setAside`、`boundary`、`use`，多了 `userBook` 和阅读器位置 `locator`，前端据此「翻到这一段」（`/tools/reading/:bookId?at=<locator>&from=margin`）。

```json
{ "book": "user:<bookId>", "userBook": true, "bookId": "<bookId>", "title": "被讨厌的勇气", "author": "岸见一郎",
  "chapters": [{ "id": "<passageId>", "title": "课题分离", "origin": "第 2 章", "locator": "1:120" }] }
```
- 章节卡与书目信息：`apps/api/src/skills/<书>/chapters/*.md` 与 `SKILL.md` 的文首，选章在 `apps/api/src/services/bookShelf.js`。

---

## 三·五、语音转文字 `/api/asr`

你说、她写（路线图 C17）：书写行的麦克风把录音交给本机 FunASR 转写服务（`tools/asr-server`，模型 SenseVoiceSmall），转出来的字填进书写行，看过、改过再发。录音只在内存里经手，不落盘，不送外部服务；她那边只拿到你发出去的文字。设计与评测见[语音输入评测](语音输入评测.md)。

### GET /api/asr/status

返回 `{ available, configured, reason }`。没配 `ASR_BASE_URL`：`configured:false`、`reason:"ASR_NOT_CONFIGURED"`，界面不放麦克风。配了但转写服务连不上：`configured:true`、`available:false`、`reason:"ASR_UNAVAILABLE"`，点麦克风如实报不可用。

### POST /api/asr/transcribe

multipart 字段 `file`：WAV（`audio/wav`、`audio/x-wav`、`audio/wave`），≤ 4MB（16kHz 单声道约 2 分钟；浏览器负责转码）。成功返回 `{ text }`：只有文字——SenseVoice 听出来的情绪与事件标签不出这一层，也不以表情夹在文字里；没听到人声时 `text` 为空字符串。

| 情况 | 状态码 |
| --- | --- |
| 没带音频、类型不对、超过 4MB，或转写服务判定不是 16kHz 单声道（原文透传） | 400 |
| 没配 `ASR_BASE_URL` | 503 `ASR_NOT_CONFIGURED` |
| 转写服务离线、超时（30 秒）或返回异常 | 503 `ASR_UNAVAILABLE` |

---

## 四、记忆 `/api/memories`

长期记忆仅使用**用户已确认的正式记忆**（根）；她自己整理的关系、理解与惦记的事是她的组织层（`inferences`），永远不是记忆：聊天时标成「她自己的联想」，进根只能经来信建议、你点同意（路线图 C23）。所有创建、导入共用正式写入服务，版本历史与来源独立保存。

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/memories` | 创建 |
| GET | `/api/memories` | 列表（带当前用户归属检查） |
| PUT | `/api/memories/:id` | 编辑，必须携带 expectedRevision；冲突 409；正文/类型变化时，她以这条为依据的关系与理解作废 |
| PUT | `/api/memories/:id/pin` | `{pinned: boolean}` 放在心上 / 拿下来（2026-09-21 起）。每轮都带给她、不参与相关检索；每人最多 5 条，满了 400「最多放 5 件在心上，先拿下一件再放」。不改内容、不升版本、不写修订记录 |
| GET | `/api/memories/:id` | 详情，包含 revision、sources、origin 与 importedAt |
| DELETE | `/api/memories/:id` | 删除正式内容、历史、投影与依赖（她以这条为依据的整理连同引文一起删）；原始聊天单独管理 |
| GET | `/api/memories/inferences` | 「她猜的」（2026-09-25 起）：有效、没过期的组织层条目 `{items:[{id, kind:'relation'\|'insight'\|'followup', content, because:[原话≤2], dueOn, createdAt}]}`，没经你确认 |
| DELETE | `/api/memories/inferences/:id` | 删掉她的一个猜测 = 否决：内容与依据清空、只留去重键，她不会再推出同一条；不在或不是自己的 404「这一条已经不在了」 |

**字段**

| 字段 | 说明 |
|------|------|
| `type` | `semantic` · `episodic` · `procedural` |
| `content` | 记忆内容 |
| `importance` | 重要度，仅在相关结果内排序 |
| `tags` | 标签，用于与当前输入做确定性重合匹配 |
| `pinned` | 是否放在心上（列表中排在最前）；导出包含此字段 |
| `expiresAt` | 有效期；只由服务端按需设置（如回想的「近期小结」），其余为空 |
| `revision` | 当前修订；修改与恢复按预期修订校验 |
| `sources` / `origin` | 结构化来源与确认来源；无法证明的历史来源不补造 |

### POST /api/memories/suggestions — 按需记忆建议（W3）

用户在聊天中主动请求“帮我记住”时，由**云端模型**从一条消息临时抽取候选记忆（与聊天同一同意门）。

**请求**

```json
{ "messageId": "msg-uuid" }
```

- 只接受**当前用户拥有**的 `role=user` 消息 ID。

**响应**

```json
{ "candidates": [{ "type": "semantic", "content": "用户喜欢吃火锅", "importance": 7, "tags": ["饮食"] }] }
```

- `candidates` 最多 2 项，字段约束与 `POST /api/memories` 创建接口一致（type 三选一、importance 1–10、tags 最多 10 项、content 最长 2000 字），越界候选直接丢弃。
- 与现有记忆做规范化精确去重；输入命中危机检测、或候选含联系方式/证件号/精确位置/医疗内容时返回 `{ "candidates": [] }`。
- 模型输出无法解析为 JSON 时同样返回空候选，不报错。

**错误语义**

| 状态码 | code | 场景 |
|--------|------|------|
| 400 | — | `messageId` 缺失，或目标消息不是用户发送的 |
| 404 | — | 消息不存在或不属于当前用户 |
| 503 | `CLOUD_NOT_CONSENTED` | 未同意使用云端模型 |
| 503 | `LLM_UNAVAILABLE` | 云端模型暂时不可用 |

**隐私性质**：候选由云端模型生成，与聊天走同一同意门（未同意返回 `CLOUD_NOT_CONSENTED`）与同一脱敏规则；候选为**临时**数据，只存在于响应体，不落库；经用户确认后才可通过既有 `POST /api/memories` 落库。日志只记 requestId 与结果计数，不记消息或候选内容。

### POST /api/memories/index-jobs — 向量补算（2026-09-25 起同时补记忆与她上传的书）

body `{ mode: "repair" | "rebuild" }`，缺省 `repair`：只补派生索引 `embeddings` 里缺的、正文变了的、换了模型的；`rebuild` 全部重算。返回 **202**。任务总数 `total` = 未过期的记忆 + 她上传且整理好的书的段落。向量服务独立配置，失败不阻断保存或关键词检索。旧入口 `POST /api/memories/embeddings/rebuild` 已于 2026-09-25 删除（路线图 C23），用 `mode: "rebuild"` 代替。

**响应**

```json
{ "id": "job-id", "mode": "rebuild", "status": "queued", "total": 3, "processed": 0, "embedded": 0, "failed": 0, "skipped": 0 }
```

**错误语义**

| 状态码 | code | 场景 |
|--------|------|------|
| 503 | `CLOUD_NOT_CONSENTED` | 未同意使用云端模型 |
| 503 | `LLM_UNAVAILABLE` | 云端模型暂时不可用 |

创建回执不表示完成。通过 `GET /api/memories/index-jobs/:id` 查询实际状态，`POST /api/memories/index-jobs/:id/cancel` 取消。未配置向量服务返回 503 `EMBEDDING_NOT_CONFIGURED`。

**投影性质**：向量独立存表，严格匹配修订、供应商、模型、维度与规则版本，不进入记忆 API 响应或提示词；状态接口可显示单独配置的向量模型名称。全库融合关键词与合格语义候选，最多 5 条主要记忆、每条最多 2 个有效已确认关联。失败不删除仍有效的旧投影。

---

## 四·五、读书 `/api/reading`

**书默认存在用户自己的浏览器里（IndexedDB），不上传。** 服务端只记书目、阅读进度和笔记；`locator` 是前端给的不透明进度串（`"<章序号>:<章内字符偏移>"`），服务端只存不解析。

她确认「让她聊天时也能翻」的书（路线图 C22），前端才把本机解析好的章节传上来：服务端切段（约 600 字、重叠约 80 字，在句末断开），在后台用 `MEMORY_EMBEDDING_*` 配的向量模型分批算，整本一次写进 `book_passages`，中途失败不留半本。撤回上传、删书都会删掉这些段落。

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/reading/books` | 书架（按最近更新排序，带 `noteCount`） |
| POST | `/api/reading/books` | `{title, author?, format?, fileName?, totalPages?, status?}`；`format` 为 `epub`/`txt`，留空表示聊天里随口记下的纸书 |
| PUT | `/api/reading/books/:id` | 改书目；可带 `currentPage`、`percent`、`locator` |
| PUT | `/api/reading/books/:id/progress` | `{locator?, percent?}` 阅读器一边读一边回存；只动进度，想读的书会转为在读，读到 100% 不自动标记读完 |
| DELETE | `/api/reading/books/:id` | 删书（笔记、上传的段落级联删） |
| POST | `/api/reading/books/:id/content` | `{chapters: [{title, text}]}`：她确认后上传本机解析好的章节，全书最多 150 万字（超了 413），请求体上限 8MB。立即返回 202 和书目（`serverIndex: "indexing"`），后台整理。没同意当前版本的云端处理 → 503 `code: CLOUD_NOT_CONSENTED`；没配向量模型 → 503 `code: EMBEDDING_NOT_CONFIGURED`（2026-09-25 起与记忆补算同一个码）；纸书 400；正在整理 409 |
| DELETE | `/api/reading/books/:id/content` | 「只留在设备上」：停掉整理，删掉服务器上的段落，`serverIndex` 回到 `null` |
| GET | `/api/reading/shelf/builtin` | Amie 的藏书：`{books: [{name, title, author, edition, setAside, boundary, chapters: [{id, title, origin, use}]}]}`，不带正文 |
| GET | `/api/reading/shelf/builtin/:name` | 点开一本藏书：同上，`chapters` 多了 `content`（Amie 的改编章节，不是原书）；没有这本 404 |
| GET | `/api/reading/books/:id/notes` | 这本书下的笔记 |
| POST | `/api/reading/books/:id/notes` | `{content, page?, quote?, locator?, aiComment?}`；给了 `aiComment`（从伴读问答里记下来的她的回答）时 `aiCommentSource` 记为 `chat` |
| GET | `/api/reading/notes?limit=&before=` | 手记时间线：最近的读书笔记（新到旧，带书名），每页最多 100 条 |
| POST | `/api/reading/notes` | `{book, note?, page?}` 按书名记一笔；书不在书架会自动放上去（在读）。只给 `page` 就只推进度 |
| DELETE | `/api/reading/notes/:noteId` | 删除一条笔记 |

字段上限：书名 100、作者 50、感想 500、原文 `quote` 1000、她的回应 1000、文件名与 `locator` 各 200，`percent` 为 0–100 的整数。

书目里的上传状态：`serverIndex` 为 `null`（只在她的设备上）、`indexing`（正在整理，`indexProgress: {done, total}` 按段计）、`ready`（聊天时能翻）或 `failed`（没整理成，可以重新上传）；`indexedAt` 是整理好的时间。进程重启时正在整理的书会被标成 `failed`。

## 五、日记 `/api/diary`（2026-09-04 起）

按本地日历日一记（userId+day 唯一，UTC 零点存储契约同经期/倒数日）。

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/diary?month=yyyy-MM` | 月列表（day 降序；month 非法 400） |
| GET | `/api/diary/:day` | 单日详情；无记录 404 |
| PUT | `/api/diary/:day` | 新增/覆盖 `{content(1–2000), mood}`；内容变更会清空旧 AI 回应 |
| DELETE | `/api/diary/:day` | 删除该日日记 |

`mood ∈ happy|neutral|sad|angry|anxious`（与聊天情绪同词表）。以前生成过的 `aiComment / aiCommentSource` 只读保留在响应里；模拟回应接口（日记与阅读短评）已于 2026-09-19 删除。

## 六、安排 `/api/reminders`（2026-09-15 起替代日程、倒数日、提醒、手帐与自习）

Web 版可用（2026-09-19 起不再按分发拦截）。用户可见名为「安排」，模型与表名仍为 `ScheduledReminder`。

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/reminders/scheduled` | `{reminders}`，按 `nextFireAt` 升序 |
| POST | `/api/reminders/scheduled` | 201 `{reminder}`。`{content(1–200), freq, time(HH:mm), date?, weekdays?, monthDay?, instruction?}`；`freq ∈ once|daily|weekly|monthly|yearly`，`once/yearly` 需 `date`（`yearly` 取月日，2 月 29 日在平年落到 28 日），`weekly` 需 `weekdays`（0–6，0 为周日），`monthly` 需 `monthDay`（1–31）；`instruction`（≤500）表示交给她做的事 |
| PUT | `/api/reminders/scheduled/:id` | `{reminder}`。可改 `content / instruction / status(active|paused|done) / freq / time / date / weekdays / monthDay`；改期时重算 `nextFireAt`，已完成的安排改期后重新生效；非本人 404 |
| DELETE | `/api/reminders/scheduled/:id` | `{ok:true}`；非本人 404 |
| GET | `/api/reminders/due` | 前台轮询：幂等生成到点投递，返回 `{deliveries, deferredTaskCount, execution}`。有指令的任务云端执行尚未接通，保持待处理、不出现在 `deliveries`，只计入 `deferredTaskCount` |
| POST | `/api/reminders/deliveries/:id/ack` | `{action: shown|dismissed}` → `{delivery}`；一次性安排确认后置为 `done`，循环安排推进到下一次 |

旧数据迁移：`pnpm --filter cyber-sister-server db:migrate:plans -- --dry-run` 先看条数，去掉 `--dry-run` 才写入；按 `users.plans_migrated_at` 每个用户只迁一次，规则见 CHANGELOG 2026-09-15。

2026-09-18：迁移在同一事务内条件更新 `plansMigratedAt=null` 领取用户，插入失败连同标记一起回滚；并发未领取者跳过。循环安排的 `status=done` 结束整个系列，不是逐次打卡。聊天工具 `list_tasks` 独立提供状态筛选（默认 `active`）与 20 条分页，返回 `{items, status, hasMore, nextOffset}`；上表 HTTP 列表响应保持兼容。

~~`/api/habits`、`/api/study`~~：2026-09-15 下线（404），数据只随导出带出。

### 睡眠卡：晚安提醒与早安闹钟（2026-09-28 起，路线图 C28）

日程页（原「日历」）顶上的两行。两条就是 `ScheduledReminder`，`kind` 为 `bedtime` / `wake`（日程里的事是 `plain`），每人各至多一条。

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/reminders/sleep` | `{bedtime, wake, due}`。`bedtime` / `wake` 为 `{id, enabled, time, weekdays, nextFireAt}` 或 `null`（没设过）；每天的 `weekdays` 是 0–6 全部。读取时顺带为到点的这两条幂等建投递并推进到下一次（与对话页便签同一个「读的时候生成」）。`due` 是还在有效期、没收起的睡眠便签 `[{id:'reminder:<投递 id>', kind:'bedtime'|'wake', fireAt, line:{text, source}}]`：早安是那天早上的一句（古诗词的 `source` 为「作者《篇名》」，原创为空串）；晚安是一句晚安话，明早 14 小时内开着闹钟就补「明早 HH:mm 叫你。」 |
| PUT | `/api/reminders/sleep` | `{bedtime?, wake?}`，每项 `{enabled:boolean, time:'HH:mm', weekdays:[0–6，至少一天]}` → `{bedtime, wake}`。七天全选存成 `daily`，否则存成 `weekly`；`enabled:false` 存成 `paused`，时间保留；改过的那一类还没收起的便签一并收起。什么都没传或校验不过返回 400 |

- `GET /api/reminders/scheduled`、聊天工具 `list_tasks` / `day_review` 只返回 `plain`；对这两条调 `PUT` / `DELETE /api/reminders/scheduled/:id` 返回 400「闹钟和晚安提醒在日程页的睡眠卡里改」。
- 到点不等确认就推进：好几天没打开，只给最近一次建投递。有效期是早安响后 4 小时、晚安到次日凌晨 5 点，过了的不再出现在 `due` 和对话便签里。
- 「起来了」「知道了」走 `POST /api/chat/nudges/:id/ack`。
- 句子与抽法见[早安句库](../02-设计/早安句库.md)：按「用户 + 季节」固定洗牌，同一天总是同一句，不落库。
- 响铃（Web Audio 合成）与系统通知（浏览器 `Notification`）都由开着的网页自己发，服务端没有推送。
- 过了开着的晚安提醒的钟点（5 小时内）还在聊，这一轮的分寸里多一句「她给自己定了 23:30 睡……只说一次」，取代「聊了一个多小时」那一句。
- 导出的 `scheduledTasks` 每条多一个 `kind`。

---

## 七、经期 `/api/tools`

Web 版可用。经期是敏感个人信息：新增（POST）、修正（PUT）以及聊天工具读取前须单独同意，否则 403 `PERIOD_CONSENT_REQUIRED`；查看与删除自己的记录不受限。日程（`/todos`）、倒数日（`/countdowns`）与旧提醒开关（`/reminders`）已于 2026-09-15 下线（404）。

| 方法 | 路径 | 说明 |
|------|------|------|
| GET/POST | `/api/tools/period` | 经期记录读取 / 记录（`startDate` 必填，`endDate` 可选，`cycleDays` 20–45，默认 28） |
| GET | `/api/tools/period/summary?today=yyyy-MM-dd` | 服务端预测下一次日期与剩余天数 `{asOf, nextDate, daysUntil, overdueDays, basedOnRecordId, source}`；过了预计日期 `daysUntil` 为 0、`overdueDays` 为晚了几天（2026-09-21 新增） |
| GET/PUT | `/api/tools/period/consent` | 单独同意状态 `{accepted, updatedAt}`；PUT `{accepted:boolean}` 同意或撤回；撤回时「顾及周期」一并关闭 |
| GET/PUT | `/api/tools/period/tone` | 「聊天时让她顾及你的周期」`{enabled, updatedAt}`；PUT `{enabled:boolean}`。没有记录同意时打开返回 403 `PERIOD_CONSENT_REQUIRED`，关闭总是可以。打开后只在经期里的那几天把「在经期」交给模型调语气（2026-09-21 新增） |
| PUT/DELETE | `/api/tools/period/:id` | 修正 / 删除一条记录（归属校验，不能倒置日期范围） |

---

## 八、装扮里的收藏 `/api/collection`（2026-09-21 起）

衣柜（`wardrobe`）与化妆间（`makeup`）共用。取代旧的妆容预设 `/api/makeup-presets`、3D 衣柜 `/api/wardrobe` 与模拟预览 `/api/work/media/*`（均已删除；`makeup_presets`、`wardrobe_items` 只读保留供导出）。

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/collection?shelf=wardrobe\|makeup` | `{ items }`，新的在前；每件 `{id, shelf, category, name, note, status, link, photoUrl, thumbUrl, createdAt, updatedAt}`，没照片时两个地址为 `null` |
| POST | `/api/collection` | multipart。文字字段：`shelf` 必填；`name` 必填 ≤40 字；`category` 可空，只能取固定清单（衣柜：上衣、下装、连衣裙、外套、鞋、包、配饰；化妆间：底妆、眼妆、唇妆、护肤、香水、工具）；`status` 为 `want`/`have`，缺省 `have`；`note` ≤300 字；`link` 只收 http(s) ≤2000 字，**服务器从不访问它**。文件：`photo`（≤3MB）与 `thumb`（≤512KB）要么都有要么都没有，只收 JPEG（按文件签名校验），存之前去掉 EXIF/XMP/IPTC 与注释段。每人最多 500 件，满了 400 |
| PUT | `/api/collection/:id` | 同样的格式，只改传了的字段，可换照片；`shelf` 不能改；非本人 404 |
| DELETE | `/api/collection/:id` | 删除行与照片文件；非本人 404 |
| GET | `/api/collection/:id/photo`、`/thumb` | JPEG，`Cache-Control: no-store`；没有照片或非本人 404 |

照片存在 `COLLECTION_DIR`（默认 `apps/api/data/collection/<userId>/<id>.jpg` 与 `.thumb.jpg`，在 API 数据卷里，数据库备份不含）。她读收藏走聊天工具 `list_collection`：只返回名字、柜子、分类、想要/已有、备注（最多 60 件），不含照片与链接。

## 八·五、天气 `/api/weather`（2026-09-27 起）

城市是用户在设置里自己填、从候选里选的（名字、省份、国家、坐标、时区，存 `users.weather_place`），**不定位**。数据源 Open-Meteo（免费、无密钥，CC BY 4.0，界面署名）。服务器按坐标（两位小数）缓存 30 分钟。`WEATHER_ENABLED=false` 时关闭。日志只记错误码，不记城市、坐标与查询词。

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/weather` | 没填城市：`{ place: null }`。填了：`{ place: {name, admin1, country}, current: {temperature, condition, icon} \| null, today, tomorrow, source: "Open-Meteo" }`，`today`/`tomorrow` 为 `{date, condition, icon, min, max, precipitation}`（温度取整；`icon` ∈ clear/partly/cloudy/fog/rain/snow/thunder）。不回坐标。关闭或数据源失败 503 `WEATHER_UNAVAILABLE`；缺明天也算取不到 |
| GET | `/api/weather/places?q=` | 按城市名找候选，最多 5 个 `{places: [{name, admin1, country, latitude, longitude, timezone}]}`；空查询 400；每人每分钟 20 次 |
| PUT | `/api/weather/place` | 存下选中的城市 `{name, admin1?, country?, latitude, longitude, timezone?}`：名字 ≤40 字，纬度 ±90、经度 ±180，否则 400；返回 `{place}`（不带坐标） |
| DELETE | `/api/weather/place` | 清除城市，返回 `{place: null}` |

聊天时服务端用同一份城市取两天预报，拼成【她那边的天气】放进上下文（1.5 秒超时，取不到就不带，不影响这一轮）。

---

## 八·六、宠物 `/api/pets`（2026-09-27 起）

内置 `cat | dog | rabbit | hamster` 四种，每人每种最多一只。好感度与成长值**只涨不掉**；日子按北京时间算。视图 `pet`：`{species, name, affection, growth, stage: {index, name, from, to|null}, hearts: 0–5, pettedToday, petCap}`。

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/pets` | `{food, foodCap: 30, dailyFood: 3, claimedToday, active, pets: [pet]}`；只读，不发零食 |
| POST | `/api/pets/daily` | 领今天的零食：`{granted, ...同上}`；同一北京日期再领 `granted: 0`，碗满（30）也算领过；并发只生效一次 |
| POST | `/api/pets` | 领养 `{species, name?}`：名字去控制字符、最多 12 字，空则默认名（团子 / 豆豆 / 棉花 / 栗子）；已有这一种就只是换成在养它；不认识的种类 400 |
| PUT | `/api/pets/active` | 换成在养 `{species}`；没领养过 404 |
| PUT | `/api/pets/:species` | 改名 `{name}`；没领养过 404 |
| POST | `/api/pets/:species/feed` | 用掉一份零食：成长值 +10、好感度 +2，返回 `{pet, food, gained, grewUp}`；没零食 409 `NO_FOOD` |
| POST | `/api/pets/:species/pet` | 摸一摸：每只每天前 10 次好感度 +1，之后 `gained: 0`；返回 `{pet, gained}` |

喂与摸按用户限流（每分钟 60 次）。前端一段摸的手势只报一次。

---

## 九、花草图鉴 `/api/garden`（2026-09-26 起）

路线图 C26。拍一张花草 → 她认一认、讲一讲 → 收不收由你；不认也可以自己写名字收进来。收藏与照片存储和装扮同一套做法（`utils/photoStore.js`）。

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/garden/identify` | 认一认。multipart，只要一个 `photo`（在这台设备上压缩好的 JPEG，≤3MB）。**照片不落盘**：去掉 EXIF/XMP 后只在这一次请求里交给聊天那个视觉模型（`GATEWAY_QWEN_MODEL` 要是视觉模型；场景 `chat`，讲解按你选的说话方式），提示词 `plant-id-v1`。要 `cloud-primary-v4` 云端同意，每人每小时 30 次。返回见下 |
| GET | `/api/garden?status=met\|grow` | `{ entries }`，新的在前；每株 `{id, name, scientificName, family, status, note, candidates, explanation, caution, reference, identified, photoUrl, thumbUrl, createdAt, updatedAt}`（`reference` 是收进来那一刻的名录与毒性核对，2026-09-27 之前收的为 `null`），没照片时两个地址为 `null` |
| POST | `/api/garden` | 收进图鉴。multipart。文字字段：`name` 必填 ≤40 字；`scientificName` ≤80；`family` ≤40；`status` 为 `met`（路上遇见，缺省）/ `grow`（我养的）；`note` ≤300；`identification` 可选，是认一认返回的那段 JSON（≤16KB，服务器按同一份形状再校验、超长截断，读不出 400）；`pick` 是选了第几个候选（`0`–`2`，自己写名字就不传）。**讲解是照第一个候选写的，只有 `pick=0` 才存讲解**；候选和提醒照存。文件：`photo`（≤3MB）与 `thumb`（≤512KB）要么都有要么都没有，只收 JPEG，存之前去掉拍摄信息。每人最多 1000 株 |
| PUT | `/api/garden/:id` | 改名字、学名、科、遇见/养着、备注，可换照片；识别结果不能改；非本人 404 |
| DELETE | `/api/garden/:id` | 删除行与照片文件；非本人 404 |
| GET | `/api/garden/:id/photo`、`/thumb` | JPEG，`Cache-Control: no-store`；没有照片或非本人 404 |

认一认的返回：

```json
{
  "isPlant": true,
  "candidates": [
    { "name": "栀子花", "scientificName": "Gardenia jasminoides", "family": "茜草科", "likelihood": "很像" },
    { "name": "白兰", "scientificName": null, "family": "木兰科", "likelihood": "拿不准" }
  ],
  "explanation": { "what": "…", "howToTell": "…", "season": "…", "lore": "民间说法：…", "care": "…" },
  "caution": "叶子和果实别让猫啃。",
  "promptVersion": "plant-id-v1",
  "identifiedBy": "qwen-vl-max"
}
```

- `likelihood` 只有「很像 / 可能是 / 拿不准」三档，不给百分比；最多 3 个候选。不是植物时只有 `{"isPlant": false, "candidates": []}`。
- 讲解五段按字截断（what / howToTell / care ≤200 字，season ≤120，lore ≤200），没有的段为 `null`；全空时 `explanation` 为 `null`。
- **代码里再兜一道**：讲解某段说能吃、能泡水、能入药或有疗效的，整段去掉（同一小句里有「别 / 不能 / 切勿」的劝阻不算）；讲解和提醒都过一遍回复同款的红线判断；候选像菌菇的，`caution` 换成固定一句「菌菇认错的后果很重：不管它像什么，都别吃，也别让猫狗碰。」，「想养的话」去掉。
- **本机名录与毒性库**（2026-09-27 起，路线图 C27）：认一认的返回多一个 `reference`，由服务器在本机资料里核出来，不另调任何外部服务：
  ```json
  "reference": {
    "checked": true, "toxicChecked": true,
    "candidates": [{ "found": true, "standardName": "夹竹桃", "scientificName": "Nerium oleander L.", "family": "夹竹桃科", "scrutiny": "审核专家与日期", "via": "scientific" }, { "found": false }],
    "toxic": [{ "candidate": 0, "name": "夹竹桃", "recordedAs": "欧洲夹竹桃", "level": "有毒", "parts": ["全株"], "by": "species" }],
    "sources": { "checklist": { "title": "…", "database": "China Checklist of Higher Plants", "node": "Species 2000 China Node" }, "toxic": { "title": "《中国植物志》经济用途 · 中国有毒植物", "via": "iPlant 植物智（中国科学院植物研究所）" } }
  }
  ```
  `candidates` 与模型的候选一一对应：在《中国生物物种名录》植物界里先按完整学名（含变种）、再按属 + 种（同一种下有和她说的中文名一样的变种就取它，否则取种本身）、再按异名（名录带异名时；2026 版没有）、最后按中文名（只认唯一的一种）找，`via` 为 `scientific` / `synonym` / `chinese`；**不改模型的候选名**，页面在旁边写「名录里有，名录作「…」」或「中国名录里没查到」。`toxic` 是候选里在《中国植物志》「中国有毒植物」有记载的（按这一种、按学名、按属，或按名录里的叫法与她说的叫法认，`by` 为 `species` / `genus`），`level` 为 剧毒 / 有毒 / 小毒 或 `null`（列为有毒但摘录里没写清），`parts` 是记载的有毒部位；原文里的药用说法不进索引、不返回。没装资料时 `checked` / `toxicChecked` 为 `false`、两个数组为空，页面什么都不标。收进图鉴时服务器按候选重核一遍再存（不信前端带回来的），每株多一个 `reference` 字段，随数据导出。资料的来源、条款与怎么建见[花草识别评测](花草识别评测.md)「名录与毒性」。
- 错误（带 `code`）：没同意云端 503 `CLOUD_NOT_CONSENTED`；没配模型或这会儿没回话 503 `LLM_UNAVAILABLE`；回了但读不出形状 502 `PLANT_ID_UNREADABLE`；超过每小时 30 次 429。页面按 `code` 说清原因，没同意时给一条去设置的路，并保留「自己写名字」。

照片存在 `GARDEN_DIR`（默认 `apps/api/data/garden/<userId>/<id>.jpg` 与 `.thumb.jpg`，在 API 数据卷里，数据库备份不含）。她读图鉴走聊天工具 `list_garden`（只读，`status` 与 `keyword` 可选）：只返回名字、科、路上遇见/我养的、哪天收的（北京时间）、备注，外加一共几种（同名算一种，最多 60 株），不含照片、讲解与识别细节；聊天里不能加、改、删。数据导出多一段 `garden`：名字、学名、科、状态、备注、候选、讲解、提醒、提示词版本、模型与有没有照片（照片不进导出包）。识别准不准见[花草识别评测](花草识别评测.md)。

---

## 十、模型状态 `/api/llm`

### GET /api/llm/status

登录用户可查看**去敏后**的模型状态。聊天为云端唯一路径，响应形状：

```json
{
  "mode": "external_primary",
  "local": { "configured": false, "state": "removed" },
  "isInstanceAdmin": false,
  "externalFallback": {
    "configured": true,
    "primary": true,
    "consent": null,
    "version": "cloud-primary-v4",
    "providers": [{ "name": "甲家", "model": "jia-chat" }]
  }
}
```

- `mode` 恒为 `external_primary`；`local` 段固定 `{configured:false, state:'removed'}`，仅为兼容既有消费方读取
- `externalFallback.consent` 三态同 `/api/user/external-llm-consent`；`version` 为当前同意版本 `cloud-primary-v4`
- `isInstanceAdmin`（2026-09-22 起）：这台实例的管理员（`INSTANCE_ADMIN_PHONES` 与内测白名单的交集）。前端据此决定设置页的「模型供应商」卡片是否出现；**它本身不构成权限**，管理接口各自再判一次
- `externalFallback.providers`（2026-09-22 起）：启用且承接对话的供应商**显示名与模型名**，按优先级排列；**不含** `base_url` 与密钥。没有自定义供应商（仍用 `GATEWAY_QWEN_*` 环境变量槽）时为空数组

---

## 十·五、模型供应商管理 `/api/admin/model-providers`（2026-09-22 起）

实例管理员在应用里配置多家 **OpenAI 兼容** 的聊天模型（DeepSeek、DashScope 兼容模式、Moonshot、智谱、硅基流动、火山方舟、自建 vLLM / Ollama 都走这一种协议），不再绑死单一家厂商的环境变量槽。配了多家就按列表顺序依次尝试：前一家不通，网关自动换下一家。

每个接口都要求登录 **且** 是实例管理员（`INSTANCE_ADMIN_PHONES` 与内测白名单的交集），非管理员一律 `403 INSTANCE_ADMIN_REQUIRED`。

密钥**只写不读**：能新增或覆盖，任何响应里只有 `hasKey` 布尔值——没有密文，也没有明文。密钥以 AES-256-GCM 密文存进 `model_providers.api_key_encrypted`，主密钥来自只读文件 `MODEL_CONFIG_KEY_FILE`（怎么生成、放哪、怎么备份见《单机内测部署与回滚手册》）。主密钥缺失或格式不对时写不进去（503），**不会**静默降级成明文或不加密。

任何一次写成功都会立刻生效：服务端重读启用的供应商并重建网关，不需要重启。

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/admin/model-providers` | `{ providers: [...] }`，按优先级（即列表顺序）排 |
| POST | `/api/admin/model-providers` | 新增。body：`{ name, baseUrl, model, scenes?, enabled?, apiKey? }`；`scenes` 缺省 `['chat']`；`apiKey` 留空表示这家不需要密钥（自建端点常见）；返回 `{ provider }` |
| PUT | `/api/admin/model-providers/:id` | 只改传了的字段，字段同新增；`apiKey` 传非空字符串就覆盖、传 `''` 或 `null` 就清掉、不传就不动；只传 `enabled` 就是启停；返回 `{ provider }` |
| PUT | `/api/admin/model-providers/order` | 排序。body `{ ids: [...] }`，必须正好覆盖现有的全部供应商，按传入顺序把 `priority` 写成 1..n；返回 `{ providers }` |
| DELETE | `/api/admin/model-providers/:id` | 删掉；返回 `{ success: true }` |
| POST | `/api/admin/model-providers/:id/test` | 「试一下」：发一次最小的真实请求（`max_tokens: 1`），**会真的花一点点钱**；成功返回 `{ ok: true, latencyMs, model, reply }` |

供应商对象（所有响应里都是这个形状，绝不含密钥）：

```json
{
  "id": "b1c2…",
  "name": "甲家",
  "baseUrl": "https://api.example.com/compatible-mode/v1",
  "model": "some-chat-model",
  "scenes": ["chat", "explain"],
  "priority": 1,
  "enabled": true,
  "hasKey": true,
  "updatedBy": "管理员用户 id",
  "createdAt": "2026-09-22T00:00:00.000Z",
  "updatedAt": "2026-09-22T00:00:00.000Z"
}
```

字段约束与校验：

- `name` ≤40 字；`model` ≤120 字；`scenes` 只能取 `chat` / `explain` / `work` 的组合且至少一个；整个实例最多 8 家
- `baseUrl` 必须 https（只有本机运行时——`APP_DISTRIBUTION=local` 且绑回环地址——才允许 `http://127.0.0.1`）、不得内嵌账号密码、不得指向本机 / 内网 / 回环 / 链路本地地址（防 SSRF）。保存时校验一次；「试一下」在真发请求前再校验一次，并按 DNS 解析结果再拒一次
- `priority` 由排序接口维护，不接受客户端直接写

错误语义：

- `400`：字段不合法，`error` 是中文原因（前端照实显示）
- `403 INSTANCE_ADMIN_REQUIRED`：不是实例管理员
- `404`：id 不存在
- `502`：`/:id/test` 没打通（上游状态码 / 超时 / 返回不是 OpenAI 兼容格式），`error` 只给稳定原因，不回显上游正文与密钥
- `503`：主密钥缺失或解不开，写不进去

审计：新增 / 编辑 / 排序 / 删除各记一条结构化日志（`action: model_provider.*`、管理员用户 id、供应商**显示名**），**不含密钥、不含地址**；见 §十五 日志规范。

---

## 十一、合规与使用时长 `/api/compliance`

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/compliance/usage/start` | 开始计时 |
| POST | `/api/compliance/usage/heartbeat` | 心跳 |
| POST | `/api/compliance/usage/end` | 结束计时 |
| GET | `/api/compliance/usage/status` | 查询使用时长状态（用于 2 小时提醒） |


## 十二、~~「她」的待确认记忆 `/api/derived`~~ — 已下线（2026-09-23）

2026-09-25 起（路线图 C23）：回想产出的理解、记忆之间的关系与惦记的事都在她的组织层 `inferences` 里，旧表 `derived_insights` / `memory_edges` / `follow_ups` 已于 2026-09-26 删除。组织层永远不是记忆，信里的建议也要用户点「同意采纳」才动记忆；你能在 `GET /api/memories/inferences`（「她猜的」）看到、删掉（§四）。「她惦记的事」到日子进对话末尾那条时间线（`followup:` 来源），依据必须是你说过的原话。原来的 `/api/derived*` 接口不再恢复。

## 十三、主动关怀 `/api/care`（2026-09-09 起）

「她来想你」触点：**in-app 拉取，内测无推送通道**。规则引擎基于真实数据（生日/经期预测/倒数日/日程逾期与到期/手帐连续断签/自习连续中断/昨日心情）产出最多 3 条卡片，每条附 `reason`（为什么看到这条）与跳转；`users.care_enabled` 为总开关（设置页）。

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/care/touchpoints` | 当前触点（按日忽略过滤后）：`{ "touchpoints": [{ "key", "kind", "title", "body", "reason", "action": { "to", "label" } }] }` |
| POST | `/api/care/touchpoints/dismiss` | 按日忽略；请求 `{ "key" }`，同日同键幂等 |

## 十四、她的来信 `/api/letters`（2026-09-23 起）

按用户设定的频率（`users.letter_freq_days` = 3/7，空 = 不写信）在服务器端根据记忆与近况写信，幂等唯一于 `用户 + 周期起点`（本地日、UTC 零点）。正文 ≤1200 字，段落间空行；命中敏感正则（联系方式/证件号占位、精确位置、医疗与经期）的段整段删除。建议 ≤3 条：

- `edit_memory`：建议把那条记忆改成 `suggestText`（`memoryId`/`quote` 只能指向本次素材里未过期的记忆，`quote` 逐字出自原文；`memoryRevision` 为服务端当前版本）
- `delete_memory`：建议删掉那条记忆（`suggestText` 恒空）
- `plan`：建议安排一件事（`suggestText` 正文，`instruction` 可选=交给她到点做，`planDate` 可选 `YYYY-MM-DD`）
- `merge_memories`（2026-09-25 起）：她整理出一条「相似」关系，建议把两条合成一条。`inferenceIds` 指向那条关系；`pair` 是两条记忆 `[{id, revision, content}]`（以写信时的素材为准，不信模型）；`suggestText` 是合并后的一句
- `resolve_conflict`（2026-09-25 起）：她整理出一条「矛盾」关系，请你定夺。`inferenceIds`、`pair` 同上；`suggestText` 可空，是她建议的统一说法
- `promote_inference`（2026-09-25 起）：她的一条理解有你的原话作证，建议记成一条记忆。`inferenceIds` 指向那条理解；`quote` 是她引的原话；`suggestText` 是要记成的一句（你的口吻）
- `chatText`：用户视角可以直接发给她的一句话（空则前端用模板句）
- `decided`：`null`（未处理）· `accepted` · `dismissed`

生成双路：同意云端时先回想一次（整理进她的组织层；有效、没进过信的理解与关系是本封信的素材，进过信的记下 `letteredAt`、不再进下一封，作废的不进）再交给模型组信（服务端逐条校验建议，不信模型：从草稿来的建议必须指向这封信素材里的条目、种类对得上，记下来的理解必须有原话作证）；未同意或模型失败降级本地模板（`suggestions: []`）。沉默期（窗口内没有聊天/记忆/日记/读书/做完的安排，也没有草稿）宁缺毋滥，不写也不留空信。

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/letters` | 历史列表（新到旧），不自动生成 |
| GET | `/api/letters/:id` | 单封；非本人 404 |
| POST | `/api/letters/generate` | 到期就写一封（幂等）：`{letter, created, reason?}`，`reason` ∈ `off`（没开写信）\|`not_due`\|`quiet` |
| POST | `/api/letters/:id/read` | 记下读过；已读再调幂等返回 `{success:true}`，信不存在 404 |
| POST | `/api/letters/:id/suggestions/:index/decide` | 一键处置，body `{decision:'accept'\|'dismiss', content?, expectedRevision?, keep?}`；返回 `{letter}`（整封更新后）。由提议通道 `services/memory/proposalService.js` 在一个事务里执行 |

**decide 动作矩阵**

| 情形 | 行为 |
|------|------|
| index 非整数/越界 | 404「这条建议已经不在了」 |
| 已处理过（`decided` 非 null） | 409「这条建议已经处理过了」 |
| decision 非 accept/dismiss | 400「decision只能是accept或dismiss」 |
| accept × edit_memory | `updateMemory(memoryId, {content: content??suggestText, expectedRevision: expectedRevision??memoryRevision})`；记忆已不在 404「这条记忆已经不在了」；版本冲突 409 原样透传，不自动覆盖 |
| accept × delete_memory | 删掉那条记忆；已删过不报错，返回 `{success:true, already:true}`，照样置 decided |
| accept × plan | 建一条 once 的「安排」：`{content: suggestText, freq:'once', date: planDate??明天（北京时间）, time:'09:00', instruction}` |
| accept × 从草稿来的三种，依据的整理已经作废（你之后改过相关的记忆） | 409 `PROPOSAL_STALE`「这条建议依据的记忆已经变了，先看看现在的样子再说」，什么都不动 |
| accept × merge_memories | 先把依据的关系结束为 `accepted`；`pair[0]` 改成 `content??suggestText`（按 `pair[0].revision` 核对），`pair[1]` 删掉（按 `pair[1].revision` 核对）；任一版本对不上 409、记忆不在 404，整体回滚 |
| accept × resolve_conflict | `keep` 必填：`'a'` 留第一条、删第二条；`'b'` 留第二条、删第一条（留下的那条也核对版本）；`'edit'` 第一条改成 `content??suggestText`（都空 400）、删第二条；缺 `keep` 400 |
| accept × promote_inference | 新建一条记忆：`{type:'semantic', content: content??suggestText, origin:'promoted'}`，来源取那条理解依据里仍然站得住的原话；依据的理解结束为 `accepted` |
| accept 写根的那一版 | `memory_revisions.action = 'accept_suggestion'`，`proposal = {letterId, index, kind, inferenceIds}`（来源链） |
| dismiss | 不触达记忆与安排；从草稿来的三种把依据的整理结束为 `declined`，她不会再拿同一条来提 |

「带去对话」不需要后端：前端把 `chatText`（或模板句）经路由状态交给聊天输入框。

---
---



## 十五、日志规范（实现约定）

日志**只允许**记录：

- request ID
- scene（场景）
- provider / model
- 尝试次数
- 延迟
- 结果

**严禁记录**：提示词正文、聊天正文、记忆内容、凭据、图片。

---

## 附：端点速查表

```
认证      POST   /api/auth/login
          POST   /api/auth/refresh
          POST   /api/auth/logout
用户      GET    /api/user/profile
          PUT    /api/user/profile
          PUT    /api/user/persona            (换她：按 personas.id)
          GET    /api/user/personas           (人设库，路线图 C30)
          POST   /api/user/personas           (造一个她：建卡并启用)
          POST   /api/user/personas/distill   (素材 → 人设卡草稿，不落库)
          PUT    /api/user/personas/:id       (改一改)
          DELETE /api/user/personas/:id       (删她，至少留一个)
          GET    /api/user/external-llm-consent
          PUT    /api/user/external-llm-consent
          PUT    /api/user/roleplay        (恋人红线 400)
          GET    /api/user/companion/journal (「她这几天」手账：最近 7 天她做过的事，只读)
          GET    /api/user/export          (一键导出 JSON)
          POST   /api/user/import/preview  (预览不落库)
          POST   /api/user/import/apply
聊天      GET    /api/chat/thread          (唯一对话，首次打开合并旧会话)
          DELETE /api/chat/thread/messages (清空聊天记录)
          GET    /api/chat/openers         (空对话那一屏的开场话题，只读)
          GET    /api/chat/conversations   (以前归档的会话)
          GET    /api/chat/conversations/:id
          POST   /api/chat/conversations/:id/messages
          POST   /api/chat/conversations/:id/messages/stream (SSE)
          DELETE /api/chat/conversations/:id
语音      GET    /api/asr/status           (没配就不放麦克风)
          POST   /api/asr/transcribe       (multipart WAV，只回文字)
记忆      CRUD   /api/memories
          POST   /api/memories/suggestions (临时候选，不落库)
          POST   /api/memories/index-jobs  (向量补算：记忆与她的书，repair / rebuild)
          GET    /api/memories/inferences  (「她猜的」：她自己整理的，没经你确认)
          DELETE /api/memories/inferences/:id (删掉即否决，她不会再这样猜)
来信      GET    /api/letters            (历史列表，新到旧)
          GET    /api/letters/:id
          POST   /api/letters/generate   (到期就写一封，幂等)
          POST   /api/letters/:id/read   (记下读过，幂等)
          POST   /api/letters/:id/suggestions/:index/decide (同意采纳 / 不用)
她说的话  GET    /api/chat/nudges        (提醒 + 关怀 + 来信，只在对话里)
          POST   /api/chat/nudges/:id/ack
安排      CRUD   /api/reminders/scheduled
睡眠卡    GET/PUT /api/reminders/sleep     (晚安提醒 + 早安闹钟；GET 带到点的便签)
经期      CRUD   /api/tools/period        (含 /summary；/consent 单独同意)
日记      CRUD   /api/diary/:day
读书      CRUD   /api/reading/books       (书架；书默认在浏览器里)
          POST   /api/reading/books/:id/content (她确认后上传章节；DELETE 撤回)
          GET    /api/reading/shelf/builtin     (Amie 的藏书，只读)
          PUT    /api/reading/books/:id/progress (阅读进度)
          GET    /api/reading/notes       (手记时间线)
          POST   /api/reading/notes       (按书名记一笔)
天气      GET    /api/weather            (没填城市回 place:null；取不到 503)
          GET    /api/weather/places?q=  (找城市候选)
          PUT    /api/weather/place      (存下选中的城市)
          DELETE /api/weather/place
宠物      GET    /api/pets               (零食、在养哪只、每只的数值)
          POST   /api/pets/daily         (领今天的零食，一天一次)
          POST   /api/pets               (领养 {species, name})
          PUT    /api/pets/active        (换一只)
          PUT    /api/pets/:species      (改名)
          POST   /api/pets/:species/feed (喂一口；没零食 409)
          POST   /api/pets/:species/pet  (摸一摸；每天前 10 次算数)
装扮      GET    /api/collection?shelf=  (衣柜 wardrobe / 化妆间 makeup)
          POST   /api/collection         (multipart：文字字段 + 可选 photo/thumb 两张 JPEG)
          PUT    /api/collection/:id     (同上，柜子不能换)
          DELETE /api/collection/:id
          GET    /api/collection/:id/{photo,thumb} (no-store)
花草      POST   /api/garden/identify    (multipart：一张 JPEG，不落盘；要云端同意，每人每小时 30 次)
          GET    /api/garden?status=     (路上遇见 met / 我养的 grow)
          POST   /api/garden             (multipart：文字字段 + 可选识别结果 JSON 与 pick + 可选 photo/thumb)
          PUT    /api/garden/:id         (识别结果不能改)
          DELETE /api/garden/:id
          GET    /api/garden/:id/{photo,thumb} (no-store)
模型      GET    /api/llm/status
模型供应商 GET    /api/admin/model-providers           (实例管理员)
          POST   /api/admin/model-providers           (新增；密钥只写不读)
          PUT    /api/admin/model-providers/:id        (编辑 / 启停 enabled)
          PUT    /api/admin/model-providers/order      (排序 ids)
          DELETE /api/admin/model-providers/:id
          POST   /api/admin/model-providers/:id/test   (试一下，会花一点钱)
合规      *      /api/compliance/usage/*
健康      GET    /api/health/live
          GET    /api/health/ready
```
