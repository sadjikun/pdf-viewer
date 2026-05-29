import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// Dedicated test config (takes precedence over vite.config.ts for `vitest`).
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
