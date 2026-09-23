// e2e 默认用带本机能力界面（附文件、后台执行）的构建；生活入口在 Web 构建里同样可用，CI 另用 Web 构建复验。
// 用 Vite 的 JS API 设置变量，Windows 与 POSIX shell 下都可用，不需要额外依赖。
import { build } from 'vite'

process.env.VITE_APP_DISTRIBUTION = 'local'
await build()
