import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, './src') },
  },
  server: {
    port: 5173,
    proxy: {
      // Backend location. VITE_API_HOST/PORT override it (compose sets the host
      // to the `backend` service name).
      '/api': {
        target: `http://${process.env.VITE_API_HOST ?? 'localhost'}:${process.env.VITE_API_PORT ?? 8000}`,
        changeOrigin: true,
      },
    },
  },
  // `vite preview` serves the prebuilt bundle and uses far less memory than the
  // dev server (no HMR, no on-demand transpile). It needs its own proxy block —
  // `server.proxy` does not apply to preview.
  preview: {
    port: 5173,
    proxy: {
      '/api': {
        target: `http://${process.env.VITE_API_HOST ?? 'localhost'}:${process.env.VITE_API_PORT ?? 8000}`,
        changeOrigin: true,
      },
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/three') || id.includes('node_modules/@react-three')) return 'three'
          if (id.includes('node_modules/recharts')) return 'charts'
          if (id.includes('node_modules/framer-motion')) return 'motion'
        },
      },
    },
  },
})
