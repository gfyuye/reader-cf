// 替换规则应用工具
import type { ReplaceRule } from '@/api/types'

export function applyReplaceRules(content: string, rules: ReplaceRule[]): string {
  if (!content || !rules?.length) return content
  
  let result = content
  
  for (const rule of rules) {
    if (!rule.isEnabled) continue
    if (!rule.pattern) continue
    
    try {
      if (rule.isRegex) {
        // 正则模式
        const flags = rule.scope ? 'g' : 'g'
        const regex = new RegExp(rule.pattern, flags)
        result = result.replace(regex, rule.replacement || '')
      } else {
        // 普通文本替换
        const regex = new RegExp(escapeRegExp(rule.pattern), 'g')
        result = result.replace(regex, rule.replacement || '')
      }
    } catch (e) {
      console.warn('替换规则执行失败:', rule, e)
    }
  }
  
  return result
}

function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// 作用域过滤：根据 scope 决定是否应用规则
export function filterRulesByScope(rules: ReplaceRule[], scope: string): ReplaceRule[] {
  if (!scope) return rules
  return rules.filter(rule => !rule.scope || rule.scope === scope || rule.scope === '')
}

// 批量应用不同作用域的规则
export function applyReplaceRulesByScope(
  content: string, 
  rules: ReplaceRule[], 
  scope: string
): string {
  const filtered = filterRulesByScope(rules, scope)
  return applyReplaceRules(content, filtered)
}