import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const apiTarget = env.VITE_PROXY_TARGET || 'https://track.almasar.qa'
  const schoolApiTarget = env.VITE_SCHOOL_API_TARGET || 'https://track.almasar.qa'

  return {
    plugins: [react()],
    server: {
      host: '127.0.0.1',
      port: 5177,
      strictPort: true,
      proxy: {
        '/school-api': { target: schoolApiTarget, changeOrigin: true, secure: true },
        '/inviha-api': { target: apiTarget, changeOrigin: true, secure: true }
      }
    }
  }
})
