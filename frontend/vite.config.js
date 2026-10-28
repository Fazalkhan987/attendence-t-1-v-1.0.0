import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const target = env.VITE_BACKEND_URL || 'http://127.0.0.1:8000'
  return {
    plugins: [react()],
    server: {
      port: 5173,
      host: true,
      // Same-origin in development: the browser talks to Vite, Vite forwards to FastAPI.
      proxy: {
        '/api': { target, changeOrigin: true },
        '/ws': { target: target.replace(/^http/, 'ws'), ws: true },
      },
    },
  }
})
