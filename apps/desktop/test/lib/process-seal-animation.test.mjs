import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildProcessSealAnimationPlan,
  createInitialProcessSealPlanState,
  isLiveComposeViewKey,
  resolveProcessSealLiveTurnActive,
} from '../../src/lib/process-seal-animation.ts';

const VIEW_A = '/tmp/a.json:main';
const VIEW_B = '/tmp/b.json:main';
const COMPOSE_VIEW = '__no-session__:main';

function planForNewGroup(state, viewKey, groupId, options) {
  const result = buildProcessSealAnimationPlan(state, viewKey, [groupId], options);
  return result.shouldPlayByGroupId.get(groupId) ?? false;
}

test('isLiveComposeViewKey detects compose view keys', () => {
  assert.equal(isLiveComposeViewKey('__no-session__:main'), true);
  assert.equal(isLiveComposeViewKey('todo-scope:abc:main'), true);
  assert.equal(isLiveComposeViewKey('/tmp/chat.json:main'), false);
});

test('resolveProcessSealLiveTurnActive is false during session navigation busy state', () => {
  assert.equal(
    resolveProcessSealLiveTurnActive({
      subagentViewActive: false,
      compactionDemoActive: false,
      isBusy: false,
      busyAction: 'session',
      messages: [],
    }),
    false,
  );
});

test('resolveProcessSealLiveTurnActive is true while send is in flight', () => {
  assert.equal(
    resolveProcessSealLiveTurnActive({
      subagentViewActive: false,
      compactionDemoActive: false,
      isBusy: false,
      busyAction: 'send',
      messages: [],
    }),
    true,
  );
});

test('resolveProcessSealLiveTurnActive is true while pending aux is live', () => {
  assert.equal(
    resolveProcessSealLiveTurnActive({
      subagentViewActive: false,
      compactionDemoActive: false,
      isBusy: false,
      busyAction: null,
      pendingAuxState: { kind: 'thinking' },
      messages: [],
    }),
    true,
  );
});

test('buildProcessSealAnimationPlan skips animation on first hydrate', () => {
  const state = createInitialProcessSealPlanState();
  assert.equal(
    planForNewGroup(state, VIEW_A, 'main:process:1', {
      liveTurnActive: false,
      composeTurnInFlight: false,
      sessionNavigationPending: false,
    }),
    false,
  );
});

test('buildProcessSealAnimationPlan animates new group in the same view', () => {
  let state = createInitialProcessSealPlanState();
  ({ nextState: state } = buildProcessSealAnimationPlan(state, VIEW_A, ['main:process:1'], {
    liveTurnActive: false,
    composeTurnInFlight: false,
    sessionNavigationPending: false,
  }));

  assert.equal(
    planForNewGroup(state, VIEW_A, 'main:process:2', {
      liveTurnActive: false,
      composeTurnInFlight: false,
      sessionNavigationPending: false,
    }),
    true,
  );
});

test('buildProcessSealAnimationPlan skips animation when navigating to a saved session', () => {
  let state = createInitialProcessSealPlanState();
  ({ nextState: state } = buildProcessSealAnimationPlan(state, COMPOSE_VIEW, ['main:process:1'], {
    liveTurnActive: false,
    composeTurnInFlight: false,
    sessionNavigationPending: false,
  }));

  assert.equal(
    planForNewGroup(state, VIEW_A, 'main:process:1', {
      liveTurnActive: false,
      composeTurnInFlight: false,
      sessionNavigationPending: true,
    }),
    false,
  );
});

test('buildProcessSealAnimationPlan animates when compose navigation lands with an active turn', () => {
  let state = createInitialProcessSealPlanState();
  ({ nextState: state } = buildProcessSealAnimationPlan(state, COMPOSE_VIEW, [], {
    liveTurnActive: false,
    composeTurnInFlight: false,
    sessionNavigationPending: false,
  }));

  assert.equal(
    planForNewGroup(state, VIEW_A, 'main:process:1', {
      liveTurnActive: true,
      composeTurnInFlight: false,
      sessionNavigationPending: false,
    }),
    true,
  );
});

test('buildProcessSealAnimationPlan animates when compose send is still in flight', () => {
  let state = createInitialProcessSealPlanState();
  ({ nextState: state } = buildProcessSealAnimationPlan(state, COMPOSE_VIEW, [], {
    liveTurnActive: false,
    composeTurnInFlight: false,
    sessionNavigationPending: false,
  }));

  assert.equal(
    planForNewGroup(state, VIEW_A, 'main:process:1', {
      liveTurnActive: false,
      composeTurnInFlight: true,
      sessionNavigationPending: false,
    }),
    true,
  );
});

test('buildProcessSealAnimationPlan skips animation when switching between saved sessions', () => {
  let state = createInitialProcessSealPlanState();
  ({ nextState: state } = buildProcessSealAnimationPlan(state, VIEW_A, ['main:process:1'], {
    liveTurnActive: false,
    composeTurnInFlight: false,
    sessionNavigationPending: false,
  }));

  assert.equal(
    planForNewGroup(state, VIEW_B, 'main:process:1', {
      liveTurnActive: false,
      composeTurnInFlight: false,
      sessionNavigationPending: false,
    }),
    false,
  );
});
