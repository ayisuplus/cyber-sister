import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { iosBuildSettings } from './scripts/ios-config.mjs'

export default defineConfig(({ mode }) => {
  const mobile = mode === 'ios'
  const ios = mobile ? iosBuildSettings() : null
  return {
  envDir: mobile ? false : undefined,
  envPrefix: mobile ? 'AMIE_NO_AUTOMATIC_CLIENT_ENV_' : 'VITE_',
  define: mobile ? {
    'import.meta.env.VITE_CLIENT_TARGET': JSON.stringify('ios'),
    'import.meta.env.VITE_APP_DISTRIBUTION': JSON.stringify('web'),
    'import.meta.env.VITE_API_BASE_URL': JSON.stringify(ios.apiUrl),
  } : {},
  build: mobile ? { outDir: 'dist-ios' } : {},
  plugins: [react(), ...(mobile ? [{
    name: 'ios-content-policy',
    transformIndexHtml: () => [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: ios.csp }, injectTo: 'head-prepend' }],
  }] : [])],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true
      }
    }
  }
  }
})
