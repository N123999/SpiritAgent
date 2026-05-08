export function requireEnv(name: string, fallback?: string): string {
  const value = process.env[name] ?? (fallback ? process.env[fallback] : undefined);
  if (!value || !value.trim()) {
    throw new Error(`缺少环境变量 ${name}${fallback ? ` 或 ${fallback}` : ''}`);
  }
  return value;
}