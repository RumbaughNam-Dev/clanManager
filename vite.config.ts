import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: '/clanManager/',
  plugins: [react()],
  build: {
    sourcemap: true,
    minify: false,        // ← 일단 끔 (grep/확인 쉬움)
  },
})