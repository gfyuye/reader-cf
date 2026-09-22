import axios from 'axios'
import type { AxiosRequestConfig, AxiosResponse, InternalAxiosRequestConfig } from 'axios'
import type { ApiResult } from './types'

const API_BASE = import.meta.env.VITE_API_BASE || '/reader3'

const http = axios.create({
  baseURL: API_BASE,
  timeout: 30000,
  headers: { 'Content-Type': 'application/json' },
})

http.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = localStorage.getItem('accessToken')
  const username = localStorage.getItem('username') || ''
  if (token) {
    config.params = {
      ...config.params,
      accessToken: username ? `${username}:${token}` : token,
    }
  }
  const secureKey = localStorage.getItem('secureKey')
  if (secureKey) {
    config.params = {
      ...config.params,
      secureKey,
      userNS: localStorage.getItem('userNS') || 'default',
    }
  }
  return config
})

http.interceptors.response.use(
  (response: AxiosResponse<ApiResult>): any => {
    const data = response.data
    if (data && data.isSuccess === false) {
      if (data.data === 'NEED_LOGIN') {
        // Redirect to login will be handled by router guard
      }
      if (data.data === 'NEED_SECURE_KEY') {
        // Manager mode prompt will be handled by router guard
      }
      console.error('[API]', data.errorMsg)
    }
    return data
  },
  (error) => {
    console.error('[HTTP]', error)
    return Promise.reject(error)
  }
)

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

export function postRaw<T = any>(
  url: string,
  data?: any,
  extraConfig?: AxiosRequestConfig
): Promise<T> {
  return http.post(url, data, extraConfig) as unknown as Promise<T>
}

export { http }
