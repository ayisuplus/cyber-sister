# Amie · API 文档

> **适用版本**：内测版
> **创建日期**：2026-08-31
> **基线**：`apps/api/src/routes/` 实际实现
> **权威合同**：[`docs/Spec_Amie_v1.0.md`](../Spec_Amie_v1.0.md)（与本文冲突时以 Spec 为准）
>
> 本文面向前端与集成开发者。所有示例均为 JSON。

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
| 409 | 冲突/功能关闭 | 天气端点（内测关闭） |
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

更新昵称、头像等。

### PUT /api/user/persona — 切换人格

**请求**

```json
{ "persona": "toxic" }
```

`persona` 取值：`toxic`（毒舌互怼） · `gentle`（温柔姐姐） · `rational`（疯批搭子）

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

### GET /api/user/membership

获取会员状态（内测无真实支付）。

### POST /api/user/membership/subscribe

订阅会员（内测未接入真实支付）。

### PUT /api/user/roleplay — 设置角色扮演

**请求**

```json
{ "name": "合租室友", "setting": "爱做饭，经常喊我一起吃饭" }
```

- `name` 必填，trim 后 1–20 字符；`setting` 必填，1–200 字符
- `DELETE /api/user/roleplay` 清除角色扮演

**恋人红线（400）**：`name` 或 `setting` 任一命中亲密关系词表（恋人/情侣/爱人/老婆/老公/妻子/丈夫/夫君/娘子/相公/媳妇/女朋友/男朋友/女友/男友/网恋对象/暧昧对象/虚拟恋人/伴侣/灵魂伴侣/红颜知己/蓝颜知己/主人/主仆）即拒绝，不落库：

```json
{ "error": "角色扮演不能设定为恋人或亲密关系——我是你姐妹，不是你对象" }
```

普通非亲密关系（合租室友、同桌等）不受影响。迁移导入复用同一道闸。

### GET /api/user/export — 一键导出全部数据

登录用户导出单 JSON 包，响应头 `Content-Disposition: attachment; filename="cyber-sister-export-<yyyy-MM-dd>.json"`。永久免费，无会员门槛。

**响应 200 结构**

```json
{
  "version": 1,
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
  "todos": [], "countdowns": [], "periodRecords": [], "reminders": [],
  "diaryEntries": [], "habits": [ { "checkins": [] } ],
  "books": [ { "notes": [] } ],
  "studySessions": []
}
```

- `user` 段**不含** id、phone 与任何凭据
- **不导出**：refresh token（凭据，绝不外发）、危机日志（安全运维数据）、头像/背景等二进制资产（v1 边界）

### POST /api/user/import/preview — 迁移预览（不落库）

两种输入：自家导出包 JSON（自动识别 `version` + `product` 字段），或纯角色文本：

```json
{ "format": "persona-text", "roleName": "...", "roleSetting": "..." }
```

**响应 200**

```json
{
  "format": "cyber-sister-export",
  "role": { "name": "...", "setting": "...", "ok": false, "error": "角色扮演不能设定为恋人或亲密关系——我是你姐妹，不是你对象" },
  "persona": { "id": "toxic", "ok": true },
  "memoryCandidates": [ { "type": "semantic", "content": "...", "importance": 7, "tags": [] } ],
  "memoriesSkipped": 2,
  "notes": ["对话/日记/手帐/日程等数据段 v1 不导入"]
}
```

- v1 导入对象仅三类：角色扮演（`roleName`/`roleSetting`）、人格 id、显式记忆候选；对话/日记/手帐/日程等数据段不导入，`notes` 如实说明
- 角色命中恋人红线时 `role.ok:false` 并带原因；人格 id 非法时 `persona.ok:false`
- 云端模型同意状态**绝不导入**——须用户主动重新同意 `cloud-primary-v1`
- 预览**绝不落库**；记忆候选单批最多 100 条

### POST /api/user/import/apply — 迁移应用

**请求**

