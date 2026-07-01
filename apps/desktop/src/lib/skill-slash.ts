import {
  charCountToCodeUnitIndex,
  codeUnitIndexToCharCount,
} from '@spirit-agent/host-internal/workspace-file-reference-query'

import type { RichSegment } from '@/lib/composer-segment-model'
import { isComposerPlainEmpty } from '@/lib/composer-segment-model'
import { skillContextText } from '@/lib/skill-wire-text'
import type { DesktopSkillListItem } from '@/types'

const COMPACT_COMPOSER_STRUCTURAL_KINDS = new Set(['loop', 'plan', 'ask', 'debug'])

export type SkillSlashSuggestionKind =
  | 'log-session'
  | 'compact'
  | 'fork'
  | 'loop'
  | 'plan'
  | 'ask'
  | 'debug'
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
export const FORK_SLASH_ALIAS = '/fork'
export const LOOP_SLASH_ALIAS = '/loop'
export const PLAN_SLASH_ALIAS = '/plan'
export const ASK_SLASH_ALIAS = '/ask'
export const DEBUG_SLASH_ALIAS = '/debug'

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
    id: 'command:fork',
    alias: FORK_SLASH_ALIAS,
    name: 'fork',
    descriptionKey: 'slash.fork',
    kind: 'fork',
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
  {
    id: 'command:debug',
    alias: DEBUG_SLASH_ALIAS,
    name: 'debug',
    descriptionKey: 'slash.debug',
    kind: 'debug',
  },
] as const

export interface ActiveSkillSlashQuery {
  start: number
  end: number
  raw: string
}

export function skillSlashQueryKey(query: ActiveSkillSlashQuery): string {
  return `${query.start}\u0000${query.end}\u0000${query.raw}`
}

function previousCodePointIndex(input: string, fromIndex: number): number {
  const previousIndex = fromIndex - 1
  if (previousIndex <= 0) {
    return 0
  }

  const codeUnit = input.charCodeAt(previousIndex)
  if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
    return previousIndex - 1
  }
  return previousIndex
}

function tokenStart(input: string, cursor: number): number {
  for (let index = cursor; index > 0; ) {
    const previousIndex = previousCodePointIndex(input, index)
    const codePoint = input.codePointAt(previousIndex)
    if (codePoint === undefined) {
      break
    }

    const char = String.fromCodePoint(codePoint)
    if (/\s/u.test(char)) {
      return index
    }
    index = previousIndex
  }

  return 0
}

function tokenEnd(input: string, cursor: number): number {
  for (let index = cursor; index < input.length; ) {
    const codePoint = input.codePointAt(index)
    if (codePoint === undefined) {
      break
    }

    const char = String.fromCodePoint(codePoint)
    if (/\s/u.test(char)) {
      return index
    }
    index += codePoint > 0xffff ? 2 : 1
  }

  return input.length
}

export function currentSkillSlashQueryAtCursor(
  input: string,
  cursorChars: number,
): ActiveSkillSlashQuery | undefined {
  if (!input || input.includes('\n')) {
    return undefined
  }

  const cursor = charCountToCodeUnitIndex(input, cursorChars)
  const start = tokenStart(input, cursor)
  const end = tokenEnd(input, cursor)
  if (start >= end) {
    return undefined
  }

  const token = input.slice(start, end)
  if (!token.startsWith('/') || /\s/u.test(token.slice(1))) {
    return undefined
  }

  return {
    start: codeUnitIndexToCharCount(input, start),
    end: codeUnitIndexToCharCount(input, end),
    raw: token,
  }
}

/** Whole-composer slash query when the caret is at the end of trimmed input. */
export function currentSkillSlashQuery(input: string | undefined): string | undefined {
  if (!input) {
    return undefined
  }

  const trimmedRight = input.trimEnd()
  if (!trimmedRight) {
    return undefined
  }

  return currentSkillSlashQueryAtCursor(input, Array.from(trimmedRight).length)?.raw
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

/** Composer holds only a `/compact` skill chip (no extra text or attachments). */
export function isCompactSlashComposerSegments(segs: readonly RichSegment[]): boolean {
  let compactSkill = false
  let hasOtherContent = false

  for (const seg of segs) {
    if (COMPACT_COMPOSER_STRUCTURAL_KINDS.has(seg.kind)) {
      continue
    }
    if (seg.kind === 'skill') {
      if (seg.alias === COMPACT_SLASH_ALIAS) {
        compactSkill = true
      } else {
        hasOtherContent = true
      }
      continue
    }
    if (seg.kind === 'text') {
      if (!isComposerPlainEmpty(seg.value)) {
        hasOtherContent = true
      }
      continue
    }
    hasOtherContent = true
  }

  return compactSkill && !hasOtherContent
}

export function isCompactSlashComposerRequest(
  text: string,
  skillChipAliases: readonly string[] = [],
): boolean {
  if (isCompactSlashInput(text)) {
    return true
  }
  return (
    skillChipAliases.length === 1
    && skillChipAliases[0] === COMPACT_SLASH_ALIAS
    && text.trim() === skillContextText(COMPACT_SLASH_ALIAS).trim()
  )
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
