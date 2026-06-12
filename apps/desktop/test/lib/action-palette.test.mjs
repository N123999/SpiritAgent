import assert from 'node:assert/strict'
import { test } from 'node:test'

import { buildActionPaletteItems } from '../../src/lib/action-palette.ts'
import { STATIC_SLASH_COMMANDS } from '../../src/lib/skill-slash.ts'

const EN_LABELS = {
  'sidebar.newSession': 'New Session',
  'slash.createSkill': 'Create or refine a SKILL.md with natural language',
  'slash.logSession': 'Export llm_history and API trace',
  'slash.compact': 'Compact the current session context',
  'slash.loop': 'Run autonomously until finish_task',
  'slash.plan': 'Plan without editing code',
  'slash.ask': 'Read-only help',
  'slash.fork': 'Fork the session at the latest assistant message into a new chat',
}

const ZH_LABELS = {
  'sidebar.newSession': '新会话',
}

function tEn(key) {
  return EN_LABELS[key] ?? key
}

function tZh(key) {
  return ZH_LABELS[key] ?? key
}

test('buildActionPaletteItems returns new session plus static slash commands', () => {
  const items = buildActionPaletteItems('', tEn)
  assert.equal(items[0]?.kind, 'new-session')
  assert.equal(items.length, 1 + STATIC_SLASH_COMMANDS.length)
  assert.equal(items.some((item) => item.kind === 'skill'), false)
  assert.equal(items.some((item) => 'alias' in item && item.alias === '/start-implementing'), false)
})

test('buildActionPaletteItems filters compact by prefix', () => {
  const items = buildActionPaletteItems('comp', tEn)
  assert.ok(items.some((item) => item.kind === 'compact'))
  assert.equal(items.some((item) => item.kind === 'loop'), false)
})

test('buildActionPaletteItems matches localized new session label', () => {
  const items = buildActionPaletteItems('新会话', tZh)
  assert.ok(items.some((item) => item.kind === 'new-session'))
})

test('buildActionPaletteItems matches slash description text', () => {
  const items = buildActionPaletteItems('plan without', tEn)
  assert.ok(items.some((item) => item.kind === 'plan'))
})
