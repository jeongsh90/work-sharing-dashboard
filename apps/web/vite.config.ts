import { execSync } from 'node:child_process'
import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

function gitCommit() {
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
  } catch {
    return ''
  }
}

// https://vite.dev/config/
export default defineConfig({
  // GitHub Pages 는 /work-sharing-dashboard/ 하위 경로, 로컬·Tailscale 은 / 에서 연다.
  base: process.env.VITE_BASE ?? '/',
  plugins: [react(), tailwindcss()],
  // 버전 정보 화면에 보여 줄 배포 시각과 커밋(git 이 없으면 비워 둔다)
  define: {
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
    __COMMIT__: JSON.stringify(gitCommit()),
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    host: true,
    allowedHosts: ['.ts.net'],
    // 로컬 개발에서는 apps/api 서버(4173)로 API 요청을 넘긴다. 시험용 서버로 바꿀 때는 WSD_API_PROXY 를 준다.
    proxy: {
      '/api': process.env.WSD_API_PROXY ?? 'http://localhost:4173',
    },
  },
})
