export {}

declare global {
  interface Window {
    errorAlert?: boolean
    isPWA: () => boolean
    isWebApp: () => boolean
    serviceWorkerReady?: boolean
    setTheme: (isNight: boolean) => void
    setMiniInterfaceClass: () => void
    setPageTypeClass: () => void
    autoSetTheme: (autoTheme: boolean) => void
  }
}
