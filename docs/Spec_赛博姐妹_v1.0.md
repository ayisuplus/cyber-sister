# Spec - 赛博姐妹 Web应用 v1.0

> 生成日期：2026-07-12
> 基于：PRD Web版 + 架构设计文档 + UIUX设计文档
> 状态：已确认

---

## 1. 产品定义

- **一句话描述**：面向中国年轻女性的AI闺蜜Web应用
- **目标用户**：22-28岁一二线城市女性
- **核心问题**：年轻女性需要一个"懂自己"的AI闺蜜

## 2. MVP范围（锁定）

| 优先级 | 功能 | 验收标准摘要 |
|--------|------|-------------|
| P0 | 用户注册/登录 | 手机号+验证码，JWT鉴权 |
| P0 | 聊天界面 | AI标识、消息气泡、输入框、发送、打字动画 |
| P0 | 人格切换 | 3种预设人格，切换即时生效 |
| P0 | Mock对话引擎 | 规则匹配+预设回复，预留LLM API |
| P0 | 四层记忆系统 | 瞬时/情景/语义/程序，PostgreSQL存储 |
| P0 | 工具功能 | 天气、待办、倒数日、大姨妈、提醒 |
| P0 | 合规安全 | AI标识、2小时提醒、危机干预、未成年人保护 |
| P0 | 会员系统 | 免费/会员版，权益区分 |
| P0 | 我的页面 | 用户信息、人格切换、设置 |

### 明确不做（Won't Have）
- LLM训练/微调 — 用户要求排除
- 语音/视频通话 — V1.5
- 图片生成 — V1.5
- UGC角色创建 — V1.0不做
- 群聊 — V1.0不做

## 3. 技术架构（锁定）

- **前端**：React 18 + Vite + TailwindCSS + Zustand + Lucide Icons
- **后端**：Node.js + Express + Prisma ORM
- **数据库**：PostgreSQL 16
- **认证**：JWT (access + refresh token)
- **对话引擎**：Mock（预留LLM API接口）

## 4. API端点清单（锁定）

### 认证
| Method | Path | 功能 |
|--------|------|------|
| POST | /api/auth/send-code | 发送验证码 |
| POST | /api/auth/login | 验证码登录 |
| POST | /api/auth/refresh | 刷新token |

### 用户
| Method | Path | 功能 |
|--------|------|------|
| GET | /api/user/profile | 获取用户信息 |
| PUT | /api/user/profile | 更新用户信息 |
| PUT | /api/user/persona | 切换人格 |

### 聊天
| Method | Path | 功能 |
|--------|------|------|
| GET | /api/chat/conversations | 会话列表 |
| POST | /api/chat/conversations | 新建会话 |
| GET | /api/chat/conversations/:id | 会话详情 |
| POST | /api/chat/conversations/:id/messages | 发送消息 |

### 记忆
| Method | Path | 功能 |
|--------|------|------|
| GET | /api/memories | 记忆列表 |
| PUT | /api/memories/:id | 编辑记忆 |
| DELETE | /api/memories/:id | 删除记忆 |
| DELETE | /api/memories | 清空所有 |

### 工具
| Method | Path | 功能 |
|--------|------|------|
| GET/POST | /api/tools/todos | 待办CRUD |
| GET/POST | /api/tools/countdowns | 倒数日CRUD |
| GET/POST | /api/tools/period | 大姨妈记录 |
| GET/PUT | /api/tools/reminders | 提醒设置 |
| GET | /api/tools/weather | 天气 |

### 合规
| Method | Path | 功能 |
|--------|------|------|
| POST | /api/compliance/crisis | 危机事件上报 |
| GET | /api/compliance/usage/status | 使用时长 |

## 5. 数据库表（锁定）

| 表名 | 核心字段 | 关联 |
|------|----------|------|
| users | id, phone, nickname, persona, is_vip, birth_date | - |
| conversations | id, user_id, title, persona | users |
| messages | id, conversation_id, role, content, emotion, importance | conversations |
| memories | id, user_id, type, content, entities, importance, expires_at | users |
| todos | id, user_id, content, due_date, is_done | users |
| countdowns | id, user_id, title, target_date | users |
| period_records | id, user_id, start_date, end_date, cycle_days | users |
| reminders | id, user_id, type, time, is_active | users |
| crisis_logs | id, user_id, trigger_msg, level | users |

## 6. 页面清单（锁定）

| 页面 | 路由 | 核心组件 | 对应API |
|------|------|---------|---------|
| 登录 | /login | LoginForm, CodeInput | auth/* |
| 聊天主页 | /chat | ChatHeader, MessageList, InputBar | chat/* |
| 工具箱 | /tools | ToolGrid, CareCard | tools/* |
| 大姨妈 | /tools/period | Calendar, PeriodRecord | tools/period |
| 我的 | /profile | UserCard, PersonaSwitch | user/* |
| 记忆管理 | /profile/memories | MemoryList | memories/* |
| 会员中心 | /membership | PlanCard, FeatureList | user/membership |
| 设置 | /settings | SettingsList | user/* |

## 7. 设计Token（锁定）

- **主色**：#FF6B9D (pink)
- **辅色**：#6B5FC6 (purple), #6B8AFF (blue)
- **字体**：Noto Sans SC + Inter
- **图标库**：Lucide React
- **主题**：浅色（白色背景）
- **对标**：原型 index.html Design Token 1:1映射

## 8. 验收标准（锁定）

| 编号 | 功能 | Given | When | Then |
|------|------|-------|------|------|
| A01 | 登录 | 用户打开应用 | 输入手机号+验证码 | 登录成功跳转聊天页 |
| A02 | 发送消息 | 用户在聊天页 | 输入消息并发送 | 消息显示+AI回复+打字动画 |
| A03 | 人格切换 | 用户在我的页 | 点击切换人格 | 聊天风格变化 |
| A04 | 危机干预 | 用户发送危险关键词 | 系统检测 | 弹出危机干预全屏弹窗 |
| A05 | 2小时提醒 | 用户连续使用2小时 | 系统检测 | 弹出提醒弹窗 |
| A06 | 大姨妈记录 | 用户记录经期 | 点击记录按钮 | 日历显示周期标记 |
| A07 | 待办管理 | 用户添加待办 | 输入内容并提交 | 待办出现在列表 |
| A08 | 会员开通 | 用户点击开通会员 | 模拟支付 | 会员状态更新 |

## 9. 边界与约束

- 移动端优先响应式（393×852基准）
- Desktop居中显示手机模拟器效果
- 聊天消息本地持久化（localStorage + API同步）
- Mock验证码固定为 888888
- 环境变量管理敏感配置