```json
{
  "role": { "name": "...", "setting": "..." },
  "persona": "toxic",
  "memories": [ { "type": "semantic", "content": "...", "importance": 7, "tags": [] } ]
}
```

- 角色经 `updateRolePlay`（长度 + 恋人红线双闸，400 透传）；人格经 `switchPersona`；记忆经 `createMemory` 既有校验
- 与现有记忆做规范化去重（NFKC + trim + 小写），候选之间同样查重；重复/非法按 skipped 计数

**响应 200**

```json
{ "roleApplied": true, "personaApplied": true, "memoriesApplied": 8, "memoriesSkipped": 2 }
```

**错误**：三者全空时 400 `没有可导入的内容`。

---

## 三、聊天 `/api/chat`

### GET /api/chat/conversations

会话列表，支持 `?page=&limit=`。

### POST /api/chat/conversations

新建会话。

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

---

**响应 200 — `Content-Type: text/event-stream`**

纯 `data` 帧编码（无 `event:` 行），帧间以空行分隔：

```
data: {"event":"delta","text":"我在听，"}

data: {"event":"done","status":"ok","userMessage":{...},"aiMessage":{...},"source":"qwen"}

```

连接空闲时每 **15 秒**下发一次注释心跳帧 `: ping`，仅用于保活，客户端必须忽略。

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

两个发送端点共用同一智能体回路（参考 pi-agent-core 的 agent loop 收敛实现）：模型可以把整段回复写成一个工具调用 JSON（`{"tool":"<注册名>","args":{...}}`），服务端执行后将结果以 system 消息回喂，最多 3 轮，随后强制文本回复，仍输出工具 JSON 则以本地模板兜底。工具域只覆盖产品自身能力——日程/倒数日/经期/提醒/日记/手帐/阅读/自习/联网搜索（`add_todo`、`list_todos`、`complete_todo`、`delete_todo`、`add_countdown`、`list_countdowns`、`delete_countdown`、`record_period`、`period_status`、`list_reminders`、`set_reminder`、`add_diary`、`diary_status`、`check_habit`、`habit_status`、`log_reading`、`log_study`、`web_search`），全部经对应领域服务的既有校验作用于当前用户，不执行任意代码、不驱动浏览器、不在服务器执行 shell（联网搜索走 DuckDuckGo 普通 HTTP）；记忆不开放给工具（仍只能经「帮我记住」由用户确认）。同一签名（工具+参数）在同一回路中去重执行，重复调用只回喂「已执行」提示。

当轮执行过工具时，`done`/`POST /messages` 响应中的 `aiMessage` 携带 `toolRuns: [{tool, ok, summary}]`（未执行为 `null`），历史消息同样返回该字段；前端据此在回复下方渲染动作标签。

---

## 四、记忆 `/api/memories`

内测为**显式记忆**：系统不自动提取，不由模型推断。

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/memories` | 创建 |
| GET | `/api/memories` | 列表（带当前用户归属检查） |
| PUT | `/api/memories/:id` | 编辑 |
| DELETE | `/api/memories/:id` | 删除 |
| DELETE | `/api/memories` | 清空全部 |

**字段**

| 字段 | 说明 |
|------|------|
| `type` | `semantic` · `episodic` · `procedural` |
| `content` | 记忆内容 |
| `importance` | 重要度，仅在相关结果内排序 |
| `tags` | 标签，用于与当前输入做确定性重合匹配 |

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

保存记忆后服务端自动生成语义向量投影（云端，与聊天同一同意门）；聊天检索相关记忆从关键词重合升级为**语义余弦相似度**，无向量时原样回退关键词路径。本端点为当前用户全量重建：已有向量的计 `skipped`，其余逐条投影。

**响应**

```json
{ "embedded": 2, "failed": 0, "skipped": 1 }
```

**错误语义**

| 状态码 | code | 场景 |
|--------|------|------|
| 503 | `CLOUD_NOT_CONSENTED` | 未同意使用云端模型 |
| 503 | `LLM_UNAVAILABLE` | 云端模型暂时不可用 |

**投影性质**：向量可重建、失败静默降级（记忆照常保存，仅无向量）；向量与模型名**不进入任何 API 响应与提示词**（响应组装前统一剥离）。

---

## 五、日记 `/api/diary`（2026-09-04 起）

按本地日历日一记（userId+day 唯一，UTC 零点存储契约同经期/倒数日）。

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/diary?month=yyyy-MM` | 月列表（day 降序；month 非法 400） |
| GET | `/api/diary/:day` | 单日详情；无记录 404 |
| PUT | `/api/diary/:day` | 新增/覆盖 `{content(1–2000), mood}`；内容变更会清空旧 AI 回应 |
| DELETE | `/api/diary/:day` | 删除该日日记 |
| POST | `/api/diary/:day/comment` | 生成/复用 AI 闺蜜回应 → `{aiComment, source, reused}` |

