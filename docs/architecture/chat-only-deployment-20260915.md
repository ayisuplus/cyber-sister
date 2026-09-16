# 聊天版分离部署

> ⚠️ **状态：已被取代（2026-09-16）**。产品负责人决定前后端都落在同一台服务器：改用 `compose.yaml` + `deploy/compose.server.yaml`（edge nginx 同源发页面并反代 `/api`），部署由 CI/CD 流水线执行，见 [`docs/04-开发/CI-CD流水线.md`](../04-开发/CI-CD流水线.md)。
> 本文保留为 09-15 那次部署的历史记录：它是当时唯一真正上过线的形态，其中的限制（无 HTTPS 域名、ECS 对部分公网 TLS 超时导致聊天返回 `LLM_UNAVAILABLE`）**仍未解决**，与部署方式无关。
> 迁移到全栈同机之前，`deploy/compose.chat.yaml` 与 `deploy/chat.Dockerfile` 暂时保留，首次全栈部署验收通过后删除。

状态：2026-09-15，用户已授权部署，当前尚未完成外网聊天接通。

## 分工

- 前端：[Amie Sites](https://amie-companion.zluo66977.chatgpt.site)，保留原有仅所有者访问权限。页面与静态资源留在 Sites。
- 后端：青岛 ECS `i-m5e4bvd5phfti7kmbx31`，目录 `/opt/amie-chat`，仅 API、PostgreSQL 和一次性迁移容器。未部署 Nginx 前端、工作容器或生图服务。
- `deploy/chat.Dockerfile` 构建 `amie-chat-api:20260915-01`，Node 24；镜像只复制 API 源码，不复制本地数据或真实环境文件。
- `deploy/compose.chat.yaml` 是聊天后端模板。复制为部署目录的 `compose.yaml`，同目录保存私有 `runtime.env` 和 `secrets/`。用 `docker compose --env-file runtime.env up -d` 启动。不要把真实密钥文件放进仓库。

## 限制

- API 仅监听 `127.0.0.1:3000`；数据库仅发布 `127.0.0.1:55433`。数据库与用户资产使用独立持久卷；本地个人数据库未迁移。
- API 内存上限 768MB、Node 堆 512MB；PostgreSQL 上限 384MB，30 个连接；日志单文件 10MB、保留三份。Docker 自启，服务自动恢复。
- 云端强制 `APP_DISTRIBUTION=web`，所有工作执行开关关闭；浏览器伪造客户端头不会启用工作。相关 API 返回 `LOCAL_CLIENT_REQUIRED`。
- 开发测试可用 `APP_DISTRIBUTION=local`、`BIND_ADDRESS=127.0.0.1` 和 `VITE_APP_DISTRIBUTION=local` 验证保留的工作功能。这是部署隔离开关，并非已实现客户端安装证明；正式本地客户端尚待建设。

## 当前上线状态

- Sites 前端第 2 版已发布，构建参数 `VITE_APP_DISTRIBUTION=web`、`VITE_BACKEND_PENDING=true`；登录页明确显示未接通，不向无效 API 提交凭据。
- ECS 已从无运行容器的 Podman 兼容环境安装 Docker CE 26.1.3 与 Compose 2.27.0。没有进行整体系统升级、修改旧 VPS 或重启服务器。
- 镜像上传校验通过，数据库迁移成功，API 就绪检查返回数据库正常。
- 尚无后端 HTTPS 域名。不得把 HTTP 公网 IP 直接写入 HTTPS 前端。接通时须验证 SSE、精确 CORS、登录刷新 Cookie 与退出登录；当前 Cookie 为 SameSite=Lax，跨站直连不能假定刷新可用，同源 API 代理优先。
- ECS 对 Dots 模型两条解析地址及其他公网地址的 TLS 请求超时。安全组无额外出站规则，交换机无网络 ACL；内网镜像源可用。抓包仅记录协议元数据，显示数据重传；尚未确认根因，不标记真实聊天通过。

## 验证

- API 单元及接口测试：1056 通过；另建隔离 PostgreSQL 运行 61 项集成测试，全部通过；Web：736 通过；类型检查通过，lint 无错误（保留已有警告）。
- 新增测试覆盖默认关闭、回环约束、伪造头不启用工作、工作会话创建拒绝、前端工具路由跳转与历史工作会话隔离。
- 实际 ECS smoke：就绪、登录、创建会话、工作拦截全部通过；真实聊天返回 HTTP 503 / `LLM_UNAVAILABLE`。测试使用独立临时用户并在结束后清理；个人数据库未改动。记录保存在工作区 `asset-work/chat-only-20260915/`；不能用单元测试替代模型连通性。

Docker 安装参考：[阿里云官方说明](https://help.aliyun.com/zh/ecs/user-guide/install-and-use-docker)。
