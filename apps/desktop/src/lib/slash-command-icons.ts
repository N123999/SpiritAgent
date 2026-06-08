import type { LucideIcon } from 'lucide-react'
import {
  BookText,
  CircleHelp,
  ClipboardList,
  FoldVertical,
  Repeat,
  ScrollText,
  Sparkles,
  Wand2,
} from 'lucide-react'

import type { SkillSlashSuggestionKind } from '@/lib/skill-slash'

export const SLASH_SUGGESTION_ICONS: Record<SkillSlashSuggestionKind, LucideIcon> = {
  'create-rule': BookText,
  'create-skill': Wand2,
  'log-session': ScrollText,
  compact: FoldVertical,
  loop: Repeat,
  plan: ClipboardList,
  ask: CircleHelp,
  skill: Sparkles,
}
