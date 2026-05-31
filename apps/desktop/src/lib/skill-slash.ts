import type { DesktopSkillListItem } from '@/types'

export type SkillSlashSuggestionKind =
  | 'create-skill'
  | 'log-session'
  | 'start-implementing'
  | 'compact'
  | 'skill'

export interface SkillSlashSuggestion {
  id: string
  alias: string
  name: string
  description: string
  kind: SkillSlashSuggestionKind
}

export interface SkillSlashMatch {
  skillName: string
  extraNote: string
}

export function skillSlashAlias(skillName: string): string {
  return `/${skillName}`
}

export const CREATE_SKILL_SLASH_ALIAS = '/create-skill'
export const LOG_SESSION_SLASH_ALIAS = '/log-session'
export const START_IMPLEMENTING_SLASH_ALIAS = '/start-implementing'
export const COMPACT_SLASH_ALIAS = '/compact'

const STATIC_SLASH_SUGGESTIONS: readonly SkillSlashSuggestion[] = [
  {
    id: 'command:create-skill',
    alias: CREATE_SKILL_SLASH_ALIAS,
    name: 'create-skill',
    description: '用自然语言创建或收紧一个 SKILL.md',
    kind: 'create-skill',
  },
  {
    id: 'command:log-session',
    alias: LOG_SESSION_SLASH_ALIAS,
    name: 'log-session',
    description: '导出当前会话 llm_history 与完整 API 请求轨迹并自动打开',
    kind: 'log-session',
  },
  {
    id: 'command:start-implementing',
    alias: START_IMPLEMENTING_SLASH_ALIAS,
    name: 'start-implementing',
    description: '读取 Spirit 托管 plan.md 后直接开始实现',
    kind: 'start-implementing',
  },
  {
    id: 'command:compact',
    alias: COMPACT_SLASH_ALIAS,
    name: 'compact',
    description: '主动压缩当前会话上下文历史',
    kind: 'compact',
  },
] as const

export function currentSkillSlashQuery(input: string): string | undefined {
  if (!input.startsWith('/') || input.includes('\n')) {
    return undefined
  }

  const trimmedRight = input.trimEnd()
  if (!trimmedRight) {
    return undefined
  }

  if (/\s/u.test(trimmedRight.slice(1))) {
    return undefined
  }

  return trimmedRight
}

export function buildSkillSlashSuggestions(
  query: string | undefined,
  skills: readonly DesktopSkillListItem[],
): SkillSlashSuggestion[] {
  if (!query) {
    return []
  }

  return [
    ...STATIC_SLASH_SUGGESTIONS.filter((suggestion) => suggestion.alias.startsWith(query)),
    ...skills
      .filter((skill) => skill.enabled)
      .filter((skill) => skillSlashAlias(skill.name).startsWith(query))
      .map((skill) => ({
        id: skill.id,
        alias: skillSlashAlias(skill.name),
        name: skill.name,
        description: skill.description,
        kind: 'skill' as const,
      })),
  ]
}

export function isCreateSkillSlashInput(input: string): boolean {
  const trimmed = input.trim()
  if (!trimmed.startsWith(CREATE_SKILL_SLASH_ALIAS)) {
    return false
  }

  const remainder = trimmed.slice(CREATE_SKILL_SLASH_ALIAS.length)
  return remainder.length === 0 || /^\s/u.test(remainder)
}

export function isLogSessionSlashInput(input: string): boolean {
  return input.trim() === LOG_SESSION_SLASH_ALIAS
}

export function isStartImplementingSlashInput(input: string): boolean {
  return input.trim() === START_IMPLEMENTING_SLASH_ALIAS
}

export function isCompactSlashInput(input: string): boolean {
  return input.trim() === COMPACT_SLASH_ALIAS
}

export function matchSkillSlashInput(
  input: string,
  skills: readonly DesktopSkillListItem[],
): SkillSlashMatch | undefined {
  const trimmed = input.trim()
  if (!trimmed.startsWith('/')) {
    return undefined
  }

  const firstWhitespace = trimmed.search(/\s/u)
  const command = firstWhitespace === -1 ? trimmed : trimmed.slice(0, firstWhitespace)
  const extraNote = firstWhitespace === -1 ? '' : trimmed.slice(firstWhitespace).trim()
  const skill = skills.find(
    (item) => item.enabled && skillSlashAlias(item.name) === command,
  )

  if (!skill) {
    return undefined
  }

  return {
    skillName: skill.name,
    extraNote,
  }
}