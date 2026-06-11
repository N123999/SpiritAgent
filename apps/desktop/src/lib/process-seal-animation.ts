import { useLayoutEffect, useRef } from 'react';

import type { ConversationRenderItem } from '@/lib/conversation-process-groups';
import type { ConversationMessageSnapshot, PendingAssistantAux } from '@/types';

function processGroupIds(renderItems: readonly ConversationRenderItem[]): string[] {
  return renderItems
    .filter((item) => item.kind === 'process-group')
    .map((item) => item.groupId);
}

export function isLiveComposeViewKey(viewKey: string): boolean {
  return viewKey.startsWith('__no-session__') || viewKey.startsWith('todo-scope:');
}

export function resolveProcessSealLiveTurnActive(options: {
  subagentViewActive: boolean;
  compactionDemoActive: boolean;
  isBusy?: boolean;
  busyAction?: string | null;
  pendingAuxState?: PendingAssistantAux | null;
  messages: readonly ConversationMessageSnapshot[];
}): boolean {
  if (options.subagentViewActive || options.compactionDemoActive) {
    return false;
  }
  if (options.busyAction === 'session') {
    return false;
  }
  if (options.busyAction === 'send' || options.isBusy === true) {
    return true;
  }
  if (options.pendingAuxState) {
    return true;
  }
  return options.messages.some((message) => message.pending);
}

export type ProcessSealPlanState = {
  prevViewKey: string | null;
  prevGroupIds: Set<string>;
};

export type ProcessSealAnimationPlanOptions = {
  liveTurnActive: boolean;
  composeTurnInFlight: boolean;
  sessionNavigationPending: boolean;
};

export type ProcessSealAnimationPlanResult = {
  nextState: ProcessSealPlanState;
  shouldPlayByGroupId: Map<string, boolean>;
};

export function createInitialProcessSealPlanState(): ProcessSealPlanState {
  return { prevViewKey: null, prevGroupIds: new Set() };
}

export function buildProcessSealAnimationPlan(
  state: ProcessSealPlanState,
  conversationViewKey: string,
  groupIds: readonly string[],
  options: ProcessSealAnimationPlanOptions,
): ProcessSealAnimationPlanResult {
  const isFirstObservation = state.prevViewKey === null;
  const viewKeyChanged =
    !isFirstObservation && state.prevViewKey !== conversationViewKey;
  const newlyAppearedGroupIds = groupIds.filter((groupId) => !state.prevGroupIds.has(groupId));

  const shouldAnimateNewGroups = isFirstObservation
    ? false
    : viewKeyChanged
      ? !options.sessionNavigationPending &&
        (options.liveTurnActive || options.composeTurnInFlight)
      : true;

  return {
    nextState: {
      prevViewKey: conversationViewKey,
      prevGroupIds: new Set(groupIds),
    },
    shouldPlayByGroupId: new Map(
      newlyAppearedGroupIds.map((groupId) => [groupId, shouldAnimateNewGroups]),
    ),
  };
}

function useProcessSealAnimationPlan(
  conversationViewKey: string,
  renderItems: readonly ConversationRenderItem[],
  options: ProcessSealAnimationPlanOptions,
): (groupId: string) => boolean {
  const planStateRef = useRef(createInitialProcessSealPlanState());
  const planRef = useRef(new Map<string, boolean>());

  const groupIds = processGroupIds(renderItems);
  const groupIdsKey = groupIds.join('|');

  const { shouldPlayByGroupId, nextState } = buildProcessSealAnimationPlan(
    planStateRef.current,
    conversationViewKey,
    groupIds,
    options,
  );
  planRef.current = shouldPlayByGroupId;

  useLayoutEffect(() => {
    planStateRef.current = nextState;
  }, [conversationViewKey, groupIdsKey]);

  return (groupId: string) => planRef.current.get(groupId) ?? false;
}

/** Returns whether a newly mounted process group should play the seal collapse animation. */
export function useProcessSealAnimationGate(input: {
  conversationViewKey: string;
  renderItems: readonly ConversationRenderItem[];
  subagentViewActive: boolean;
  compactionDemoActive: boolean;
  isBusy?: boolean;
  busyAction?: string | null;
  pendingAuxState?: PendingAssistantAux;
  sessionMessages: readonly ConversationMessageSnapshot[];
}): (groupId: string) => boolean {
  const composeTurnInFlightRef = useRef(false);
  const sessionNavigationPendingRef = useRef(false);

  if (input.busyAction === 'session') {
    sessionNavigationPendingRef.current = true;
    composeTurnInFlightRef.current = false;
  } else if (
    isLiveComposeViewKey(input.conversationViewKey) &&
    (input.busyAction === 'send' ||
      input.isBusy === true ||
      input.sessionMessages.some((message) => message.pending))
  ) {
    composeTurnInFlightRef.current = true;
  }

  const liveTurnActive = resolveProcessSealLiveTurnActive({
    subagentViewActive: input.subagentViewActive,
    compactionDemoActive: input.compactionDemoActive,
    isBusy: input.isBusy,
    busyAction: input.busyAction,
    pendingAuxState: input.pendingAuxState,
    messages: input.sessionMessages,
  });

  const shouldPlaySealAnimation = useProcessSealAnimationPlan(
    input.conversationViewKey,
    input.renderItems,
    {
      liveTurnActive,
      composeTurnInFlight: composeTurnInFlightRef.current,
      sessionNavigationPending: sessionNavigationPendingRef.current,
    },
  );

  useLayoutEffect(() => {
    sessionNavigationPendingRef.current = false;
    if (!isLiveComposeViewKey(input.conversationViewKey)) {
      composeTurnInFlightRef.current = false;
    }
  }, [input.conversationViewKey, input.renderItems]);

  return shouldPlaySealAnimation;
}
