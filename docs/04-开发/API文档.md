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
| 妆教解释 | `/makeup/api/*`（Vite base 为 `/makeup/`） |

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

---

## 五、工具箱 `/api/tools`

| 方法 | 路径 | 说明 |
|------|------|------|
| GET/POST | `/api/tools/todos` | 待办列表 / 新增 |
| PUT/DELETE | `/api/tools/todos/:id` | 更新 / 删除待办 |
| GET/POST | `/api/tools/countdowns` | 倒数日列表 / 新增 |
| DELETE | `/api/tools/countdowns/:id` | 删除倒数日 |
| GET/POST | `/api/tools/period` | 经期记录读取 / 记录 |
| GET/PUT | `/api/tools/reminders` | 提醒读取 / 更新 `/:id` |
| GET | `/api/tools/weather` | ⚠️ **内测 409 关闭**，无真实数据源 |

---

## 六、模型状态与妆教解释 `/api/llm`

### GET /api/llm/status

登录用户可查看**去敏后**的本地模型状态与云端备用状态。

### POST /api/llm/explain

妆教解释生成。

**请求**

```json
{
  "features": {
    "faceShape": "round",
    "skinTone": "warm_medium",
    "eyeType": "almond"
  },
  "lookId": "look_xxx"
}
```

**响应**

```json
{
  "explanation": "不超过 50 个 Unicode 字符的解释",
  "source": "local_model"
}
```

**约束**

- 只接受**规范化**的 `features` 与 `lookId`
- 服务端按 `lookId` 解析内置妆容，**不接受**任意提示词或完整妆容对象
- 未登录、主 API 或模型异常时返回**透明标识**的确定性本地解释
- 解释**最长 50 个 Unicode 字符**
- Makeup 复用主应用 access token，转发规范化特征与 `lookId`；主 API 统一执行本地优先路由
- **图片与视频帧不进入这条请求链**

---

## 七、合规与使用时长 `/api/compliance`

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/compliance/usage/start` | 开始计时 |
| POST | `/api/compliance/usage/heartbeat` | 心跳 |
| POST | `/api/compliance/usage/end` | 结束计时 |
| GET | `/api/compliance/usage/status` | 查询使用时长状态（用于 2 小时提醒） |

---

## 八、虚拟试衣 / 化妆间 `/api/virtual`

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/virtual/image-gen/status` | 生图能力状态 |
| POST | `/api/virtual/image-gen/generations` | ⚠️ **恒返回 503 `IMAGE_GEN_NOT_CONFIGURED`** |

> 内测未接入生图 provider。入口必须诚实显示"接入中"，不得伪装可用。
> 照片只在浏览器本地选择预览，不上传。

---

## 九、本地模型管理 `/api/admin/llm/local`（实例管理员）

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

## 十、日志规范（实现约定）

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
          DELETE /api/chat/conversations/:id
记忆      CRUD   /api/memories
工具箱    CRUD   /api/tools/{todos,countdowns,period,reminders}
          GET    /api/tools/weather        (409 关闭)
模型/妆教 GET    /api/llm/status
          POST   /api/llm/explain
合规      *      /api/compliance/usage/*
虚拟      GET    /api/virtual/image-gen/status
          POST   /api/virtual/image-gen/generations  (503 未接入)
管理员    *      /api/admin/llm/local/*     (实例管理员)
健康      GET    /api/health/live
          GET    /api/health/ready
```
