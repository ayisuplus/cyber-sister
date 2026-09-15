# 工作模式网页操作

状态：✅ 当前有效。更新于 2026-09-15。已通过本地 Docker 与真实 Dots 验收，尚未部署 VPS。

## 使用与结果

工作模式新增 `browser_open`、`browser_act`、`browser_snapshot`，模型可打开动态网页、读取正文和控件，点击、填写公开检索条件、选择选项、按键及滚动。每次操作返回新页面，模型应核对结果再报告完成。截图为真实浏览器生成的 PNG，经现有会话文件服务保存和下载；前端工具进度显示「打开网页」「操作页面」「核对页面与截图」。

浏览器使用独立匿名上下文，不读取用户电脑的浏览器、Cookie 或登录会话。第六批已补齐[后台任务的逐次提交确认](work-actions-20260915.md)：展示实际请求后等待用户确认再发送。账号登录、文件上传、站点下载和新窗口仍未开放；图片、视频与音频生成由后续 RunningHub 接口负责，工作流和应用 ID 按用户要求暂留空。

`read_web` 继续适合普通正文获取，不执行网页脚本。遇到动态内容时可使用浏览器；搜索服务未配置时仍可打开用户提供或资料中已经出现的公开 URL。网页正文和控件名称均是不可信资料，不是用户授权或系统指令。

## 执行与网络边界

`workBrowserService` 管理容器、授权、请求转发和生命周期，`workBrowserTools` 负责工作回合与文件服务接线。Python 与浏览器共用 `workContainerService` 的 Docker 调用、确认删除与到期回收，仍位于现有 API 模块化单体中。

- 每个工作回合创建独立 Chromium 容器及非持久化上下文；同一 API 进程最多两个，同一用户最多一个。浏览器对象留在当前工作回合，不进入数据库检查点。
- 容器使用 `--network none`、只读根目录、非 root 用户、`--cap-drop ALL`、`no-new-privileges` 和 Chromium 沙箱；没有主机目录、用户凭据或 Docker socket 挂载。限制 768 MB 内存、1 CPU、128 进程与 256 MB 临时目录。
- Playwright 拦截页面请求，普通浏览允许 GET；需要提交时通过服务端一次性确认。请求通过 stdin/stdout 交给 API：复核云端授权、公开 URL、DNS 全部地址和重定向目标，并将已验证 IP 固定到连接。浏览器 Cookie、Authorization、Referer 等请求头不转发；响应只保留内容类型、CSP 及必要的跨域策略头，不转发 Set-Cookie。
- 每个资源压缩前后均最多 2 MB；每次浏览最多 120 个资源、六个并发请求、累计 24 MB。WebSocket、Service Worker、媒体流、未确认的提交和不支持的内容类型受到限制；页面可能因此功能不完整。
- 正文最多 18000 字符；在前 200 个匹配元素中提供可见控件，排除密码与文件输入。控件编号随每次读取更新，执行时复核原元素的名称、角色、类型和链接；失效编号必须重新读取。工具不接收任意 JavaScript、CSS 选择器、Shell 或主机路径。

GET 限制并不等于服务端业务操作无副作用；已实现的提交确认仍不覆盖账号登录、凭据、跨域预检与所有业务动作。资料标记也不能证明已经解决提示注入。以上实测边界不代表生产环境隔离已通过验收。

## 结束、取消与恢复

普通浏览器最长运行三分钟，每项页面命令最多 35 秒；开启后台提交确认时，浏览器寿命延至十分钟、提交命令最多 330 秒。回合成功、失败、取消、供应商异常或消费者提前结束时，`agentTurn` 都等待浏览器确认删除；清理失败不会提交成功回合。取消同时中止资源请求，之后不再发起网络访问。

Docker 的 `--rm` 在容器退出时自动删除；容器还带 `app.amie.sandbox=browser-v1` 标签，普通浏览器四分钟到期，允许后台确认的浏览器十一分钟到期。启用浏览器或 Python 的 API 启动时及每 30 秒按已启用类型扫描，每批最多回收十个到期容器。只匹配专属标签和有效期限；Docker 查询失败不能报告已清理。API 全部停止时没有独立宿主监督器，已启动的浏览器依靠自身运行超时退出。

