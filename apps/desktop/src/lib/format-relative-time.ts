const TIME_UNITS: ReadonlyArray<{ unit: Intl.RelativeTimeFormatUnit; seconds: number }> = [
  { unit: 'year', seconds: 60 * 60 * 24 * 365 },
  { unit: 'month', seconds: 60 * 60 * 24 * 30 },
  { unit: 'week', seconds: 60 * 60 * 24 * 7 },
  { unit: 'day', seconds: 60 * 60 * 24 },
  { unit: 'hour', seconds: 60 * 60 },
  { unit: 'minute', seconds: 60 },
  { unit: 'second', seconds: 1 },
];

function resolveRelativeTimeLocale(locale: string): string {
  const normalized = locale.trim().toLowerCase();
  if (normalized.startsWith('zh')) {
    return 'zh-CN';
  }
  return 'en';
}

export function formatRelativeTime(isoTimestamp: string, locale: string): string {
  const parsed = Date.parse(isoTimestamp);
  if (!Number.isFinite(parsed)) {
    return isoTimestamp;
  }

  const deltaSeconds = Math.round((parsed - Date.now()) / 1000);
  const formatter = new Intl.RelativeTimeFormat(resolveRelativeTimeLocale(locale), {
    numeric: 'auto',
  });

  for (const { unit, seconds } of TIME_UNITS) {
    if (Math.abs(deltaSeconds) >= seconds || unit === 'second') {
      const value = Math.round(deltaSeconds / seconds);
      return formatter.format(value, unit);
    }
  }

  return isoTimestamp;
}
