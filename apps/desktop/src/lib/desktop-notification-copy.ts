const NOTIFICATION_BODY_MAX = 240;
const APPROVAL_BODY_MAX = 200;

export function formatSessionPrefixedTitle(sessionName: string, body: string): string {
  const trimmedSession = sessionName.trim() || 'Session';
  const trimmedBody = body.trim();
  if (!trimmedBody) {
    return `[${trimmedSession}]`;
  }
  return `[${trimmedSession}] ${trimmedBody}`;
}

export function truncateNotificationBody(text: string, max = NOTIFICATION_BODY_MAX): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) {
    return trimmed;
  }
  return `${trimmed.slice(0, Math.max(0, max - 1))}…`;
}

export function stripShellReasonLine(prompt: string, reasonPrefix: string): string {
  const lines = prompt.split(/\r?\n/);
  if (!lines[0]?.trim().startsWith(reasonPrefix)) {
    return prompt;
  }
  return lines.slice(1).join('\n').trim();
}

export function shellApprovalNotificationBody(prompt: string, reasonPrefix: string): string {
  const lines = prompt.split(/\r?\n/);
  const reasonLine = lines[0]?.trim().startsWith(reasonPrefix) ? lines[0].trim() : '';
  const command = stripShellReasonLine(prompt, reasonPrefix).trim();
  if (reasonLine && command && reasonLine !== command) {
    return truncateNotificationBody(`${reasonLine}\n${command}`, APPROVAL_BODY_MAX);
  }
  return truncateNotificationBody(command || reasonLine || prompt, APPROVAL_BODY_MAX);
}

export function genericApprovalNotificationBody(toolName: string, prompt: string): string {
  const label = toolName.trim();
  const detail = prompt.trim();
  if (label && detail) {
    return truncateNotificationBody(`${label}\n${detail}`, APPROVAL_BODY_MAX);
  }
  return truncateNotificationBody(detail || label, APPROVAL_BODY_MAX);
}
