# 赛博姐妹单机内测规格 v1.0

> 状态：四周内测实施基线
> 更新日期：2026-08-30
> 目标日期：2026-10-01
> 适用范围：中国区、中文优先、VPN/可信私网中的白名单成年测试者

## 1. 产品与架构边界

当前产品是模块化单体加独立妆教模块，不是微服务平台。单机 Docker Compose 运行 Nginx、主 Web、API、Makeup、PostgreSQL 和一次性 migration job。Nginx 提供用户域名上的 TLS，同源暴露 `/api/` 与 `/makeup/`。

内测只正式暴露：

- 白名单登录、refresh 轮换和 logout 撤销。
- llama.cpp 本地优先的非流式 AI 聊天与三种用户级人格。
- `qwen-fallback-v1` 可选云端备用的同意、拒绝和撤回。
- 用户主动维护的显式记忆。
- 服务端危机阻断和安全输出过滤。
- 主应用妆教入口与 `/makeup/` 流程。

天气、待办、倒计时、生理期、提醒、会员、支付、账号删除、真实短信、自动记忆、向量检索、流式输出、第二生产供应商、语音/图片生成、模型训练、微服务/Kubernetes/Redis、妆教独立账号和公开发布均为后置项。

## 2. 认证合同

- 仅 `APP_ENV=internal` 允许 `INTERNAL_TEST_PHONES` 和 `INTERNAL_TEST_CODE`；其他环境配置固定验证码必须拒绝启动。
- 非白名单号码和错误验证码统一返回通用 401，不泄漏白名单状态。
- 登录限流按 IP 与手机号组合执行，内测单实例不引入 Redis。
- access token 用于 API 鉴权；refresh token 只存于 `Secure`、`HttpOnly` cookie，服务端只保存 token hash。
- refresh 每次轮换；旧 token 重放失败。logout 撤销当前 refresh token、清 cookie，重复调用幂等。
- 客户端没有“获取验证码”交互，登录必须等待真实 API 结果。

## 3. 用户、人格与同意

`User.persona` 是唯一人格来源，允许 `toxic | gentle | rational`。`PUT /api/user/persona` 后，当前及未来会话的下一条消息立即使用新人格；会话历史和记忆不改变。`Conversation` 不保存 persona。

外部模型同意只控制可选云端备用，不是使用本地聊天的前置条件。用户拥有三态外部模型同意：

- `GET /api/user/external-llm-consent` 返回 `{accepted:null|boolean, version:"qwen-fallback-v1", updatedAt}`。
- `PUT /api/user/external-llm-consent {accepted:boolean}` 记录接受或拒绝；把已接受状态改为 `false` 即撤回。
- 同意版本不是 `qwen-fallback-v1` 时按未选择处理，不能触发外部调用。

同意门由服务端执行：未选择、拒绝或撤回时仍允许调用本地模型，但 Qwen 调用次数必须为零；只有当前版本明确接受后，本地模型失败的同一请求才允许尝试 Qwen。每个外部候选发出请求前都必须重新读取数据库中的当前同意状态，因此用户在本地模型等待期间撤回授权也会阻止尚未发出的外部请求。页面不得用同意弹窗阻断本地聊天。

## 3.1 外部主用部署模式（2026-09-04 增补）

当部署环境设置 `EXTERNAL_CHAT_PRIMARY=true` 且外部供应商（`GATEWAY_QWEN_*`，任意 OpenAI 兼容端点）已配置时，聊天与解释场景以外部模型为**主力**，llama.cpp 变为可选回退：

- 本地模型缺失或未配置不再返回 `LOCAL_LLM_NOT_CONFIGURED`；`/api/llm/status` 的 `mode` 为 `external_primary`。
- 外部模型仍受 §3 同一同意门约束：用户未明确接受时 Qwen 调用次数为零（此时聊天不可用，界面引导开启；同意文案明示「聊天由经批准的云端模型提供」）。
- 记忆建议（§4.1 的按需候选）在同一部署模式下允许走同一外部模型与同一同意门；默认本地优先模式下仍仅 llama.cpp。
- 供应商地址、模型与凭据只来自部署环境（密钥只读文件），不从页面接收；外部供应商槽位保持供应商中立，不在代码中硬编码任何具体供应商。

## 4. 聊天与外发合同

聊天发送请求保持 `{content}`：

- 成功：`{status:"ok", userMessage, aiMessage, source:"local_model"|"qwen"|"local_template"}`。
- 危机阻断：`{status:"blocked", userMessage, intervention:{level,message,resources}}`。
- 本地模型未配置：503 `LOCAL_LLM_NOT_CONFIGURED`。
- 本地模型不可用且没有可用的已授权云端备用：503 `LOCAL_LLM_UNAVAILABLE`。
- 已授权云端备用但所有候选模型都不可用：503 `LLM_UNAVAILABLE`。

成功响应的 `source` 为 `local_model | qwen | local_template`。任何模型失败时该次消息都不持久化，前端保留输入供重试。

