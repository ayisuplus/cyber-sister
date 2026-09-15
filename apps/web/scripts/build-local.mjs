// e2e 用本地客户端分发构建：安排、手记、经期、装扮等 /tools/ 入口只在本地客户端可达。
// 用 Vite 的 JS API 设置变量，Windows 与 POSIX shell 下都可用，不需要额外依赖。
import { build } from 'vite'

process.env.VITE_APP_DISTRIBUTION = 'local'
await build()
