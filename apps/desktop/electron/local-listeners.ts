import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export type LocalListeningEndpoint = {
  port: number;
  address?: string;
  processName?: string;
};

type RawListener = {
  address: string;
  port: number;
  processName?: string;
};

const SCAN_TIMEOUT_MS = 5_000;

export function isLocalhostReachableAddress(address: string): boolean {
  const normalized = address.trim().toLowerCase();
  if (!normalized || normalized === '*' || normalized === '0.0.0.0') {
    return true;
  }
  if (normalized === '127.0.0.1' || normalized === 'localhost' || normalized === '::1') {
    return true;
  }
  if (normalized === '[::]' || normalized === '::') {
    return true;
  }
  return false;
}

export function mergeLocalListeningEndpoints(raw: readonly RawListener[]): LocalListeningEndpoint[] {
  const byPort = new Map<number, LocalListeningEndpoint>();
  for (const item of raw) {
    if (!Number.isInteger(item.port) || item.port < 1 || item.port > 65_535) {
      continue;
    }
    if (!isLocalhostReachableAddress(item.address)) {
      continue;
    }
    const existing = byPort.get(item.port);
    if (!existing) {
      byPort.set(item.port, {
        port: item.port,
        address: item.address,
        processName: item.processName,
      });
      continue;
    }
    if (!existing.processName && item.processName) {
      byPort.set(item.port, {
        port: item.port,
        address: existing.address ?? item.address,
        processName: item.processName,
      });
    }
  }
  return [...byPort.values()].sort((a, b) => a.port - b.port);
}

/** PowerShell: LocalAddress|LocalPort|OwningProcess per line */
export function parseWindowsPowerShellListeners(stdout: string): RawListener[] {
  const results: RawListener[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    const parts = trimmed.split('|');
    if (parts.length < 2) {
      continue;
    }
    const address = parts[0]?.trim() ?? '';
    const port = Number.parseInt(parts[1]?.trim() ?? '', 10);
    if (!Number.isInteger(port)) {
      continue;
    }
    results.push({ address, port });
  }
  return results;
}

/** Windows netstat -ano: TCP  0.0.0.0:7788  0.0.0.0:0  LISTENING  1234 */
export function parseWindowsNetstat(stdout: string): RawListener[] {
  const results: RawListener[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('TCP') || !trimmed.includes('LISTENING')) {
      continue;
    }
    const columns = trimmed.split(/\s+/);
    const local = columns[1];
    if (!local) {
      continue;
    }
    const lastColon = local.lastIndexOf(':');
    if (lastColon <= 0) {
      continue;
    }
    const address = local.slice(0, lastColon).replace(/^\[(.*)\]$/, '$1');
    const port = Number.parseInt(local.slice(lastColon + 1), 10);
    if (!Number.isInteger(port)) {
      continue;
    }
    results.push({ address, port });
  }
  return results;
}

/** Linux ss -tlnH: LISTEN 0 511 127.0.0.1:1420 0.0.0.0:* */
export function parseSsOutput(stdout: string): RawListener[] {
  const results: RawListener[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('LISTEN')) {
      continue;
    }
    const columns = trimmed.split(/\s+/);
    const local = columns[3];
    if (!local) {
      continue;
    }
    const parsed = parseHostPortToken(local);
    if (parsed) {
      results.push(parsed);
    }
  }
  return results;
}

/** Unix netstat -an: tcp4  0  0  127.0.0.1.1420  *.*  LISTEN */
export function parseUnixNetstat(stdout: string): RawListener[] {
  const results: RawListener[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.includes('LISTEN')) {
      continue;
    }
    const columns = trimmed.split(/\s+/);
    const local = columns[3];
    if (!local) {
      continue;
    }
    const dotForm = /^(.+)\.(\d+)$/.exec(local);
    if (dotForm) {
      results.push({
        address: dotForm[1] ?? '',
        port: Number.parseInt(dotForm[2] ?? '', 10),
      });
      continue;
    }
    const parsed = parseHostPortToken(local);
    if (parsed) {
      results.push(parsed);
    }
  }
  return results;
}