后台任务可以使用这三个工具。浏览器读取和操作不走工具结果去重缓存；页面可能变化，必须实际执行。检查点保留已完成的文本结果、来源与文件，重启后需 `browser_open` 重新建立页面，不能使用旧控件编号，也不恢复内存、Cookie 或表单状态。任务消息、截图与角色成长继续在同一事务提交，不自动生成正式记忆。

## 本地配置

从仓库根目录构建镜像：

```powershell
docker build -t amie-work-browser:20260915 apps/api/work-browser-runtime
```

在 API 环境设置 `WORK_BROWSER_ENABLED=true` 和 `WORK_BROWSER_IMAGE=amie-work-browser:20260915`；仓库示例默认关闭。本地 `asset-work/local-debug-20260915/run-local.mjs` 已加入开关，重启后生效。状态接口 `/api/work/status` 返回 `browser.enabled`、`available` 与当前用户的 `running`；镜像检查失败时如实不可用，不降级到主机浏览器。

镜像内固定 `playwright-core@1.62.1`，使用该版本配套的 Chromium。保留 [Playwright Docker 文档](https://playwright.dev/docs/docker)建议的非 root 用户、Chromium 沙箱及 seccomp 配置；网络拦截按 [BrowserContext.route](https://playwright.dev/docs/api/class-browsercontext#browser-context-route) 配置并禁用 Service Worker。

seccomp 文件来自 [Playwright v1.62.1](https://raw.githubusercontent.com/microsoft/playwright/v1.62.1/utils/docker/seccomp_profile.json)，保留 Apache 2.0 许可，并额外在 namespace 规则中允许 `chroot`。原因是删除全部容器 capabilities 后，Chromium 的内部用户命名空间沙箱仍调用 `chroot`；[Chromium 实现](https://chromium.googlesource.com/chromium/src/sandbox/%2B/refs/heads/main/linux/services/credentials.cc)与首次失败诊断均支持该结论。本地未增加外层 capabilities，也未关闭 Chromium 沙箱。

## 验证证据

第五批证据目录为 `../asset-work/work-agent-browser-20260915/`，`verification.json` 汇总检查，`changed-files.json` 与 `task.patch` 仅记录相对此批开始前快照的改动，不覆盖原有未提交工作。

| 验证 | 结果及范围 |
| --- | --- |
| 实际 Chromium 与合成页面 | 13 项通过：动态 JSON 和中文合计 425、真实点击与 GET 检索、过期编号拒绝、PNG、用户隔离、并发限制、取消、内网与 POST 阻断、Cookie 不转发；`browser-smoke.json` |
| 公网默认网络链路 | 实际打开 `https://example.com/`，核对标题、正文和真实链接；没有替换传输实现；`public-browser-smoke.json` |
| 真实 Dots 后台任务 | 12 项通过：模型实际调用打开与截图工具，PNG 保存与下载字节一致、来源正确、单轮消息和一次角色成长、清理后完成、跨用户 404、无正式记忆；`live-agent-browser.json` |
| Python 回归 | 共用容器模块抽取后，11 项真实执行、选择性回收、宿主子进程硬终止和取消检查通过，测试容器全部移除；`runtime-smoke.json` |
| 全量测试 | API 1020 项、Web 725 项通过；默认跳过的 PostgreSQL 47 项在隔离测试数据库另行全部通过 |
| 静态检查与构建 | API/Web lint 零错误，分别保留 171/24 个警告；Web typecheck 和正式构建通过，既有衣橱大包等构建警告仍在 |

真实 Dots 验收只向供应商发送合成任务和公开页面内容，创建独立测试数据库与临时端口 API；测试结束只清理该测试数据库和子进程。已有本地 API、个人数据库、VPS 与网络代理未参与故障注入。`live-agent-screenshot.png` 已人工式图像查看，内容与页面标题一致；这不是产品界面的用户验收。

首次容器启动因为 Chromium `chroot` 被 seccomp 拒绝而失败，保留 `browser-smoke.failed-1.json`。另有两次 API 全量测试遇到 Vitest worker 意外退出，即使 JSON `success` 为真也不能算通过；相关原始报告保留。加入进程诊断的一轮与随后不带诊断、单 worker 的完整回归都以退出码 0 通过，底层 worker 退出原因尚未确定。

第六批提交审批与新增验收见[外部提交确认](work-actions-20260915.md)。账号连接器、登录、跨重启浏览器状态、生产隔离和容量、周期调度、RunningHub 实测仍是后续工作；此批验证不代替整体目标完成或发布验收。
