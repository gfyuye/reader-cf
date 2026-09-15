import axios from 'axios'
import type { AxiosRequestConfig, AxiosResponse } from 'axios'
import type { ApiResult } from './types'

const http = axios.create({
  baseURL: '/reader3',
  timeout: 30000,
  headers: { 'Content-Type': 'application/json' },
})

http.interceptors.request.use((config) => {
  const token = localStorage.getItem('accessToken')
  if (token) {
    const username = localStorage.getItem('username') || ''
    config.params = { ...config.params, accessToken: username ? `${username}:${token}` : token }
  }
  return config
})

// 关键：用泛型 + 类型断言，让拦截器返回业务数据
http.interceptors.response.use(
  (response: AxiosResponse<ApiResult>): any => {
    const data = response.data
    if (data && data.isSuccess === false) {
      console.error('[API]', data.errorMsg)
    }
    return data
  },
  (error) => {
    console.error('[HTTP]', error)
    return Promise.reject(error)
  }
)

// 重新声明 get/post 的返回类型为 Promise<ApiResult<T>>
export function get<T = any>(
  url: string,
  params?: Record<string, any>,
  extraConfig?: AxiosRequestConfig
): Promise<ApiResult<T>> {
  return http.get(url, { params, ...extraConfig }) as unknown as Promise<ApiResult<T>>
}

export function post<T = any>(
  url: string,
  data?: any,
  extraConfig?: AxiosRequestConfig
): Promise<ApiResult<T>> {
  return http.post(url, data, extraConfig) as unknown as Promise<ApiResult<T>>
}

export { http }