llama.cpp 使用 OpenAI-compatible、`stream:false` 接口。实例管理员可在受控页面检测、测试并保存 Base URL 与模型；服务端只接受 `LOCAL_LLM_ALLOWED_ORIGINS` 精确白名单中的地址，不跟随重定向，也不从页面接收密钥。Qwen 同样使用 OpenAI-compatible 非流式接口，地址、模型与凭据只来自部署环境，且只作为可选备用。送入任何模型的负载遵守：

- 系统提示另计；业务消息最多 20 条，按旧到新排列，即最多 19 条历史加当前输入。
- 业务消息只含 `role` 和脱敏后的 `content`。
- 最多注入 5 条与当前输入存在确定性词/标签重合的显式记忆；importance 仅在相关结果内排序。
- 手机号、邮箱、证件号等确定性脱敏；不发送用户 ID、用户手机号字段、时间戳、图片、日志或无关记忆。
- 输出命中威胁、拱火、浪漫化伤害、冒充真人或替用户决定重大人生事项等红线时替换为安全模板。

三套版本化人格提示允许网络化表达和轻度脏话，但 AI 身份、安全边界和用户自主性不可被人格或用户提示覆盖。

## 4.1 智能体工具回路（2026-09-04 增补）

聊天回路允许模型以整段 JSON（`{"tool":"注册名","args":{...}}`）请求调用产品内工具：服务端经既有领域服务校验执行（仅当前用户数据），结果以 system 消息回喂，最多 3 轮后强制文本回复。工具域仅为待办/倒数日/经期/提醒/日记/手帐；不执行任意代码，不向工具开放记忆写入、不开放外部 provider 直连。工具调用不产生任何面向用户的流式增量；每轮工具执行摘要以 `toolRuns` 随 AI 消息持久化，向用户明示。

## 5. 危机安全

危机检测发生在同意检查和模型调用之前。中高风险输入在一个数据库事务中写入用户消息、固定干预回复和唯一一条 `CrisisLog`，返回 `status:"blocked"`，模型调用次数必须为零。

仓库默认不提供未核验热线号码。展示资源必须由产品负责人书面批准，记录官方来源与核验日期；不得在没有证据时声明“24 小时”等可用性。

## 6. 显式记忆

新用户记忆为空。`/api/memories` 提供带当前用户归属检查的创建、列表、编辑、删除和清空接口，沿用 `semantic | episodic | procedural`、importance 与 tags。系统不自动提取、不由模型推断记忆。

## 7. 虚拟房间合同

- 虚拟化妆间/虚拟试衣间（2026-09-05 起，依 `docs/architecture/local-first-capabilities.md` §2 第 4 款程序更新隐私合同）：照片经浏览器 → 主 API → 本机 ComfyUI 处理，全程只在这台设备内存中流转，不落库、不送任何外部模型或外部生图 API。
- 生图提示词由主模型把目录条目的中文描述 + 用户备注（脱敏后）改写为英文提示词；主模型不可用时退化为目录描述直拼的确定性模板。照片绝不送给主模型。
- `POST /api/virtual/image-gen/generations` 为 multipart：照片 ≤8MB，仅 JPEG/PNG/WebP；ComfyUI 不在线/超时/无输出时返回 503 `IMAGE_GEN_UNAVAILABLE`，前端诚实显示"接入中"，不出现伪生成。
- 妆教模块（`/makeup/`）已于 2026-09-05 移除下线。

## 8. 运行与数据

- 环境变量必须在业务模块加载前读取并严格校验；密钥、白名单、模型地址、域名和证书不得进入仓库。
- PostgreSQL 使用纯初始迁移；空库只能通过 `prisma migrate deploy` 建库，不允许 `db push`。
- migration job 成功后才启动 API；API ready 只检查 PostgreSQL，不把用户尚未启动的消费级本地模型误判为应用宕机。
- `/api/health/live` 只表示进程存活；`/api/health/ready` 可随依赖恢复自动恢复。
- 登录用户通过 `/api/llm/status` 查看去敏后的本地模型状态和云端备用状态；本地模型未加载时应用仍保持 ready。
- 日志只允许 request ID、scene、provider/model、尝试次数、延迟和结果，不记录提示词、正文、记忆、凭据或图片。
- 发布使用不可变镜像 tag。初始基线后只增量迁移；迁移前 `pg_dump`，并演练旧镜像和数据库恢复。

## 9. 发布验收

发布门要求：清洁检出后 frozen install、lint、typecheck、全部测试和构建通过；真实 PostgreSQL 迁移/重启/查询通过；真实 llama.cpp 完成检测、冷启动、聊天、本地失败与重试验收；核心 Playwright E2E、安全、键盘、焦点、标签、live region、44px 触控、缩放、reduced-motion 与 axe 检查通过；危机和人格冻结输入集通过；Compose TLS、深链、健康依赖、持久卷、备份恢复和镜像回滚完成演练。

真实 Qwen 只做人工风格验收，必须在用户提供密钥并再次批准外部调用后执行。最终发布前的只读代码审查不得留有未解决的 P0/P1。该内测不等同于正式 WCAG、医疗或法律合规认证。
