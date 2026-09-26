import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { startThemeSync } from './stores/themeStore'
import { startLetterFontSync } from './stores/letterFontStore'
import { startDecorSync } from './stores/decorStore'
import { startPaletteSync } from './stores/paletteStore'
// 信纸上的手写字：霞鹜文楷·屏幕版（GB 字形，OFL）。按 unicode-range 切成小块，浏览器只取用到的字
import 'lxgw-wenkai-screen-webfont/lxgwwenkaigbscreen.css'
import './styles/globals.css'

const stopThemeSync = startThemeSync()
startLetterFontSync()
startDecorSync()
const stopPaletteSync = startPaletteSync()
if (import.meta.hot) {
  import.meta.hot.dispose(stopThemeSync)
  import.meta.hot.dispose(stopPaletteSync)
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
