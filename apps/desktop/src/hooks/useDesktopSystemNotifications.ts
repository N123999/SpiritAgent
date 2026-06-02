import { useEffect, useRef } from 'react';

import {
  formatSessionPrefixedTitle,
  genericApprovalNotificationBody,
  shellApprovalNotificationBody,
} from '@/lib/desktop-notification-copy';
import type { DesktopShowNotificationRequest } from '@/lib/desktop-notification-types';
import type { DesktopSnapshot, PendingQuestionsSnapshot, PendingToolApprovalSnapshot, SessionListItem } from '@/types';
import i18n from '@/lib/i18n';

type NotificationBridge = NonNullable<Window['spiritDesktop']>;

type AttentionFlags = {
  needsApproval: boolean;
  needsQuestions: boolean;
  needsTaskComplete: boolean;
};

function attentionFlagsKey(flags: AttentionFlags): string {
  return `${flags.needsApproval}:${flags.needsQuestions}:${flags.needsTaskComplete}`;
}

function sessionDisplayName(snapshot: DesktopSnapshot | null | undefined): string {
  return snapshot?.activeSession?.displayName?.trim() || i18n.t('notification.defaultSessionName');
}

async function requestDesktopNotification(
  bridge: NotificationBridge,
  payload: DesktopShowNotificationRequest,
): Promise<void> {
  if (!bridge.showNotification) {
    return;
  }
  const away = bridge.getAppAwayFromUser ? await bridge.getAppAwayFromUser() : false;
  if (!away) {
    return;
  }
  await bridge.showNotification(payload);
}

function approvalNotificationPayload(
  sessionName: string,
  approval: PendingToolApprovalSnapshot,
  isWindows: boolean,
): DesktopShowNotificationRequest {
  const body =
    approval.toolName === 'run_shell_command'
      ? shellApprovalNotificationBody(approval.prompt, i18n.t('tool.reasonPrefix'))
      : genericApprovalNotificationBody(approval.toolName, approval.prompt);

  return {
    kind: 'approval',
    tag: 'spirit-approval',
    title: formatSessionPrefixedTitle(sessionName, i18n.t('notification.approval.title')),
    body: isWindows ? body : `${body}\n${i18n.t('notification.approval.returnToApp')}`,
    ...(isWindows
      ? {
          actions: [
            { type: 'button' as const, text: i18n.t('app.allow') },
            { type: 'button' as const, text: i18n.t('app.deny') },
          ],
        }
      : {}),
  };
}

function askQuestionsNotificationPayload(
  sessionName: string,
  pending: PendingQuestionsSnapshot,
): DesktopShowNotificationRequest {
  const questionCount = pending.request.questions.length;
  const detail =
    pending.request.title?.trim() ||
    (questionCount > 0
      ? i18n.t('notification.askQuestions.nQuestions', { count: questionCount })
      : i18n.t('notification.askQuestions.fallback'));

  return {
    kind: 'ask-questions',
    tag: `spirit-ask-${pending.toolCallId}`,
    title: formatSessionPrefixedTitle(sessionName, i18n.t('notification.askQuestions.title')),
    body: detail,
  };
}

