import { Workbox } from 'workbox-window'

export function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    const wb = new Workbox('/sw.js')
    wb.register()
    wb.addEventListener('activated', (event: any) => {
      if (event.isUpdateAvailable) {
        // New service worker available
      }
    })
    window.serviceWorkerReady = true
  }
}
