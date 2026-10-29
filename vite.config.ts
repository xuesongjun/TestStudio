import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  root: 'frontend',
  plugins: [vue()],
  build: { outDir: '../dist/frontend', emptyOutDir: true },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: { '/api': { target: process.env.TESTSTUDIO_BACKEND_URL ?? 'http://127.0.0.1:8765', ws: true } },
  },
})
