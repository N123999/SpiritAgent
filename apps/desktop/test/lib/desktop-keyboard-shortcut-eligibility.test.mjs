import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  resolveModPShortcutAction,
  shouldTriggerConversationAbortShortcut,
} from '../../src/lib/desktop-keyboard-shortcut-eligibility.ts';

const conversationContext = {
  activeSurface: 'conversation',
  conversationAbortShortcutEligible: true,
};

test('resolveModPShortcutAction returns file-picker for Mod+P', () => {
  assert.equal(
    resolveModPShortcutAction({
      defaultPrevented: false,
      key: 'p',
      shiftKey: false,
      modPressed: true,
    }),
    'file-picker',
  );
});

test('resolveModPShortcutAction returns action-picker for Mod+Shift+P', () => {
  assert.equal(
    resolveModPShortcutAction({
      defaultPrevented: false,
      key: 'P',
      shiftKey: true,
      modPressed: true,
    }),
    'action-picker',
  );
});

test('resolveModPShortcutAction returns null when mod is not pressed', () => {
  assert.equal(
    resolveModPShortcutAction({
      defaultPrevented: false,
      key: 'p',
      shiftKey: false,
      modPressed: false,
    }),
    null,
  );
});

test('shouldTriggerConversationAbortShortcut accepts physical Ctrl+C on conversation surface', () => {
  assert.equal(
    shouldTriggerConversationAbortShortcut(
      {
        defaultPrevented: false,
        ctrlKey: true,
        metaKey: false,
        altKey: false,
        shiftKey: false,
        code: 'KeyC',
        key: 'c',
        target: { tagName: 'DIV', closest: () => null },
      },
      conversationContext,
    ),
    true,
  );
});

test('shouldTriggerConversationAbortShortcut rejects when not on conversation surface', () => {
  assert.equal(
    shouldTriggerConversationAbortShortcut(
      {
        defaultPrevented: false,
        ctrlKey: true,
        metaKey: false,
        altKey: false,
        shiftKey: false,
        code: 'KeyC',
        key: 'c',
        target: null,
      },
      { ...conversationContext, activeSurface: 'settings' },
    ),
    false,
  );
});

test('shouldTriggerConversationAbortShortcut rejects Cmd+C (meta without ctrl-only path)', () => {
  assert.equal(
    shouldTriggerConversationAbortShortcut(
      {
        defaultPrevented: false,
        ctrlKey: false,
        metaKey: true,
        altKey: false,
        shiftKey: false,
        code: 'KeyC',
        key: 'c',
        target: null,
      },
      conversationContext,
    ),
    false,
  );
});

test('shouldTriggerConversationAbortShortcut rejects textarea targets', () => {
  assert.equal(
    shouldTriggerConversationAbortShortcut(
      {
        defaultPrevented: false,
        ctrlKey: true,
        metaKey: false,
        altKey: false,
        shiftKey: false,
        code: 'KeyC',
        key: 'c',
        target: { tagName: 'TEXTAREA', closest: () => null },
      },
      conversationContext,
    ),
    false,
  );
});

test('shouldTriggerConversationAbortShortcut rejects xterm targets', () => {
  assert.equal(
    shouldTriggerConversationAbortShortcut(
      {
        defaultPrevented: false,
        ctrlKey: true,
        metaKey: false,
        altKey: false,
        shiftKey: false,
        code: 'KeyC',
        key: 'c',
        target: {
          tagName: 'DIV',
          closest: (selector) => (selector.includes('xterm') ? {} : null),
        },
      },
      conversationContext,
    ),
    false,
  );
});
