import { existsSync } from 'node:fs';
import path from 'node:path';

export function resolveRendererDistPath(electronDir: string): string {
  const candidates = [
    path.join(electronDir, '..', '..', 'dist'),
    path.join(electronDir, '..', 'dist'),
    path.join(process.cwd(), 'dist'),
  ];

  return candidates.find((candidate) => existsSync(path.join(candidate, 'index.html'))) ?? candidates[0]!;
}