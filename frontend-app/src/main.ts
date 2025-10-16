import { createApp } from 'vue'
import { Capacitor } from '@capacitor/core'
import { App as CapacitorApp } from '@capacitor/app'
import App from './App.vue'
import router from './router'
import { useFloatingPanel } from '@/composables/useFloatingPanel'

const app = createApp(App)

app.use(router)

app.mount('#app')

const panelStore = useFloatingPanel()

function navigateWithSharedText(text: string | null) {
  if (text) {
    panelStore.setSharedText(text)
    void router.push({ path: '/share-capture', query: { text: encodeURIComponent(text) } })
  } else {
    void router.push('/share-capture')
  }
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/service-worker.js')
      .catch((error) => console.warn('Service worker registration failed', error))
  })

  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data?.type === 'SHARE_TARGET') {
      navigateWithSharedText(event.data.text ?? null)
    }
  })
}

if (Capacitor.isNativePlatform()) {
  CapacitorApp.addListener('appUrlOpen', (event) => {
    if (event.url?.includes('/share-capture')) {
      const url = new URL(event.url)
      const text = url.searchParams.get('text')
      navigateWithSharedText(text)
    }
  })
}