`mood ∈ happy|neutral|sad|angry|anxious`（与聊天情绪同词表）。回应幂等：已存在直接复用不重复消耗；模型失败 503 `{code∈CLOUD_NOT_CONSENTED|LLM_UNAVAILABLE}`。回应生成：人格 + 心情 + 脱敏正文，同意门与聊天一致（云端唯一路径同 Spec §3.1）。

## 六、手帐习惯 `/api/habits`（2026-09-04 起）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/habits` | `[{id, name, icon, checkedToday, streak, recentDays}]`（近 30 天打卡日） |
| POST | `/api/habits` | 创建 `{name(1–20), icon}`；icon ∈ `droplet|moon|dumbbell|book|flower|pen`；活跃上限 12 |
| PATCH | `/api/habits/:id` | 改名/换图标（归属校验） |
| DELETE | `/api/habits/:id` | 归档（历史打卡保留） |
| POST | `/api/habits/:id/checkin` | 切换当天打卡 → `{checked, day}` |
| POST | `/api/habits/cheer` | 聚合鼓励 → `{cheer, source}`；无习惯 `{cheer:null}` |

连续天数（streak）：今天已打则从今天回数，否则从昨天回数。鼓励只把习惯名/连续天数/今日完成计数送入模型（不送任何正文内容），同意门同上；模型失败 503 同家族（`CLOUD_NOT_CONSENTED`/`LLM_UNAVAILABLE`）。

---

## 七、工具箱 `/api/tools`

| 方法 | 路径 | 说明 |
|------|------|------|
| GET/POST | `/api/tools/todos` | 日程列表 / 新增（`content` 必填；`dueDate` 可选 `yyyy-MM-dd`，`dueTime` 可选 `HH:mm` 且需先有日期） |
| PUT/DELETE | `/api/tools/todos/:id` | 更新（content / dueDate / dueTime / isDone）/ 删除日程 |
| GET/POST | `/api/tools/countdowns` | 倒数日列表 / 新增 |
| DELETE | `/api/tools/countdowns/:id` | 删除倒数日 |
| GET/POST | `/api/tools/period` | 经期记录读取 / 记录 |
| GET/PUT | `/api/tools/reminders` | 提醒读取 / 更新 `/:id` |
| GET | `/api/tools/weather` | ⚠️ **内测 409 关闭**，无真实数据源 |

---

## 八、妆容预设 `/api/makeup-presets`（2026-09-08 起）

