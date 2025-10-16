import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueJsx from '@vitejs/plugin-vue-jsx'

// https://vite.dev/config/
export default defineConfig(async () => {
  let pwaPlugin: any = null
  try {
    const mod = await import('vite-plugin-pwa')
    const VitePWA = (mod as any).VitePWA
    pwaPlugin = VitePWA({
      registerType: 'autoUpdate',
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'service-worker.ts',
      injectRegister: 'auto',
      manifest: false,
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,webp}'],
      },
      devOptions: {
        enabled: true,
        type: 'module',
      },
    })
  } catch (e) {
    console.warn('[vite] vite-plugin-pwa not found; PWA disabled')
  }

  return {
    plugins: [
      vue(),
      vueJsx(),
      ...(pwaPlugin ? [pwaPlugin] : []),
    ],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
  }
})
