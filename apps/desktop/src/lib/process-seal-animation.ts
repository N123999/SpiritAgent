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

type ProcessSealAnimationPlanOptions = {
  liveTurnActive: boolean;
  composeTurnInFlight: boolean;
  sessionNavigationPending: boolean;
};

function useProcessSealAnimationPlan(
  conversationViewKey: string,
  renderItems: readonly ConversationRenderItem[],
  options: ProcessSealAnimationPlanOptions,
): (groupId: string) => boolean {
  const prevViewKeyRef = useRef<string | null>(null);
  const prevGroupIdsRef = useRef<Set<string>>(new Set());
  const planRef = useRef(new Map<string, boolean>());

  const groupIds = processGroupIds(renderItems);
  const groupIdsKey = groupIds.join('|');
  const isFirstObservation = prevViewKeyRef.current === null;
  const viewKeyChanged =
    !isFirstObservation && prevViewKeyRef.current !== conversationViewKey;
  const newlyAppearedGroupIds = groupIds.filter((groupId) => !prevGroupIdsRef.current.has(groupId));

  const shouldAnimateNewGroups = isFirstObservation
    ? false
    : viewKeyChanged
      ? !options.sessionNavigationPending &&
        (options.liveTurnActive || options.composeTurnInFlight)
      : true;

  planRef.current = new Map(
    newlyAppearedGroupIds.map((groupId) => [groupId, shouldAnimateNewGroups]),
  );

  useLayoutEffect(() => {
    prevViewKeyRef.current = conversationViewKey;
    prevGroupIdsRef.current = new Set(groupIds);
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