化妆间四滑杆（smooth/whiten/slim/eye，均 0-100 整数）组合的命名预设，按用户隔离，多设备同步。

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/makeup-presets` | 列表（按创建时间升序） |
| POST | `/api/makeup-presets` | 新增 `{name, smooth, whiten, slim, eye}`；name 1-20 字，参数越界 400「妆容参数需为 0-100 的整数」 |
| PUT | `/api/makeup-presets/:id` | 重命名 `{name}`；非本人 404 |
| DELETE | `/api/makeup-presets/:id` | 删除；非本人 404 |

---

## 九、3D 衣柜 `/api/wardrobe`（2026-09-08 起）

单品照片 → 外部图生 3D → GLB 落库 + 文件存盘（`data/wardrobe/<userId>/<itemId>/source<ext>` + `model.glb`）。

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/wardrobe` | 列表（倒序），每项含 `sourceUrl` / `modelUrl` |
| POST | `/api/wardrobe` | multipart 上传（`image` 字段 ≤8MB，仅 JPEG/PNG/WebP；`name` 可选 ≤30 字，缺省「未命名单品」）。**图生 3D 外部服务未配置时 503 `{code: IMAGE_TO_3D_NOT_CONFIGURED}`，不落行也不写文件** |
| GET | `/api/wardrobe/:id/source` | 单品原图（`Cache-Control: no-store`）；非本人 404 |
| GET | `/api/wardrobe/:id/model` | GLB 模型（`model/gltf-binary`，`no-store`）；非本人 404 |
| DELETE | `/api/wardrobe/:id` | 删除行与目录；非本人 404 |

外部 3D 服务接入位：`services/imageTo3dService.js`（`IMAGE_TO_3D_API_URL` / `IMAGE_TO_3D_API_KEY`）。

---

## 十、模型状态 `/api/llm`

### GET /api/llm/status

登录用户可查看**去敏后**的模型状态。聊天为云端唯一路径，响应形状：

```json
{
  "mode": "external_primary",
  "local": { "configured": false, "state": "removed" },
  "externalFallback": {
    "configured": true,
    "primary": true,
    "consent": null,
    "version": "cloud-primary-v1"
  }
}
```

- `mode` 恒为 `external_primary`；`local` 段固定 `{configured:false, state:'removed'}`，仅为兼容既有消费方读取
- `externalFallback.consent` 三态同 `/api/user/external-llm-consent`；`version` 为当前同意版本 `cloud-primary-v1`

---

## 十一、合规与使用时长 `/api/compliance`

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/compliance/usage/start` | 开始计时 |
| POST | `/api/compliance/usage/heartbeat` | 心跳 |
| POST | `/api/compliance/usage/end` | 结束计时 |
| GET | `/api/compliance/usage/status` | 查询使用时长状态（用于 2 小时提醒） |


## 十二、她的工作台 `/api/derived`（2026-09-08 起）

派生理解层：AI 在对话后生成对用户的理解草稿，**永远不是记忆**；用户批准（promote）或厘清（resolve）才入定典层（origin=promoted 的显式记忆）。

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/derived?status=` | 条目列表；status ∈ active\|promoted\|dismissed\|resolved\|all |
| POST | `/api/derived/analyze` | 立即分析（同意门同聊天） |
| POST | `/api/derived/rebuild` | 清掉 active/dismissed 草稿并重新分析；promoted/resolved 保留 |
| POST | `/api/derived/:id/promote` | 晋升进显式记忆（规范化键去重） |
| POST | `/api/derived/:id/resolve` | 冲突厘清：定稿文案入定典层，条目 resolved 并留存定稿 |
| POST | `/api/derived/:id/dismiss` | 忽略 |
| DELETE | `/api/derived` | 整层清空 |

### 记忆关系边 `/api/derived/edges`（2026-09-09 起）

