import { execFile } from 'node:child_process';
import http from 'node:http';
import https from 'node:https';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export type LocalListeningEndpoint = {
  port: number;
  address?: string;
  processName?: string;
  /** 探测到的可访问 URL（http 或 https） */
  url?: string;
};

type RawListener = {
  address: string;
  port: number;
  processName?: string;
};

const SCAN_TIMEOUT_MS = 5_000;
const HTTP_PROBE_TIMEOUT_MS = 900;
const HTTP_PROBE_BATCH_SIZE = 16;
const PROBE_BODY_LIMIT_BYTES = 64 * 1024;

export function isHtmlContentType(contentType: string | undefined): boolean {
  if (!contentType) {
    return false;
  }
  const base = contentType.split(';')[0]?.trim().toLowerCase() ?? '';
  return base === 'text/html' || base === 'application/xhtml+xml';
}

export function extractHtmlTitle(html: string): string | null {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  if (!match?.[1]) {
    return null;
  }
  const text = match[1]
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]+>/g, '')
    .trim();
  if (!text) {
    return null;
  }
  return decodeHtmlEntities(text);
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

export function isLikelyWebPage(contentType: string | undefined, body: string): boolean {
  if (isHtmlContentType(contentType)) {
    return true;
  }
  return extractHtmlTitle(body) != null;
}

export function probeHttpUrl(url: string, timeoutMs = HTTP_PROBE_TIMEOUT_MS): Promise<string | null> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: string | null) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(value);
    };

    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      finish(null);
      return;
    }

    const lib = parsed.protocol === 'https:' ? https : http;
    const req = lib.request(
      {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port,
        path: `${parsed.pathname}${parsed.search}`,
        method: 'GET',
        timeout: timeoutMs,
        rejectUnauthorized: false,
        headers: {
          Accept: 'text/html,application/xhtml+xml,*/*',
          'User-Agent': 'SpiritAgent-Desktop-LocalProbe/1.0',
        },
      },
      (res) => {
        const contentTypeHeader = res.headers['content-type'];
        const contentType = Array.isArray(contentTypeHeader)
          ? contentTypeHeader[0]
          : contentTypeHeader;
        const chunks: Buffer[] = [];
        let size = 0;

        res.on('data', (chunk: Buffer) => {
          if (size >= PROBE_BODY_LIMIT_BYTES) {
            return;
          }
          chunks.push(chunk);
          size += chunk.length;
        });

        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8');
          finish(isLikelyWebPage(contentType, body) ? url : null);
        });

        res.on('error', () => finish(null));
      },
    );
    req.on('timeout', () => {
      req.destroy();
      finish(null);
    });
    req.on('error', () => finish(null));
    req.end();
  });
}

/** 依次尝试 http / https，返回首个像网页的 URL。 */
export async function probeLocalHttpPort(port: number): Promise<string | null> {
  const candidates = [`http://127.0.0.1:${port}/`, `https://127.0.0.1:${port}/`];
  for (const url of candidates) {
    const matched = await probeHttpUrl(url);
    if (matched) {
      return matched;
    }
  }
  return null;
}

export async function filterHttpListeningEndpoints(
  endpoints: readonly LocalListeningEndpoint[],
): Promise<LocalListeningEndpoint[]> {
  const verified: LocalListeningEndpoint[] = [];
  for (let index = 0; index < endpoints.length; index += HTTP_PROBE_BATCH_SIZE) {
    const batch = endpoints.slice(index, index + HTTP_PROBE_BATCH_SIZE);
    const probed = await Promise.all(
      batch.map(async (endpoint) => {
        const url = await probeLocalHttpPort(endpoint.port);
        return url ? { ...endpoint, url } : null;
      }),
    );
    for (const item of probed) {
      if (item) {
        verified.push(item);
      }
    }
  }
  return verified.sort((a, b) => a.port - b.port);
}

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
    const merged = mergeLocalListeningEndpoints(raw.filter((item) => item.port > 0));
    return filterHttpListeningEndpoints(merged);
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
