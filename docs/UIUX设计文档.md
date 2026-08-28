# 赛博姐妹 Web应用 UI/UX设计文档

> 基于原型设计 `prototype/index.html` 提取
> 生成日期：2026-07-12

---

## 1. 设计系统 (Design Tokens)

### 1.1 色彩系统

```css
:root {
  /* 背景色 */
  --bg: #FFFFFF;
  --bg-message: #FAF9FE;
  
  /* 文字色 */
  --text-primary: #1A1A2E;
  --text-secondary: #6B6B8A;
  --text-muted: #B0B0C8;
  
  /* 品牌色 */
  --accent-pink: #FF6B9D;      /* 主品牌色 */
  --accent-purple: #6B5FC6;    /* 辅助色 */
  --accent-blue: #6B8AFF;      /* 信息色 */
  --accent-yellow: #FFCB47;    /* 警告色 */
  --accent-green: #10B981;     /* 成功色 */
  
  /* 边框/阴影 */
  --border-subtle: #EBEEF5;
  --input-bg: #F5F5FA;
  --card-shadow: 0 2px 8px rgba(0,0,0,0.04);
  --header-shadow: 0 1px 4px rgba(0,0,0,0.04);
  --input-shadow: 0 -2px 8px rgba(0,0,0,0.06);
  
  /* 渐变 */
  --gradient-pink-purple: linear-gradient(135deg, #FF6B9D 0%, #B5A6FF 100%);
  --gradient-pink-light: linear-gradient(135deg, #FF6B9D 0%, #F273B3 100%);
  --gradient-purple-light: linear-gradient(135deg, rgba(181,166,255,0.15) 0%, rgba(255,196,242,0.15) 100%);
  
  /* 圆角 */
  --radius-sm: 10px;
  --radius-md: 16px;
  --radius-lg: 20px;
  --radius-pill: 25px;
  --radius-circle: 50%;
}
```

### 1.2 字体系统

```css
--font-sans: 'Noto Sans SC', -apple-system, BlinkMacSystemFont, sans-serif;
--font-serif: 'Noto Serif SC', serif;
--font-mono: 'Inter', sans-serif;  /* 数字等 */
```

**字体规范**：
- 标题：Noto Serif SC, 600-700, 16-24px
- 正文：Noto Sans SC, 400-500, 14-15px
- 辅助文字：Noto Sans SC, 400, 11-12px
- 数字：Inter, 500-700

### 1.3 间距系统

基于4px基准：
- xs: 4px, sm: 8px, md: 12px, lg: 16px, xl: 20px, 2xl: 24px, 3xl: 32px

---

## 2. 组件规范

### 2.1 消息气泡 (Bubble)

| 属性 | AI气泡 | 用户气泡 |
|------|--------|---------|
| 背景 | #fff | gradient-pink-light |
| 文字色 | text-primary | #fff |
| 圆角 | radius-md, 左下4px | radius-md, 右下4px |
| 阴影 | card-shadow | 无 |
| 最大宽度 | 260px | 260px |
| 内边距 | 12px | 12px |

### 2.2 输入框 (Input Bar)

