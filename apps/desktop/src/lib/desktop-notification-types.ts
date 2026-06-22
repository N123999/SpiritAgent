export type DesktopNotificationKind = 'task-complete' | 'approval' | 'ask-questions' | 'generic';

export type DesktopNotificationAction =
  | {
      type: 'button';
      text: string;
      action?: 'allow' | 'deny' | 'focus';
    }
  | {
      type: 'text';
      text: string;
      placeholder?: string;
      action: 'reply';
    };

export type DesktopNotificationContext = {
  approvalId?: string;
  questionToolCallId?: string;
  questionId?: string;
};

export type DesktopShowNotificationRequest = {
  title: string;
  body?: string;
  tag?: string;
  silent?: boolean;
  actions?: DesktopNotificationAction[];
  kind?: DesktopNotificationKind;
  context?: DesktopNotificationContext;
};
