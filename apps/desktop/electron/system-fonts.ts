import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

let cachedSystemFonts: string[] | undefined;

export async function listSystemFonts(): Promise<string[]> {
  if (cachedSystemFonts) {
    return cachedSystemFonts;
  }

  const fonts = normalizeFontFamilies(
    process.platform === 'win32'
      ? await listWindowsFonts()
      : process.platform === 'darwin'
        ? await listMacFonts()
        : [],
  );
  cachedSystemFonts = fonts;
  return fonts;
}

async function listWindowsFonts(): Promise<string[]> {
  const script = [
    'Add-Type -AssemblyName System.Drawing',
    '$fonts = New-Object System.Drawing.Text.InstalledFontCollection',
    '$fonts.Families | ForEach-Object { $_.Name } | ConvertTo-Json -Compress',
  ].join('; ');

  try {
    const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-Command', script], {
      windowsHide: true,
      maxBuffer: 1024 * 1024,
    });
    return parseJsonStringList(stdout);
  } catch (error) {
    console.warn('[spirit-desktop] list Windows fonts failed:', error);
    return [];
  }
}

async function listMacFonts(): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync('system_profiler', ['SPFontsDataType', '-json'], {
      maxBuffer: 8 * 1024 * 1024,
    });
    const parsed = JSON.parse(stdout) as unknown;
    return collectFontFamiliesFromSystemProfiler(parsed);
  } catch (error) {
    console.warn('[spirit-desktop] list macOS fonts failed:', error);
    return [];
  }
}

function parseJsonStringList(raw: string): string[] {
  const trimmed = raw.trim();
  if (!trimmed) {
    return [];
  }

  const parsed = JSON.parse(trimmed) as unknown;
  if (typeof parsed === 'string') {
    return [parsed];
  }
  if (Array.isArray(parsed)) {
    return parsed.filter((item): item is string => typeof item === 'string');
  }
  return [];
}

function collectFontFamiliesFromSystemProfiler(value: unknown): string[] {
  const result: string[] = [];

  const visit = (node: unknown) => {
    if (!node || typeof node !== 'object') {
      return;
    }
    if (Array.isArray(node)) {
      for (const item of node) {
        visit(item);
      }
      return;
    }

    const record = node as Record<string, unknown>;
    const family = record.family;
    if (typeof family === 'string') {
      result.push(family);
    }
    for (const child of Object.values(record)) {
      visit(child);
    }
  };

  visit(value);
  return result;
}

function normalizeFontFamilies(fonts: string[]): string[] {
  return Array.from(
    new Set(
      fonts
        .map((font) => font.trim())
        .filter(Boolean),
    ),
  ).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}
