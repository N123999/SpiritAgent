import { buildCdpAxTree, type CdpAxNode } from '../src/lib/cdp-ax-tree.js';
import type { ComputerUseTreeNode } from '../src/lib/computer-use-tree.js';

const DEFAULT_DEBUG_PORT = 9222;
const CDP_REQUEST_TIMEOUT_MS = 30_000;

export interface CdpTargetInfo {
  id: string;
  type: string;
  title: string;
  url: string;
  webSocketDebuggerUrl?: string;
}

export interface CdpSnapshotResult {
  ok: boolean;
  data?: {
    transport: 'cdp';
    fallback_reason: 'cef_host';
    debug_port: number;
    coverage: 'full' | 'partial';
    nodes_returned: number;
    max_nodes: number;
    cdp_target: { id: string; title: string; url: string; type: string };
    tree: ComputerUseTreeNode | null;
  };
  error?: { code: string; message: string };
}

export interface CdpActionResult {
  ok: boolean;
  data?: { action: string; transport: 'cdp' };
  error?: { code: string; message: string };
}

type CdpPending = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
};

class CdpWebSocketSession {
  private readonly pending = new Map<number, CdpPending>();
  private nextId = 1;

  constructor(private readonly ws: WebSocket) {
    ws.addEventListener('message', (event) => {
      const text = typeof event.data === 'string' ? event.data : String(event.data);
      let message: { id?: number; result?: unknown; error?: { message?: string } };
      try {
        message = JSON.parse(text) as { id?: number; result?: unknown; error?: { message?: string } };
      } catch {
        return;
      }
      if (typeof message.id !== 'number') {
        return;
      }
      const entry = this.pending.get(message.id);
      if (!entry) {
        return;
      }
      clearTimeout(entry.timer);
      this.pending.delete(message.id);
      if (message.error) {
        entry.reject(new Error(message.error.message ?? 'CDP command failed'));
        return;
      }
      entry.resolve(message.result);
    });

    ws.addEventListener('close', () => {
      for (const entry of this.pending.values()) {
        clearTimeout(entry.timer);
        entry.reject(new Error('CDP WebSocket closed'));
      }
      this.pending.clear();
    });
  }

  async send<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    const id = this.nextId++;
    return await new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP ${method} timed out after ${CDP_REQUEST_TIMEOUT_MS}ms`));
      }, CDP_REQUEST_TIMEOUT_MS);
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        timer,
      });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  close(): void {
    this.ws.close();
  }
}

const sessionCache = new Map<string, CdpWebSocketSession>();

function normalizePort(port: number | undefined): number {
  const value = port ?? DEFAULT_DEBUG_PORT;
  if (!Number.isInteger(value) || value < 1024 || value > 65535) {
    throw new Error('debug_port must be an integer between 1024 and 65535.');
  }
  return value;
}

function cacheKey(port: number, targetId: string): string {
  return `${port}:${targetId}`;
}

export async function listCdpTargets(portInput?: number): Promise<CdpTargetInfo[]> {
  const port = normalizePort(portInput);
  let response: Response;
  try {
    response = await fetch(`http://127.0.0.1:${port}/json/list`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`cdp_unreachable: ${message}`);
  }
  if (!response.ok) {
    throw new Error(`cdp_unreachable: HTTP ${response.status}`);
  }
  const targets = (await response.json()) as CdpTargetInfo[];
  return targets.filter((target) => Boolean(target.webSocketDebuggerUrl));
}

export function pickCdpTarget(
  targets: CdpTargetInfo[],
  options: { windowTitle?: string; processName?: string },
): CdpTargetInfo {
  const titleNeedle = options.windowTitle?.trim().toLowerCase() ?? '';
  const processNeedle = options.processName?.trim().toLowerCase().replace(/\.exe$/i, '') ?? '';

  const pageTargets = targets.filter((target) => target.type === 'page' || target.type === 'webview');
  const candidates = pageTargets.length > 0 ? pageTargets : targets;

  const scored = candidates
    .map((target) => {
      const title = target.title.toLowerCase();
      const url = target.url.toLowerCase();
      let score = 0;
      if (titleNeedle && title.includes(titleNeedle)) {
        score += 10;
      }
      if (processNeedle && (url.includes(processNeedle) || title.includes(processNeedle))) {
        score += 5;
      }
      return { target, score };
    })
    .filter((entry) => entry.score > 0 || (!titleNeedle && !processNeedle));

  if (titleNeedle || processNeedle) {
    const best = scored.sort((a, b) => b.score - a.score);
    if (best.length === 0) {
      throw new Error('cdp_target_not_found');
    }
    const topScore = best[0]!.score;
    const top = best.filter((entry) => entry.score === topScore);
    if (top.length > 1) {
      throw new Error('target_ambiguous');
    }
    return top[0]!.target;
  }

  if (candidates.length === 0) {
    throw new Error('cdp_target_not_found');
  }
  if (candidates.length > 1) {
    throw new Error('target_ambiguous');
  }
  return candidates[0]!;
}

