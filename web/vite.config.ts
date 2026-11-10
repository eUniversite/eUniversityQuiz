import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const target = process.env.API_URL || 'http://localhost:3100'
export default defineConfig({
  plugins: [react()],
  // Le jeu 3D (public/jeu) est servi tel quel : on ne le fait pas analyser par Vite.
  optimizeDeps: { entries: ['index.html'] },
  server: { port: 5173, allowedHosts: ['.ngrok-free.dev', '.ngrok-free.app'], proxy: { '/api': target, '/socket.io': { target, ws: true } } },
})
