import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    // Pin the jsdom origin. The API client resolves its relative paths
    // against window.location.origin, and Node's fetch rejects relative URLs
    // outright — without a fixed origin the tests fail confusingly.
    environmentOptions: { jsdom: { url: 'http://localhost:7777' } },
    setupFiles: ['./src/setupTests.ts'],
    globals: true,
  },
})