async function connectSession(port: number, target: CdpTargetInfo): Promise<CdpWebSocketSession> {
  const key = cacheKey(port, target.id);
  const existing = sessionCache.get(key);
  if (existing) {
    return existing;
  }
  if (!target.webSocketDebuggerUrl) {
    throw new Error('cdp_target_not_found: missing webSocketDebuggerUrl');
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('CDP WebSocket connect timeout')), CDP_REQUEST_TIMEOUT_MS);
    ws.addEventListener('open', () => {
      clearTimeout(timer);
      resolve();
    });
    ws.addEventListener('error', () => {
      clearTimeout(timer);
      reject(new Error('CDP WebSocket connect failed'));
    });
  });
  const session = new CdpWebSocketSession(ws);
  sessionCache.set(key, session);
  return session;
}

export async function closeCdpSession(port: number, targetId: string): Promise<void> {
  const key = cacheKey(port, targetId);
  const session = sessionCache.get(key);
  if (!session) {
    return;
  }
  session.close();
  sessionCache.delete(key);
}

export async function snapshotViaCdp(input: {
  debug_port?: number;
  window_title?: string;
  process_name?: string;
  max_depth?: number;
  max_nodes?: number;
}): Promise<CdpSnapshotResult> {
  try {
    const port = normalizePort(input.debug_port);
    const targets = await listCdpTargets(port);
    const target = pickCdpTarget(targets, {
      windowTitle: input.window_title,
      processName: input.process_name,
    });
    const session = await connectSession(port, target);
    await session.send('Accessibility.enable', {});
    const axResult = await session.send<{ nodes: CdpAxNode[] }>('Accessibility.getFullAXTree', {
      depth: input.max_depth ?? 8,
    });
    const built = buildCdpAxTree(axResult.nodes ?? [], {
      port,
      maxDepth: input.max_depth,
      maxNodes: input.max_nodes,
    });
    return {
      ok: true,
      data: {
        transport: 'cdp',
        fallback_reason: 'cef_host',
        debug_port: port,
        coverage: built.coverage,
        nodes_returned: built.nodesReturned,
        max_nodes: input.max_nodes ?? 400,
        cdp_target: {
          id: target.id,
          title: target.title,
          url: target.url,
          type: target.type,
        },
        tree: built.tree,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const code = message.startsWith('cdp_') || message === 'target_ambiguous'
      ? message.split(':')[0]!
      : 'cdp_error';
    return {
      ok: false,
      error: {
        code,
        message:
          code === 'cdp_unreachable'
            ? 'Cannot reach localhost debug port. Start the app with --remote-debugging-port.'
            : code === 'cdp_target_not_found'
              ? 'No CDP page target matched window_title/process_name.'
              : code === 'target_ambiguous'
                ? 'Multiple CDP targets matched; provide a more specific window_title.'
                : message,
      },
    };
  }
}

export async function actViaCdp(input: {
  ref: string;
  action: string;
  text?: string;
  debug_port?: number;
  window_title?: string;
  process_name?: string;
}): Promise<CdpActionResult> {
  try {
    const port = normalizePort(input.debug_port);
    const match = /^c\d+n(\d+)$/i.exec(input.ref);
    if (!match) {
      return { ok: false, error: { code: 'invalid_ref', message: 'CDP ref must look like c9222n1042.' } };
    }
    const backendNodeId = Number.parseInt(match[1]!, 10);
    const targets = await listCdpTargets(port);
    const target = pickCdpTarget(targets, {
      windowTitle: input.window_title,
      processName: input.process_name,
    });
    const session = await connectSession(port, target);
    await session.send('DOM.enable', {});
    await session.send('Input.enable', {});

    if (input.action === 'set_value') {
      if (!input.text) {
        return { ok: false, error: { code: 'invalid_request', message: 'text is required for set_value.' } };
      }
      await session.send('DOM.focus', { backendNodeId });
      await session.send('Input.insertText', { text: input.text });
      return { ok: true, data: { action: 'set_value', transport: 'cdp' } };
    }

    if (
      input.action === 'invoke'
      || input.action === 'select'
      || input.action === 'toggle'
      || input.action === 'expand'
      || input.action === 'collapse'
    ) {
      const box = await session.send<{
        model: { content: number[]; width: number; height: number };
      }>('DOM.getBoxModel', { backendNodeId });
      const content = box.model.content;
      if (!content || content.length < 8) {
        return { ok: false, error: { code: 'element_not_found', message: 'No box model for target node.' } };
      }
      const x = (content[0]! + content[4]!) / 2;
      const y = (content[1]! + content[5]!) / 2;
      await session.send('Input.dispatchMouseEvent', {
        type: 'mousePressed',
        x,
        y,
        button: 'left',
        clickCount: 1,
      });
      await session.send('Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        x,
        y,
        button: 'left',
        clickCount: 1,
      });
      return { ok: true, data: { action: input.action, transport: 'cdp' } };
    }

    return { ok: false, error: { code: 'unknown_action', message: `Unknown action: ${input.action}` } };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: { code: 'cdp_error', message } };
  }
}
