import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [
    react(),
    {
      // lists every built file so the service worker can keep the whole app for offline use (including pages loaded on demand)
      name: 'eden-asset-manifest',
      apply: 'build',
      generateBundle(_options, bundle) {
        const files = Object.keys(bundle).filter((f) => !f.endsWith('.map')).map((f) => '/' + f)
        this.emitFile({ type: 'asset', fileName: 'asset-manifest.json', source: JSON.stringify(files) })
      },
    },
  ],
  server: { port: 5173, proxy: { '/api': 'http://127.0.0.1:8787' } },
  build: { chunkSizeWarningLimit: 1500 },
  test: { environment: 'node' },
})
