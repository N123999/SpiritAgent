import type { DesktopSkillListItem } from '@/types'

export interface SkillSlashSuggestion {
  id: string
  alias: string
  name: string
  description: string
}

export interface SkillSlashMatch {
  skillName: string
  extraNote: string
}

export function skillSlashAlias(skillName: string): string {
  return `/${skillName}`
}

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

  return skills
    .filter((skill) => skill.enabled)
    .filter((skill) => skillSlashAlias(skill.name).startsWith(query))
    .map((skill) => ({
      id: skill.id,
      alias: skillSlashAlias(skill.name),
      name: skill.name,
      description: skill.description,
    }))
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