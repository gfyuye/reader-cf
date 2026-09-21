import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'

dayjs.extend(relativeTime)

export function formatDateTime(ts?: number): string {
  if (!ts) return ''
  return dayjs(ts).format('YYYY-MM-DD HH:mm:ss')
}

export function formatDate(ts?: number): string {
  if (!ts) return ''
  return dayjs(ts).format('YYYY-MM-DD')
}

export function formatRelativeTime(ts?: number): string {
  if (!ts) return ''
  return dayjs(ts).fromNow()
}

export function truncate(str: string, maxLen = 100): string {
  if (!str || str.length <= maxLen) return str
  return str.substring(0, maxLen) + '...'
}
