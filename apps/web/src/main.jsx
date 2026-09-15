import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { startThemeSync } from './stores/themeStore'
import './styles/globals.css'

const stopThemeSync = startThemeSync()
if (import.meta.hot) import.meta.hot.dispose(stopThemeSync)

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
