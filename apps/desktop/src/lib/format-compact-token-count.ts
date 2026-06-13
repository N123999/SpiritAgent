/** Renderer-safe compact token counts for UI (e.g. 50K, 1M). */

export function formatCompactTokenCount(value: number): string {
  const count = Math.max(0, Math.trunc(value));
  if (count >= 1_000_000) {
    return `${formatScaledCount(count / 1_000_000)}M`;
  }
  if (count >= 1_000) {
    const scaledK = Math.min(Math.round((count / 1_000) * 10) / 10, 999.9);
    return `${formatScaledCount(scaledK)}K`;
  }
  return String(count);
}

function formatScaledCount(scaled: number): string {
  const roundedOneDecimal = Math.round(scaled * 10) / 10;
  if (Number.isInteger(roundedOneDecimal)) {
    return String(roundedOneDecimal);
  }
  return roundedOneDecimal.toFixed(1).replace(/\.0$/, '');
}
