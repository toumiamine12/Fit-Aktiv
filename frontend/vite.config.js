import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import basicSsl from '@vitejs/plugin-basic-ssl'

// FITAKTIV_LAN=1 npm run dev: reachable from a phone in the home network, over HTTPS
// (phones only allow the camera on secure pages). The certificate is self-signed, so the phone warns once.
const lan = process.env.FITAKTIV_LAN === '1'

export default defineConfig({
  plugins: [react(), tailwindcss(), ...(lan ? [basicSsl()] : [])],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  server: {
    host: lan ? '0.0.0.0' : '127.0.0.1',
    port: 5173,
    // The API is reached through the dev server, so the page and API share one origin (works over HTTPS too).
    proxy: {
      '/api': 'http://127.0.0.1:5000',
    },
  },
})