- 高度：36px
- 背景：input-bg (#F5F5FA)
- 圆角：18px (pill)
- 阴影：input-shadow (上方)
- 发送按钮：32px圆形，accent-pink背景

### 2.3 Tab Bar

- 高度：56px + 21px底部安全区
- 图标：24px
- 文字：10px, 500 weight
- 激活色：accent-pink
- 未激活色：text-muted

### 2.4 卡片 (Card)

- 背景：#fff
- 圆角：radius-lg (20px)
- 阴影：card-shadow
- 内边距：16-20px

### 2.5 弹窗 (Modal)

- 背景遮罩：rgba(0,0,0,0.4)
- 弹窗：24px圆角, 32px内边距
- 按钮：gradient-pink-purple, 23px圆角, 阴影

---

## 3. 页面详细设计

### 3.1 登录页

**布局**：全屏居中
- 顶部：产品Logo + "赛博姐妹"标题
- 中部：手机号输入框 + 验证码输入框 + 获取验证码按钮
- 底部：登录按钮(gradient) + 用户协议链接
- 首次登录弹出AI身份确认弹窗

### 3.2 聊天主页 (`/chat`)

**从上到下的层级**：
1. **状态栏区域**（仅展示，Web可省略）
2. **AI身份标识栏**：32px高，purple-light渐变背景，"这是AI，不是真人"提示
3. **聊天头部**：56px高
   - 左侧：返回箭头 + AI头像(渐变圆形) + 名称 + 人格标签
   - 右侧：电话图标 + 更多菜单
4. **消息区域**：flex-1，可滚动
   - 时间戳（居中灰色）
   - AI消息行：头像 + 气泡
   - 用户消息行：气泡（右对齐）
   - 打字指示器：三个跳动的点
5. **快捷工具栏**：天气/提醒/大姨妈/待办 chips
6. **输入栏**：+按钮 + 输入框 + emoji按钮 + 发送按钮
7. **底部Tab栏**：聊天/工具/我的

### 3.3 工具箱页 (`/tools`)

- 顶部标题"工具箱" + 搜索图标
- 主动关怀卡片：gradient-pink-purple圆角卡片，展示当天提醒
- 工具网格：2列布局
  - 天气提醒、大姨妈记录、倒数日、待办提醒、喝水提醒、睡觉提醒
  - 每个工具：图标(36px圆角方形) + 名称

### 3.4 大姨妈记录页 (`/tools/period`)

- 顶部：返回 + 标题 + 占位
- Hero区域：粉色渐变圆角卡片
  - "距离下次大姨妈还有" + 大数字(64px Inter) + "天"
  - 预计日期
- 日历卡片：白色圆角卡片
  - 年月标题
  - 星期行（六日粉色高亮）
  - 日期网格：周期日粉色圆底，今天渐变圆底
- 记录卡片：最近2-3条记录
- 底部按钮："+ 记录今天"

### 3.5 我的页面 (`/profile`)

- 顶部标题"我的" + 设置图标
- 用户卡片：头像(渐变) + 昵称 + VIP标签 + 箭头
- 人格切换区：
  - 3列布局，每列一个人格卡片
  - 当前选中：粉色边框 + "当前使用"标签
  - 未选中：点击切换
  - 会员专属：点击跳转会员页
- 设置菜单列表：
  - 记忆管理、隐私与安全、通知设置、关于赛博姐妹、退出登录
  - 每项：左侧图标+文字，右侧箭头

### 3.6 会员中心 (`/membership`)

- 顶部：返回 + "升级会员"
- 标题区：居中大标题 + 描述
- 免费版卡片：白色，列出免费权益
- 会员版卡片：粉色渐变边框，"推荐"标签
  - ¥18/月 + 连续包月¥12/月
  - 全部权益列表
- 底部按钮："立即开通会员"
- 提示文字："所有付费明码标价，无情感绑定，无抽卡盲盒"

### 3.7 危机干预弹窗

- 全屏遮罩
- 心形图标 + "我很担心你"标题
- 提示文字
- 热线卡片：3条热线（400-161-9995, 010-82951332, 400-821-1215）
- 按钮："我已联系帮助"
- 不可关闭（除非点击按钮）

### 3.8 2小时使用提醒弹窗

- 时钟图标 + "已经聊了两个小时啦"
- 描述："起来活动一下，喝杯水吧"
- 按钮："好的，知道了"
- 链接："再聊5分钟"

---

## 4. 交互规范

### 4.1 消息发送流程

```
用户输入 → 点击发送/回车
  ↓
消息立即显示（用户气泡，右对齐）
  ↓
300ms后显示打字指示器（AI头像 + 3个跳动点）
  ↓
1200-2000ms后显示AI回复（打字指示器消失）
  ↓
自动滚动到底部
```

### 4.2 长按/右键菜单

消息气泡支持长按/右键弹出上下文菜单：
- 复制
- 转发
- 删除（红色）
- 举报

### 4.3 页面切换

- Tab切换：无动画，即时切换
- 子页面进入：从右向左滑入 (transform: translateX)
- 弹窗：遮罩淡入 + 内容缩放

### 4.4 加载状态

- 骨架屏用于页面加载
- 打字指示器用于AI回复等待
- 按钮loading状态

---

## 5. 响应式策略

| 断点 | 宽度 | 布局 |
|------|------|------|
| Mobile | < 640px | 全屏，原型1:1还原 |
| Tablet | 640-1024px | 居中max-width: 480px，两侧留白 |
| Desktop | > 1024px | 居中手机模拟器效果（如原型展示方式） |
