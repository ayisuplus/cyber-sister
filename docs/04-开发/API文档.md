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

> **2026-09-23 她的来信更新**：「做梦 / 待确认 / 来信」收进一层「她的来信」——按用户设定的频率（`letterFreqDays` = 3/7 或空=不写）由服务器端根据记忆与近况写信，信里带 ≤3 条建议（改记忆 / 删记忆 / 安排一件事），看信时一键「同意采纳」或「带去对话」。`dreamEnabled`/`dreamt_at` 删除；`/api/derived*` 全部下线（派生草稿仍是内部层，写信前的回想产出、进信即消费）；记忆的版本恢复与整库清空接口（`GET /api/memories/:id/revisions`、`POST /api/memories/:id/restore`、`DELETE /api/memories`）一并删除；`/api/letters` 重新上线（见 §十四）。

> **2026-09-13 记忆更新**：正式记忆支持修订、来源与关系重审；新增详情、恢复与数据库索引任务，旧重建接口改为 202。导出升级 v2，记忆导入携带预览版本。完整字段及兼容边界以[记忆系统接口合同](../09-参考/历史归档/记忆系统接口-20260913.md)为准。

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

### PUT /api/user/persona — 切换人格

**请求**

```json
{ "persona": "toxic" }
```

`persona` 取值：界面只提供三种说话方式——`gentle`（温柔，新用户默认） · `toxic`（直爽） · `cool`（安静）；`rational | energetic | sister` 仍是合法值（Spec §3）。

**行为要点**

- `User.persona` 是**唯一**人格来源，`Conversation` 不保存 persona
- 切换后**当前及未来会话的下一条消息**立即使用新人格
- 已存在的聊天历史与记忆**不受影响**

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
- v2 另含 `memoryBundle`（正式记忆、完整版本、来源、确认记录及已确认/待重审关系）；上面保留的业务段只示意原有字段。v2 导入以 `memoryBundle` 为准，缺失时拒绝降级，不能丢弃历史后静默导入。

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
- 云端模型同意状态**绝不导入**——须用户主动重新同意 `cloud-primary-v1`
- 预览**绝不落库**；记忆候选单批最多 100 条

### POST /api/user/import/apply — 迁移应用

**2026-09-13 起**，记忆导入必须带预览返回的 `expectedMemoryEpoch`（适用于 v1 候选与 v2 包）。资料在预览后变化返回 409，不执行本批写入；重新预览再确认。v2 的稳定引用与关系请求详见[记忆系统接口合同](../09-参考/历史归档/记忆系统接口-20260913.md)。

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

她主动说的话：到点的安排投递、她惦记的事（写信开着时）、「她来想你」触点与她的来信合成一条时间线 `{nudges:[{id, kind, content, reason, detail?, action?}]}`。`id` 形如 `reminder:<投递 id>` / `followup:<惦记 id>` / `care:<触点键>` / `letter:<信 id>`；`followup` 的 `reason` 是「你之前说过：…」，`ack` 后记为问过。信只在没读过（`read_at` 为空）时出现。打开对话时拉取，没有推送通道。

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

---

## 四、记忆 `/api/memories`

长期记忆仅使用**用户已确认的正式记忆**；AI 草稿只进「她的来信」的素材，进信即消费。所有创建、导入共用正式写入服务，版本历史与来源独立保存。

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/memories` | 创建 |
| GET | `/api/memories` | 列表（带当前用户归属检查） |
| PUT | `/api/memories/:id` | 编辑，必须携带 expectedRevision；冲突 409，正文/类型变化触发关系重审 |
| PUT | `/api/memories/:id/pin` | `{pinned: boolean}` 放在心上 / 拿下来（2026-09-21 起）。每轮都带给她、不参与相关检索；每人最多 5 条，满了 400「最多放 5 件在心上，先拿下一件再放」。不改内容、不升版本、不写修订记录 |
| GET | `/api/memories/:id` | 详情，包含 revision、sources、origin 与 importedAt |
| DELETE | `/api/memories/:id` | 删除正式内容、历史、投影与依赖；原始聊天单独管理 |

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

### POST /api/memories/embeddings/rebuild — 重建语义索引（2026-09-09 起）

该旧入口转接全量重建任务，返回 **202**。新增 `POST /api/memories/index-jobs` 另支持 `mode=repair`，只修复缺失或过期投影。向量服务独立配置，失败不阻断保存或关键词检索。

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

**书本身存在用户自己的浏览器里（IndexedDB），从不上传。** 服务端只记书目、阅读进度和笔记；`locator` 是前端给的不透明进度串（`"<章序号>:<章内字符偏移>"`），服务端只存不解析。

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/reading/books` | 书架（按最近更新排序，带 `noteCount`） |
| POST | `/api/reading/books` | `{title, author?, format?, fileName?, totalPages?, status?}`；`format` 为 `epub`/`txt`，留空表示聊天里随口记下的纸书 |
| PUT | `/api/reading/books/:id` | 改书目；可带 `currentPage`、`percent`、`locator` |
| PUT | `/api/reading/books/:id/progress` | `{locator?, percent?}` 阅读器一边读一边回存；只动进度，想读的书会转为在读，读到 100% 不自动标记读完 |
| DELETE | `/api/reading/books/:id` | 删书（笔记级联删） |
| GET | `/api/reading/books/:id/notes` | 这本书下的笔记 |
| POST | `/api/reading/books/:id/notes` | `{content, page?, quote?, locator?, aiComment?}`；给了 `aiComment`（从伴读问答里记下来的她的回答）时 `aiCommentSource` 记为 `chat` |
| GET | `/api/reading/notes?limit=&before=` | 手记时间线：最近的读书笔记（新到旧，带书名），每页最多 100 条 |
| POST | `/api/reading/notes` | `{book, note?, page?}` 按书名记一笔；书不在书架会自动放上去（在读）。只给 `page` 就只推进度 |
| DELETE | `/api/reading/notes/:noteId` | 删除一条笔记 |

