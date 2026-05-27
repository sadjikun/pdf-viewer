import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",   // forcer IPv4 (évite EACCES sur ::1 IPv6 Windows)
    port: 5442,          // 5173 est dans la plage Windows exclue 5142-5241 (Hyper-V/WSL)
  },
})
