import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    // Vite writes directly into the Go embed directory.
    outDir: '../internal/web/dist',
    emptyOutDir: true,
    // Vite's 500 kB default warns about transfer cost over a network. This
    // bundle is embedded in the binary and served from 127.0.0.1, where its
    // 151 kB gzipped costs nothing, so that default fires on every build
    // without naming a problem. 700 kB keeps the warning able to say
    // something: today's bundle is ~500 kB, of which the react-markdown and
    // micromark stack is ~160 kB, so this still catches a dependency of that
    // size arriving unnoticed.
    chunkSizeWarningLimit: 700,
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