export function useDesktopSystemNotifications(options: {
  apiKind: string | null | undefined;
  snapshot: DesktopSnapshot | null | undefined;
  sessions: readonly SessionListItem[];
  onNotifyRefresh?: () => void;
}): void {
  const { apiKind, snapshot, sessions, onNotifyRefresh } = options;
  const prevBusyRef = useRef<boolean | undefined>(undefined);
  const prevSessionsBusyRef = useRef<Map<string, boolean>>(new Map());
  const notifiedTaskCompleteRef = useRef<Set<string>>(new Set());
  const prevApprovalKeyRef = useRef<string | undefined>(undefined);
  const prevQuestionsKeyRef = useRef<string | undefined>(undefined);
  const busyCycleRef = useRef(0);
  const sessionBusyGenRef = useRef<Map<string, number>>(new Map());
  const bgNotifiedGenRef = useRef<Map<string, number>>(new Map());
  const isWindowsRef = useRef(false);
  const taskCompleteAttentionRef = useRef(false);
  const lastAttentionSyncKeyRef = useRef('');
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;

  const syncAttentionPending = (bridge: NotificationBridge, flags: AttentionFlags) => {
    if (!bridge.syncAttentionPending) {
      return;
    }
    const key = attentionFlagsKey(flags);
    if (lastAttentionSyncKeyRef.current === key) {
      return;
    }
    lastAttentionSyncKeyRef.current = key;
    void bridge.syncAttentionPending(flags);
  };

  const markTaskCompleteAttention = (bridge: NotificationBridge) => {
    taskCompleteAttentionRef.current = true;
    const current = snapshotRef.current;
    syncAttentionPending(bridge, {
      needsApproval: Boolean(current?.conversation.pendingToolApproval),
      needsQuestions: Boolean(current?.conversation.pendingQuestions),
      needsTaskComplete: true,
    });
  };

  useEffect(() => {
    isWindowsRef.current = window.spiritDesktop?.platform === 'win32';
  }, []);

  useEffect(() => {
    if (apiKind !== 'electron') {
      return;
    }
    const bridge = window.spiritDesktop;
    if (!bridge?.subscribeAppAwayChanged) {
      return;
    }
    return bridge.subscribeAppAwayChanged((away) => {
      if (away) {
        return;
      }
      if (!taskCompleteAttentionRef.current) {
        return;
      }
      taskCompleteAttentionRef.current = false;
      const current = snapshotRef.current;
      syncAttentionPending(bridge, {
        needsApproval: Boolean(current?.conversation.pendingToolApproval),
        needsQuestions: Boolean(current?.conversation.pendingQuestions),
        needsTaskComplete: false,
      });
    });
  }, [apiKind]);

  useEffect(() => {
    if (apiKind !== 'electron' || !window.spiritDesktop?.showNotification) {
      return;
    }
    const bridge = window.spiritDesktop;

    const sessionName = sessionDisplayName(snapshot);
    const approval = snapshot?.conversation.pendingToolApproval;
    const questions = snapshot?.conversation.pendingQuestions;
    const isBusy = snapshot?.conversation.isBusy === true;

    syncAttentionPending(bridge, {
      needsApproval: Boolean(approval),
      needsQuestions: Boolean(questions),
      needsTaskComplete: taskCompleteAttentionRef.current,
    });

    if (isBusy && prevBusyRef.current !== true) {
      busyCycleRef.current += 1;
      notifiedTaskCompleteRef.current.delete(`${snapshot?.composerSessionKey ?? 'active'}:${busyCycleRef.current}`);
    }

    if (
      prevBusyRef.current === true &&
      !isBusy &&
      !approval &&
      !questions
    ) {
      const dedupeKey = `${snapshot?.composerSessionKey ?? 'active'}:${busyCycleRef.current}`;
      if (!notifiedTaskCompleteRef.current.has(dedupeKey)) {
        notifiedTaskCompleteRef.current.add(dedupeKey);
        void requestDesktopNotification(bridge, {
          kind: 'task-complete',
          tag: `spirit-task-complete-${dedupeKey}`,
          title: formatSessionPrefixedTitle(sessionName, i18n.t('notification.taskComplete.title')),
        }).then(() => {
          void bridge.getAppAwayFromUser?.().then((away) => {
            if (away) {
              markTaskCompleteAttention(bridge);
            }
          });
        });
      }
    }
    prevBusyRef.current = isBusy;

    const approvalKey = approval
      ? `${approval.toolName}:${approval.prompt}`
      : undefined;
    if (approval && approvalKey !== prevApprovalKeyRef.current) {
      void requestDesktopNotification(
        bridge,
        approvalNotificationPayload(sessionName, approval, isWindowsRef.current),
      );
    }
    prevApprovalKeyRef.current = approvalKey;

    const questionsKey = questions?.toolCallId;
    if (questions && questionsKey && questionsKey !== prevQuestionsKeyRef.current) {
      void requestDesktopNotification(bridge, askQuestionsNotificationPayload(sessionName, questions));
    }
    prevQuestionsKeyRef.current = questionsKey;

    const prevMap = prevSessionsBusyRef.current;
    const nextMap = new Map<string, boolean>();
    for (const session of sessions) {
      const wasBusy = prevMap.get(session.path) === true;
      const nowBusy = session.isBusy === true;
      nextMap.set(session.path, nowBusy);
      if (nowBusy && !wasBusy) {
        sessionBusyGenRef.current.set(
          session.path,
          (sessionBusyGenRef.current.get(session.path) ?? 0) + 1,
        );
      }
      if (wasBusy && !nowBusy && !session.isActive) {
        const gen = sessionBusyGenRef.current.get(session.path) ?? 0;
        if (bgNotifiedGenRef.current.get(session.path) !== gen) {
          bgNotifiedGenRef.current.set(session.path, gen);
          void requestDesktopNotification(bridge, {
            kind: 'task-complete',
            tag: `spirit-task-complete-${session.path}`,
            title: formatSessionPrefixedTitle(
              session.displayName,
              i18n.t('notification.taskComplete.title'),
            ),
          }).then(() => {
            void bridge.getAppAwayFromUser?.().then((away) => {
              if (away) {
                markTaskCompleteAttention(bridge);
              }
            });
          });
        }
      }
    }
    prevSessionsBusyRef.current = nextMap;
  }, [apiKind, snapshot, sessions]);

  useEffect(() => {
    if (apiKind !== 'electron' || !onNotifyRefresh || !window.spiritDesktop?.subscribeNotifyRefresh) {
      return;
    }
    return window.spiritDesktop.subscribeNotifyRefresh(onNotifyRefresh);
  }, [apiKind, onNotifyRefresh]);
}
