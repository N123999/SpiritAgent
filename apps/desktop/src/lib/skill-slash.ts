import type { DesktopSkillListItem } from '@/types'

export type SkillSlashSuggestionKind =
  | 'log-session'
  | 'compact'
  | 'loop'
  | 'plan'
  | 'ask'
  | 'skill'

export interface SkillSlashSuggestion {
  id: string
  alias: string
  name: string
  description?: string
  descriptionKey?: string
  kind: SkillSlashSuggestionKind
}

export interface SkillSlashMatch {
  skillName: string
  extraNote: string
}

export function skillSlashAlias(skillName: string): string {
  return `/${skillName}`
}

export const LOG_SESSION_SLASH_ALIAS = '/log-session'
export const COMPACT_SLASH_ALIAS = '/compact'
export const LOOP_SLASH_ALIAS = '/loop'
export const PLAN_SLASH_ALIAS = '/plan'
export const ASK_SLASH_ALIAS = '/ask'

export const STATIC_SLASH_COMMANDS: readonly SkillSlashSuggestion[] = [
  {
    id: 'command:log-session',
    alias: LOG_SESSION_SLASH_ALIAS,
    name: 'log-session',
    descriptionKey: 'slash.logSession',
    kind: 'log-session',
  },
  {
    id: 'command:compact',
    alias: COMPACT_SLASH_ALIAS,
    name: 'compact',
    descriptionKey: 'slash.compact',
    kind: 'compact',
  },
  {
    id: 'command:loop',
    alias: LOOP_SLASH_ALIAS,
    name: 'loop',
    descriptionKey: 'slash.loop',
    kind: 'loop',
  },
  {
    id: 'command:plan',
    alias: PLAN_SLASH_ALIAS,
    name: 'plan',
    descriptionKey: 'slash.plan',
    kind: 'plan',
  },
  {
    id: 'command:ask',
    alias: ASK_SLASH_ALIAS,
    name: 'ask',
    descriptionKey: 'slash.ask',
    kind: 'ask',
  },
] as const

export function currentSkillSlashQuery(input: string | undefined): string | undefined {
  if (!input || !input.startsWith('/') || input.includes('\n')) {
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
  skills: readonly DesktopSkillListItem[] = [],
): SkillSlashSuggestion[] {
  if (!query) {
    return []
  }

  return [
    ...STATIC_SLASH_COMMANDS.filter((suggestion) => suggestion.alias.startsWith(query)),
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

export function isLogSessionSlashInput(input: string): boolean {
  return input.trim() === LOG_SESSION_SLASH_ALIAS
}

export function isCompactSlashInput(input: string): boolean {
  return input.trim() === COMPACT_SLASH_ALIAS
}

export function isLoopSlashInput(input: string): boolean {
  const trimmed = input.trim()
  return trimmed === LOOP_SLASH_ALIAS || trimmed.startsWith(`${LOOP_SLASH_ALIAS} `)
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
