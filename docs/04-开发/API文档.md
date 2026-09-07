# 赛博姐妹 · API 文档

> **适用版本**：内测版
> **创建日期**：2026-08-31
> **基线**：`apps/api/src/routes/` 实际实现
> **权威合同**：[`docs/Spec_赛博姐妹_v1.0.md`](../Spec_赛博姐妹_v1.0.md)（与本文冲突时以 Spec 为准）
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
| 503 `LOCAL_LLM_NOT_CONFIGURED` | 本地模型未配置 |
| 503 `LOCAL_LLM_UNAVAILABLE` | 本地模型不可用且无已授权云端备用 |
| 503 `LLM_UNAVAILABLE` | 已授权云端备用但所有候选都不可用 |

### 健康端点

| 端点 | 说明 |
|------|------|
| `GET /api/health/live` | 进程存活 |
| `GET /api/health/ready` | 依赖就绪，可随依赖恢复自动恢复 |

> ready **不把**用户尚未启动的消费级本地模型判为应用宕机——本地模型未加载时应用仍 ready。

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
  "version": "qwen-fallback-v1",
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

- 该同意**只控制可选云端备用**，不是使用本地聊天的前置条件
- 未选择、拒绝、撤回时，仍可正常使用本地聊天，但 **Qwen 调用次数必须为零**
- 同意版本不是 `qwen-fallback-v1` 时按**未选择**处理
- 服务端在每个外部候选发出请求前**重新读取**同意状态——用户可在本地模型等待期间撤回
- 页面**不得**用同意弹窗阻断本地聊天

### GET /api/user/membership

获取会员状态（内测无真实支付）。

### POST /api/user/membership/subscribe

订阅会员（内测未接入真实支付）。

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
  "source": "local_model"
}
```

`source` 取值：

| 值 | 含义 |
|----|------|
| `local_model` | 本地 llama.cpp 生成 |
| `qwen` | 云端备用生成（需用户已同意） |
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
| 503 | `LOCAL_LLM_NOT_CONFIGURED` | 本地模型未配置 |
| 503 | `LOCAL_LLM_UNAVAILABLE` | 本地不可用且无已授权备用 |
| 503 | `LLM_UNAVAILABLE` | 已授权备用也全部不可用 |

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

data: {"event":"done","status":"ok","userMessage":{...},"aiMessage":{...},"source":"local_model"}

```

连接空闲时每 **15 秒**下发一次注释心跳帧 `: ping`，仅用于保活，客户端必须忽略。

**事件类型**

| event | 字段 | 说明 |
|-------|------|------|
| `delta` | `text` | 增量文本，客户端按到达顺序追加渲染 |
| `replace` | `content` | 输出命中安全过滤时整体替换此前已下发的全部文本 |
| `done` | `status:"ok"`、`userMessage`、`aiMessage`、`source` | 生成完成并已落库；`source` 取值同 JSON 端点（`local_model`/`qwen`/`local_template`） |
| `blocked` | `status:"blocked"`、`userMessage`、`intervention` | 危机阻断；语义同 JSON 端点的 blocked 响应 |
| `error` | `code` | 生成失败，本帧之前下发的文本一律作废 |

每条消息以 `done`/`blocked`/`error` 之一收尾，终态帧之后连接关闭。

---

**error.code 语义**

| code | 说明 |
|------|------|
| `LOCAL_LLM_NOT_CONFIGURED` | 本地模型未配置 |
| `LOCAL_LLM_UNAVAILABLE` | 本地不可用且无已授权备用 |
| `LLM_UNAVAILABLE` | 已授权备用也全部不可用 |
| `STREAM_FAILED` | 流中断或服务端中途失败 |

> **持久化保证：中途失败、断线或客户端取消时该次消息完全不落库；只有完整成功（`done`）才落库，且只落库一组（用户消息 + AI 消息）。** 危机阻断（`blocked`）沿用 JSON 端点语义，在一个事务内写入用户消息、干预回复与唯一一条 `CrisisLog`。前端在收到 `error` 或流中断时移除临时气泡并保留原输入供重试。

---

**部署备注**：反向代理必须对该路径关闭响应缓冲并保持长连接，否则事件会被整段攒批、长连接被读超时切断。本仓库 `deploy/nginx.conf` 已为该路径单独配置 `proxy_buffering off` 与长读超时，其余 `/api/` 路径行为不变。

---

**智能体工具回路（2026-09-04 起）**

两个发送端点共用同一智能体回路（参考 pi-agent-core 的 agent loop 收敛实现）：模型可以把整段回复写成一个工具调用 JSON（`{"tool":"<注册名>","args":{...}}`），服务端执行后将结果以 system 消息回喂，最多 3 轮，随后强制文本回复，仍输出工具 JSON 则以本地模板兜底。工具域只覆盖产品自身能力——待办/倒数日/经期/提醒/日记/手帐（`add_todo`、`list_todos`、`complete_todo`、`delete_todo`、`add_countdown`、`list_countdowns`、`delete_countdown`、`record_period`、`period_status`、`list_reminders`、`set_reminder`、`add_diary`、`diary_status`、`check_habit`、`habit_status`），全部经对应领域服务的既有校验作用于当前用户，不执行任意代码；记忆不开放给工具（仍只能经「帮我记住」由用户确认）。同一签名（工具+参数）在同一回路中去重执行，重复调用只回喂「已执行」提示。

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

用户在聊天中主动请求“帮我记住”时，由**本地模型**从一条消息临时抽取候选记忆。

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
| 503 | `LOCAL_LLM_NOT_CONFIGURED` | 本地模型尚未配置 |
| 503 | `LOCAL_LLM_UNAVAILABLE` | 本地模型暂时不可用 |

