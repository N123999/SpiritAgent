export type DesktopNotificationKind = 'task-complete' | 'approval' | 'ask-questions' | 'generic';

export type DesktopNotificationAction = {
  type: 'button';
  text: string;
};

export type DesktopShowNotificationRequest = {
  title: string;
  body?: string;
  tag?: string;
  silent?: boolean;
  actions?: DesktopNotificationAction[];
  kind?: DesktopNotificationKind;
};
