import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // API_URL / API_KEY have no VITE_ prefix, so they stay on the dev server and
  // never reach the browser bundle. The browser calls /api/* on the same origin
  // and the proxy forwards to API Gateway with the key attached. Same-origin
  // also means the console works behind a tunnel without touching API CORS.
  const env = loadEnv(mode, process.cwd(), '')
  const proxy = {
    '/api': {
      target: env.API_URL,
      changeOrigin: true,
      // The proxy prepends the target's path (/prod), so only strip /api here.
      rewrite: (path: string) => path.replace(/^\/api/, ''),
      headers: { 'x-api-key': env.API_KEY },
    },
  }

  return {
    plugins: [react()],
    server: {
      port: 5173,
      strictPort: true,
      // Tunnel hostnames (cloudflared, ngrok) for sharing a demo.
      allowedHosts: ['.trycloudflare.com', '.ngrok-free.app', '.ngrok.app'],
      proxy,
    },
    preview: { port: 4173, proxy },
  }
})