**隐私性质**：候选仅由 llama.cpp 本地模型生成（`allowExternal=false`，无任何云端回退）；候选为**本地、临时**数据，只存在于响应体，不写数据库；经用户确认后才可通过既有 `POST /api/memories` 落库。日志只记 requestId 与结果计数，不记消息或候选内容。

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

`mood ∈ happy|neutral|sad|angry|anxious`（与聊天情绪同词表）。回应幂等：已存在直接复用不重复消耗；模型失败 503 `{code∈LOCAL_LLM_NOT_CONFIGURED|LOCAL_LLM_UNAVAILABLE|LLM_UNAVAILABLE}`。回应生成：人格 + 心情 + 脱敏正文，同意门与聊天一致（外部主用模式同 Spec §3.1）。

## 六、手帐习惯 `/api/habits`（2026-09-04 起）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/habits` | `[{id, name, icon, checkedToday, streak, recentDays}]`（近 30 天打卡日） |
| POST | `/api/habits` | 创建 `{name(1–20), icon}`；icon ∈ `droplet|moon|dumbbell|book|flower|pen`；活跃上限 12 |
| PATCH | `/api/habits/:id` | 改名/换图标（归属校验） |
| DELETE | `/api/habits/:id` | 归档（历史打卡保留） |
| POST | `/api/habits/:id/checkin` | 切换当天打卡 → `{checked, day}` |
| POST | `/api/habits/cheer` | 聚合鼓励 → `{cheer, source}`；无习惯 `{cheer:null}` |

连续天数（streak）：今天已打则从今天回数，否则从昨天回数。鼓励只把习惯名/连续天数/今日完成计数送入模型（不送任何正文内容），同意门同上；模型失败 503 同家族。

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

## 八、模型状态 `/api/llm`

### GET /api/llm/status

登录用户可查看**去敏后**的本地模型状态与云端备用状态。

---

## 九、合规与使用时长 `/api/compliance`

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/compliance/usage/start` | 开始计时 |
| POST | `/api/compliance/usage/heartbeat` | 心跳 |
| POST | `/api/compliance/usage/end` | 结束计时 |
| GET | `/api/compliance/usage/status` | 查询使用时长状态（用于 2 小时提醒） |

---

## 十、虚拟试衣 / 化妆间 `/api/virtual`

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/virtual/image-gen/status` | 生图能力状态 |
| POST | `/api/virtual/image-gen/generations` | 生成妆效/穿搭预览（multipart，需本机 ComfyUI 在线） |

生图走**本机 ComfyUI**（`IMAGE_GEN_PROVIDER=comfy`，默认），不接外部生图 API；照片经本机 API 内存转发给本机 ComfyUI，不落库。

**GET `/image-gen/status` 响应**：`{ available, configured, provider, reason }`；`reason` ∈ `null | IMAGE_GEN_NOT_CONFIGURED | IMAGE_GEN_UNAVAILABLE | IMAGE_GEN_NOT_IMPLEMENTED`（仅 `provider=external` 时）。

**POST `/image-gen/generations`**：`multipart/form-data`，字段：

| 字段 | 必填 | 约束 |
|------|------|------|
| `photo` | 是 | 图片文件，≤8MB，仅 `image/jpeg` / `image/png` / `image/webp` |
| `scene` | 是 | `makeup` \| `fitting` |
| `itemId` | 是 | 目录条目 id，1–64 字符 |
| `note` | 否 | ≤200 字符 |

- 201：`{ imageDataUrl, scene, itemId, provider }`（`imageDataUrl` 为 base64 data URL）
- 400：缺照片 / 超限 / MIME 不符 / 字段校验失败 / 未知 itemId
- 503：`IMAGE_GEN_NOT_CONFIGURED`（未配置）/ `IMAGE_GEN_UNAVAILABLE`（ComfyUI 离线、超时或执行失败）

> ComfyUI 不在线时入口诚实显示"接入中"，不得伪装可用；提示词由主模型把目录描述改写为英文提示词，主模型不可用时退化为目录描述直拼。

---

## 十一、本地模型管理 `/api/admin/llm/local`（实例管理员）

需 `instanceAdminMiddleware`，仅实例管理员（白名单子集）可访问。

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/detect` | 自动发现候选 llama.cpp |
| POST | `/test` | 测试连接 |
| GET | `/config` | 读取当前配置 |
| PUT | `/config` | 保存配置 |

**约束（重要）**

- 服务端只接受 `LOCAL_LLM_ALLOWED_ORIGINS` 中的**精确**地址
- **不跟随重定向**
- **不从页面接收密钥**——地址与模型由管理员保存，密钥只来自部署环境

---

## 十二、日志规范（实现约定）

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
聊天      GET    /api/chat/conversations
          POST   /api/chat/conversations
          GET    /api/chat/conversations/:id
          POST   /api/chat/conversations/:id/messages
          POST   /api/chat/conversations/:id/messages/stream (SSE)
          DELETE /api/chat/conversations/:id
记忆      CRUD   /api/memories
          POST   /api/memories/suggestions (本地临时候选，不落库)
工具箱    CRUD   /api/tools/{todos,countdowns,period,reminders}
日记      CRUD   /api/diary/:day
          POST   /api/diary/:day/comment  (幂等 AI 回应)
手帐      CRUD   /api/habits/:id
          POST   /api/habits/:id/checkin
          POST   /api/habits/cheer        (聚合数据鼓励)
          GET    /api/tools/weather        (409 关闭)
模型      GET    /api/llm/status
合规      *      /api/compliance/usage/*
虚拟      GET    /api/virtual/image-gen/status
          POST   /api/virtual/image-gen/generations  (multipart，本机 ComfyUI)
管理员    *      /api/admin/llm/local/*     (实例管理员)
健康      GET    /api/health/live
          GET    /api/health/ready
```
