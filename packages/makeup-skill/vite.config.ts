import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(fileURLToPath(import.meta.url), '..');

export default defineConfig({
  base: '/makeup/',
  plugins: [react(), tailwindcss()],
  root: path.join(projectRoot, 'public'),
  resolve: {
    alias: {
      // Used by public/index.html <script src="/src/frontend/main.tsx">
      '/src': path.join(projectRoot, 'src'),
      '@shared': path.join(projectRoot, 'src/shared'),
      '@frontend': path.join(projectRoot, 'src/frontend'),
      '@backend': path.join(projectRoot, 'src/backend'),
    },
  },
  server: {
    port: 5173,
    strictPort: false,
    proxy: {
      '/makeup/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        rewrite: (requestPath) => requestPath.replace(/^\/makeup\/api/, '/api'),
      },
    },
  },
  build: {
    outDir: path.join(projectRoot, 'dist'),
    emptyOutDir: true,
    sourcemap: true,
    target: 'es2020',
  },
});
