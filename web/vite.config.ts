import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    // Vite writes directly into the Go embed directory.
    outDir: '../internal/web/dist',
    emptyOutDir: true,
  },
  server: {
    // `npm run dev` proxies the API to a td-gui already running on 7777,
    // so the frontend can hot-reload against real data.
    proxy: {
      '/v1': 'http://127.0.0.1:7777',
      '/health': 'http://127.0.0.1:7777',
    },
  },
})
