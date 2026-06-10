import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DESKTOP_MICA_BROWSER_TINT_CLASS,
  DESKTOP_MICA_CONTENT_TINT_CLASS,
  DESKTOP_MICA_TERMINAL_TINT_CLASS,
  DESKTOP_MICA_WORKSPACE_TAB_SELECTED_TINT_CLASS,
  desktopMicaBrowserTintClass,
  desktopMicaTerminalTintClass,
  desktopMicaTintClass,
  desktopMicaTintInnerClass,
  desktopMicaWorkspaceTabSelectedClass,
} from '../../src/lib/desktop-mica-surface.ts';

test('desktopMicaTintClass returns solid background when Mica is off', () => {
  assert.equal(desktopMicaTintClass(false), 'bg-background');
});

test('desktopMicaTintClass returns semi-transparent tint without backdrop-blur when Mica is on', () => {
  const cls = desktopMicaTintClass(true);
  assert.equal(cls, DESKTOP_MICA_CONTENT_TINT_CLASS);
  assert.match(cls, /bg-background\//);
  assert.doesNotMatch(cls, /backdrop-blur/);
});

test('desktopMicaTintInnerClass is transparent under Mica', () => {
  assert.equal(desktopMicaTintInnerClass(false), 'bg-background');
  assert.equal(desktopMicaTintInnerClass(true), 'bg-transparent');
});

test('desktopMicaBrowserTintClass uses higher opacity than main content tint', () => {
  assert.equal(desktopMicaBrowserTintClass(true), DESKTOP_MICA_BROWSER_TINT_CLASS);
  assert.notEqual(DESKTOP_MICA_BROWSER_TINT_CLASS, DESKTOP_MICA_CONTENT_TINT_CLASS);
});

test('desktopMicaTerminalTintClass keeps high opacity for readability', () => {
  assert.equal(desktopMicaTerminalTintClass(true), DESKTOP_MICA_TERMINAL_TINT_CLASS);
  assert.match(DESKTOP_MICA_TERMINAL_TINT_CLASS, /\/87$/);
});

test('desktopMicaWorkspaceTabSelectedClass uses light tint when Mica is on', () => {
  assert.equal(desktopMicaWorkspaceTabSelectedClass(false), 'bg-background');
  assert.equal(desktopMicaWorkspaceTabSelectedClass(true), DESKTOP_MICA_WORKSPACE_TAB_SELECTED_TINT_CLASS);
});
