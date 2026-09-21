import { createApp } from 'vue'
import { createPinia } from 'pinia'
import ElementPlus from 'element-plus'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import * as ElementPlusIconsVue from '@element-plus/icons-vue'
import 'element-plus/dist/index.css'
import 'element-plus/theme-chalk/dark/css-vars.css'
import App from './App.vue'
import router from './router'
import './styles/index.css'
import { registerServiceWorker } from './registerServiceWorker'

declare global {
  interface Window {
    errorAlert?: boolean
    isPWA: () => boolean
    isWebApp: () => boolean
    serviceWorkerReady?: boolean
  }
}

try {
  if (window.location.href.indexOf('errorAlert') > 0) {
    window.errorAlert = true
  }
  window.onerror = function(event, source, lineno, colno, error) {
    if (window.errorAlert) {
      window.alert(JSON.stringify({ event, source, lineno, colno, error }))
    }
  }
  window.addEventListener('unhandledrejection', e => {
    if (window.errorAlert) {
      window.alert(JSON.stringify(e))
    }
  })

  registerServiceWorker()
} catch (error: unknown) {
  alert((error as Error).stack || String(error))
}

const app = createApp(App)

for (const [key, component] of Object.entries(ElementPlusIconsVue)) {
  app.component(key, component)
}

app.use(createPinia())
app.use(router)
app.use(ElementPlus, { locale: zhCn })
app.config.errorHandler = (err, instance, info) => {
  if (window.errorAlert) {
    window.alert(JSON.stringify({ err, info, component: instance?.$options?.name || 'unknown' }))
  }
}
app.mount('#app')

window.isPWA = () => {
  return ['fullscreen', 'standalone', 'minimal-ui'].some(
    displayMode => window.matchMedia('(display-mode: ' + displayMode + ')').matches
  )
}
window.isWebApp = () => {
  const nav = window.navigator as any
  return nav.standalone === true
}
window.serviceWorkerReady = false
