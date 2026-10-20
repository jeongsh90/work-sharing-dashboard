import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  // GitHub Pages 는 /work-sharing-dashboard/ 하위 경로, 로컬·Tailscale 은 / 에서 연다.
  base: process.env.VITE_BASE ?? '/',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    host: true,
    allowedHosts: ['.ts.net'],
    // 로컬 개발에서는 apps/api 서버(4173)로 로그인 요청을 넘긴다.
    proxy: {
      '/api': 'http://localhost:4173',
    },
  },
})