function parseHostPortToken(token: string): RawListener | null {
  if (token === '*:*' || token === '*.*') {
    return { address: '0.0.0.0', port: 0 };
  }
  const bracket = /^\[(.+)\]:(\d+)$/.exec(token);
  if (bracket) {
    const port = Number.parseInt(bracket[2] ?? '', 10);
    if (!Number.isInteger(port)) {
      return null;
    }
    return { address: bracket[1] ?? '', port };
  }
  const wildcardPort = /^\*:(\d+)$/.exec(token);
  if (wildcardPort) {
    const port = Number.parseInt(wildcardPort[1] ?? '', 10);
    if (!Number.isInteger(port)) {
      return null;
    }
    return { address: '0.0.0.0', port };
  }
  const hostPort = /^(.+):(\d+)$/.exec(token);
  if (!hostPort) {
    return null;
  }
  const port = Number.parseInt(hostPort[2] ?? '', 10);
  if (!Number.isInteger(port)) {
    return null;
  }
  return { address: hostPort[1] ?? '', port };
}

async function runWithTimeout(
  file: string,
  args: readonly string[],
): Promise<{ stdout: string; stderr: string }> {
  const result = await execFileAsync(file, [...args], {
    timeout: SCAN_TIMEOUT_MS,
    windowsHide: true,
    maxBuffer: 4 * 1024 * 1024,
  });
  const stdout = String(result.stdout ?? '');
  const stderr = String(result.stderr ?? '');
  return { stdout, stderr };
}

async function scanWindowsListeners(): Promise<RawListener[]> {
  const psScript =
    'Get-NetTCPConnection -State Listen | ForEach-Object { "$($_.LocalAddress)|$($_.LocalPort)|$($_.OwningProcess)" }';
  try {
    const { stdout } = await runWithTimeout('powershell.exe', ['-NoProfile', '-Command', psScript]);
    const parsed = parseWindowsPowerShellListeners(stdout);
    if (parsed.length > 0) {
      return parsed;
    }
  } catch {
    // fallback below
  }
  try {
    const { stdout } = await runWithTimeout('netstat.exe', ['-ano', '-p', 'tcp']);
    return parseWindowsNetstat(stdout);
  } catch {
    return [];
  }
}

async function scanDarwinListeners(): Promise<RawListener[]> {
  try {
    const { stdout } = await runWithTimeout('netstat', ['-an', '-p', 'tcp']);
    return parseUnixNetstat(stdout);
  } catch {
    return [];
  }
}

async function scanLinuxListeners(): Promise<RawListener[]> {
  try {
    const { stdout } = await runWithTimeout('ss', ['-tlnH']);
    const parsed = parseSsOutput(stdout);
    if (parsed.length > 0) {
      return parsed;
    }
  } catch {
    // fallback below
  }
  try {
    const { stdout } = await runWithTimeout('netstat', ['-tln']);
    const ssParsed = parseSsOutput(stdout);
    if (ssParsed.length > 0) {
      return ssParsed;
    }
    return parseUnixNetstat(stdout);
  } catch {
    return [];
  }
}

export async function listLocalListeningEndpoints(): Promise<LocalListeningEndpoint[]> {
  try {
    let raw: RawListener[] = [];
    if (process.platform === 'win32') {
      raw = await scanWindowsListeners();
    } else if (process.platform === 'darwin') {
      raw = await scanDarwinListeners();
    } else {
      raw = await scanLinuxListeners();
    }
    return mergeLocalListeningEndpoints(raw.filter((item) => item.port > 0));
  } catch (error) {
    console.warn('[spirit-desktop] listLocalListeningEndpoints failed:', error);
    return [];
  }
}

export function isAllowedExternalUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}
