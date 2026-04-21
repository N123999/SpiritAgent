/** 将用户消息正文加上本地时区时间戳，供 LLM 建立时间锚点（无独立元数据字段，仅通过纯文本 content 传递）。 */
export function formatUserMessageContentForLlm(body: string): string {
  return `[用户消息时间 ${formatLocalIsoWithOffset(new Date())}]\n${body}`;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function pad3(n: number): string {
  return String(n).padStart(3, '0');
}

/** 形如 2026-04-21T15:30:45.123+08:00（本地日历 + 与 UTC 的偏移）。 */
function formatLocalIsoWithOffset(d: Date): string {
  const y = d.getFullYear();
  const mo = pad2(d.getMonth() + 1);
  const day = pad2(d.getDate());
  const h = pad2(d.getHours());
  const mi = pad2(d.getMinutes());
  const s = pad2(d.getSeconds());
  const ms = pad3(d.getMilliseconds());
  const offMin = -d.getTimezoneOffset();
  const sign = offMin >= 0 ? '+' : '-';
  const abs = Math.abs(offMin);
  const oh = pad2(Math.floor(abs / 60));
  const om = pad2(abs % 60);
  return `${y}-${mo}-${day}T${h}:${mi}:${s}.${ms}${sign}${oh}:${om}`;
}
