// 翻页动画系统 - 移植自 reader-fr 的 animate.js
if (!window.requestAnimationFrame) {
  window.requestAnimationFrame = function(callback: FrameRequestCallback) {
    return setTimeout(callback, 1000 / 60)
  }
}

export interface AnimateOptions {
  duration: number
  timing: (timeFraction: number) => number
  draw: (progress: number) => void
  onEnd?: () => void
}

// 动画执行函数
export function animate(options: AnimateOptions) {
  const start = Date.now()

  function _animate() {
    let timeFraction = (Date.now() - start) / options.duration
    if (timeFraction > 1) timeFraction = 1

    const progress = options.timing(timeFraction)
    options.draw(progress)

    if (timeFraction < 1) {
      window.requestAnimationFrame(_animate)
    } else {
      options.onEnd?.()
    }
  }

  window.requestAnimationFrame(_animate)
}

// 时序函数
export const Timings = {
  // 线性函数
  linear: (timeFraction: number): number => timeFraction,

  // 圆弧函数
  circle: (timeFraction: number): number => 1 - Math.sin(Math.acos(timeFraction)),

  // 圆弧函数（另一种实现）
  circle2: (timeFraction: number): number => 1 - Math.sqrt(1 - timeFraction ** 2),

  // 反-弹跳函数
  bounce: (timeFraction: number): number => {
    for (let a = 0, b = 1;; a += b, b /= 2) {
      if (timeFraction >= (7 - 4 * a) / 11) {
        return -Math.pow((11 - 6 * a - 11 * timeFraction) / 4, 2) + Math.pow(b, 2)
      }
    }
  },

  // 幂函数
  power: (x: number) => (timeFraction: number): number => Math.pow(timeFraction, x),

  // 反弹函数
  back: (x: number) => (timeFraction: number): number =>
    Math.pow(timeFraction, 2) * ((x + 1) * timeFraction - x),

  // 伸缩函数
  elastic: (x: number) => (timeFraction: number): number =>
    Math.pow(2, 10 * (timeFraction - 1)) * Math.cos((20 * Math.PI * x / 3) * timeFraction),
}

// 工具函数
export const Utils = {
  // 返回时序函数的反函数
  makeEaseOut: (timing: (t: number) => number) => (timeFraction: number): number =>
    1 - timing(1 - timeFraction),

  // 返回时序函数的 easeInOut 变体
  makeEaseInOut: (timing: (t: number) => number) => (timeFraction: number): number =>
    timeFraction < 0.5 ? timing(2 * timeFraction) / 2 : 1 - timing(2 * (1 - timeFraction)) / 2,
}

// 预设动画配置
export const Presets = {
  // 翻页动画
  pageFlip: (duration = 300) => ({
    duration,
    timing: Timings.power(2),
    draw: () => {},
  }),

  // 滑动动画
  slide: (duration = 200) => ({
    duration,
    timing: Timings.circle,
    draw: () => {},
  }),

  // 淡入淡出
  fade: (duration = 150) => ({
    duration,
    timing: Timings.linear,
    draw: () => {},
  }),

  // 缩放动画
  zoom: (duration = 250) => ({
    duration,
    timing: Timings.back(1.5),
    draw: () => {},
  }),
}

// 翻页方向枚举
export enum FlipDirection {
  NEXT = 'next',
  PREV = 'prev',
}

// 翻页动画管理器
export class PageFlipAnimator {
  private element: HTMLElement
  private isAnimating = false
  private currentDirection: FlipDirection = FlipDirection.NEXT

  constructor(element: HTMLElement) {
    this.element = element
  }

  flip(direction: FlipDirection, duration = 300): Promise<void> {
    if (this.isAnimating) return Promise.resolve()
    
    this.isAnimating = true
    this.currentDirection = direction

    return new Promise(resolve => {
      const start = Date.now()
      const perspective = this.element.offsetWidth * 2

      this.element.style.perspective = `${perspective}px`
      this.element.style.transformStyle = 'preserve-3d'

      const animate = () => {
        const timeFraction = Math.min((Date.now() - start) / duration, 1)
        const progress = Timings.power(2)(timeFraction)
        
        const rotateY = direction === FlipDirection.NEXT ? -progress * 90 : progress * 90
        
        this.element.style.transform = `rotateY(${rotateY}deg)`

        if (timeFraction < 1) {
          window.requestAnimationFrame(animate)
        } else {
          this.element.style.transform = ''
          this.element.style.perspective = ''
          this.element.style.transformStyle = ''
          this.isAnimating = false
          resolve()
        }
      }

      window.requestAnimationFrame(animate)
    })
  }

  cancel() {
    this.isAnimating = false
    this.element.style.transform = ''
    this.element.style.perspective = ''
    this.element.style.transformStyle = ''
  }
}

// 导出单例创建函数
export function createPageFlipAnimator(element: HTMLElement) {
  return new PageFlipAnimator(element)
}