字段上限：书名 100、作者 50、感想 500、原文 `quote` 1000、她的回应 1000、文件名与 `locator` 各 200，`percent` 为 0–100 的整数。

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

派生理解层（`derived_insights` / `memory_edges`）现在只是内部草稿池：写信前的回想产出草稿，进「她的来信」的素材后即消费（不再出现在下一封）；关系草稿同理。记忆仍只能由用户创建和维护——草稿永远不是记忆，信里的建议也要用户点「同意采纳」才动记忆。原来的条目/关系/惦记的事接口（`/api/derived*`）全部删除；「她惦记的事」不需要确认，到日子进对话末尾那条时间线（`followup:` 来源），没有独立管理接口。

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
- `chatText`：用户视角可以直接发给她的一句话（空则前端用模板句）
- `decided`：`null`（未处理）· `accepted` · `dismissed`

生成双路：同意云端时先回想一次（产出草稿进本封信素材，用过即消费）再交给模型组信（服务端逐条校验建议，不信模型）；未同意或模型失败降级本地模板（`suggestions: []`）。沉默期（窗口内没有聊天/记忆/日记/读书/做完的安排，也没有草稿）宁缺毋滥，不写也不留空信。

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/letters` | 历史列表（新到旧），不自动生成 |
| GET | `/api/letters/:id` | 单封；非本人 404 |
| POST | `/api/letters/generate` | 到期就写一封（幂等）：`{letter, created, reason?}`，`reason` ∈ `off`（没开写信）\|`not_due`\|`quiet` |
| POST | `/api/letters/:id/read` | 记下读过；已读再调幂等返回 `{success:true}`，信不存在 404 |
| POST | `/api/letters/:id/suggestions/:index/decide` | 一键处置，body `{decision:'accept'\|'dismiss', content?, expectedRevision?}`；返回 `{letter}`（整封更新后） |

**decide 动作矩阵**

| 情形 | 行为 |
|------|------|
| index 非整数/越界 | 404「这条建议已经不在了」 |
| 已处理过（`decided` 非 null） | 409「这条建议已经处理过了」 |
| decision 非 accept/dismiss | 400「decision只能是accept或dismiss」 |
| accept × edit_memory | `updateMemory(memoryId, {content: content??suggestText, expectedRevision: expectedRevision??memoryRevision})`；记忆已不在 404「这条记忆已经不在了」；版本冲突 409 原样透传，不自动覆盖 |
| accept × delete_memory | 删掉那条记忆；已删过不报错，返回 `{success:true, already:true}`，照样置 decided |
| accept × plan | 建一条 once 的「安排」：`{content: suggestText, freq:'once', date: planDate??明天（北京时间）, time:'09:00', instruction}` |
| dismiss | 不触达记忆与安排 |

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
          PUT    /api/user/persona
          GET    /api/user/external-llm-consent
          PUT    /api/user/external-llm-consent
          PUT    /api/user/roleplay        (恋人红线 400)
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
记忆      CRUD   /api/memories
          POST   /api/memories/suggestions (临时候选，不落库)
          POST   /api/memories/embeddings/rebuild (重建语义索引)
来信      GET    /api/letters            (历史列表，新到旧)
          GET    /api/letters/:id
          POST   /api/letters/generate   (到期就写一封，幂等)
          POST   /api/letters/:id/read   (记下读过，幂等)
          POST   /api/letters/:id/suggestions/:index/decide (同意采纳 / 不用)
她说的话  GET    /api/chat/nudges        (提醒 + 关怀 + 来信，只在对话里)
          POST   /api/chat/nudges/:id/ack
安排      CRUD   /api/reminders/scheduled
经期      CRUD   /api/tools/period        (含 /summary；/consent 单独同意)
日记      CRUD   /api/diary/:day
读书      CRUD   /api/reading/books       (书架；书本身在浏览器里)
          PUT    /api/reading/books/:id/progress (阅读进度)
          GET    /api/reading/notes       (手记时间线)
          POST   /api/reading/notes       (按书名记一笔)
装扮      GET    /api/collection?shelf=  (衣柜 wardrobe / 化妆间 makeup)
          POST   /api/collection         (multipart：文字字段 + 可选 photo/thumb 两张 JPEG)
          PUT    /api/collection/:id     (同上，柜子不能换)
          DELETE /api/collection/:id
          GET    /api/collection/:id/{photo,thumb} (no-store)
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