工作台分析时自动抽取记忆之间的明确关系（similar\|related\|contradicts），status=derived；用户确认后晋升 canonical，聊天注入时做一跳联想（选中记忆带出已确认关联记忆的内容）。去重按无向记忆对+关系，仅对 derived/canonical 既有边生效（dismissed 是草稿处理结果，重建后允许重现）。

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/derived/edges?status=` | 边列表（join 两端记忆内容，任一端缺失的边整条过滤）；status ∈ derived\|canonical\|dismissed\|all |
| POST | `/api/derived/edges/:id/promote` | derived → canonical；重复确认 400「该关系已确认」，已忽略 400「该条目已处理过」 |
| POST | `/api/derived/edges/:id/dismiss` | 忽略 |

## 十三、主动关怀 `/api/care`（2026-09-09 起）

「她来想你」触点：**in-app 拉取，内测无推送通道**。规则引擎基于真实数据（生日/经期预测/倒数日/日程逾期与到期/手帐连续断签/自习连续中断/昨日心情）产出最多 3 条卡片，每条附 `reason`（为什么看到这条）与跳转；`users.care_enabled` 为总开关（设置页）。

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/care/touchpoints` | 当前触点（按日忽略过滤后）：`{ "touchpoints": [{ "key", "kind", "title", "body", "reason", "action": { "to", "label" } }] }` |
| POST | `/api/care/touchpoints/dismiss` | 按日忽略；请求 `{ "key" }`，同日同键幂等 |

## 十四、她的信 `/api/letters`（2026-09-09 起）

每周一封，**完全由本周真实数据本地生成，不调用云端模型**（聊天轮数、新记忆、定典与关系边、打卡连续、自习时长、心情分布、临近倒数日）；同一 用户+周起始（本地周一，UTC 零点）幂等唯一；沉默周（零聊天/零记录/零打卡/零自习/零日记）宁缺毋滥不生成。

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/letters` | 列表（新到旧）；本周信缺失且有内容可写时先幂等补上 |
| POST | `/api/letters/generate` | 幂等生成：`{ "letter", "created" }`；沉默周 `{ "letter": null, "created": false, "reason": "quiet" }` |
| GET | `/api/letters/:id` | 单封；非本人 404 |

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
          GET    /api/user/membership
          POST   /api/user/membership/subscribe
          PUT    /api/user/roleplay        (恋人红线 400)
          GET    /api/user/export          (一键导出 JSON)
          POST   /api/user/import/preview  (预览不落库)
          POST   /api/user/import/apply
聊天      GET    /api/chat/conversations
          POST   /api/chat/conversations
          GET    /api/chat/conversations/:id
          POST   /api/chat/conversations/:id/messages
          POST   /api/chat/conversations/:id/messages/stream (SSE)
          DELETE /api/chat/conversations/:id
记忆      CRUD   /api/memories
          POST   /api/memories/suggestions (临时候选，不落库)
          POST   /api/memories/embeddings/rebuild (重建语义索引)
工作台    GET    /api/derived            (status=active|promoted|dismissed|resolved|all)
          POST   /api/derived/analyze    (立即分析)
          POST   /api/derived/rebuild    (清草稿重分析)
          POST   /api/derived/:id/{promote,resolve,dismiss}
          GET    /api/derived/edges      (记忆关系边)
          POST   /api/derived/edges/:id/{promote,dismiss}
关怀      GET    /api/care/touchpoints   (in-app 触点，无推送)
          POST   /api/care/touchpoints/dismiss (按日忽略，幂等)
来信      GET    /api/letters            (本周信自动幂等补)
          POST   /api/letters/generate   (幂等；沉默周 quiet)
          GET    /api/letters/:id
工具箱    CRUD   /api/tools/{todos,countdowns,period,reminders}
日记      CRUD   /api/diary/:day
          POST   /api/diary/:day/comment  (幂等 AI 回应)
手帐      CRUD   /api/habits/:id
          POST   /api/habits/:id/checkin
          POST   /api/habits/cheer        (聚合数据鼓励)
          GET    /api/tools/weather        (409 关闭)
妆容      CRUD   /api/makeup-presets     (四参数 0-100；名字 1-20 字)
衣柜      GET    /api/wardrobe           (列表)
          POST   /api/wardrobe           (multipart 上传；3D 未配置 503 不落数据)
          GET    /api/wardrobe/:id/{source,model} (no-store 二进制)
          DELETE /api/wardrobe/:id
模型      GET    /api/llm/status
合规      *      /api/compliance/usage/*
健康      GET    /api/health/live
          GET    /api/health/ready
```
