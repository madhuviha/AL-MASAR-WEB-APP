import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const proxyTarget = env.VITE_PROXY_TARGET || 'http://127.0.0.1:3001'
  const schoolProxyTarget = env.VITE_SCHOOL_API_TARGET || 'http://127.0.0.1:3002'

  return {
    plugins: [react()],
    server: {
      host: '127.0.0.1',
      port: 5173,
      strictPort: true,
      proxy: {
        '/school-api': {
          target: schoolProxyTarget,
          changeOrigin: true,
          secure: false,
          rewrite: path => path.replace(/^\/school-api/, '')
        },
        '/inviha-api': {
          target: proxyTarget,
          changeOrigin: true,
          secure: false,
          rewrite: path => path.replace(/^\/inviha-api/, '')
        }
      }
    }
  }
})
