import type { HostToolRequest } from '@spirit-agent/host-internal';

import { actViaCdp, snapshotViaCdp } from '../../electron/win-computer-use-cdp.js';
import {
  actOnWindowsUi,
  listWindowsViaComputerUse,
  snapshotWindowsUi,
  type WinComputerUseHelperResponse,
} from '../../electron/win-computer-use.js';
import { isCdpComputerUseRef, pruneComputerUseTree } from '../lib/computer-use-tree.js';

function assertWindowsElectronHost(): void {
  if (process.platform !== 'win32') {
    throw new Error('Computer Use tools are only available on the Windows Electron desktop host.');
  }
}

function formatHelperResponse(response: WinComputerUseHelperResponse): string {
  return JSON.stringify(response, null, 2);
}

export async function executeComputerUseSnapshot(
  request: Extract<HostToolRequest, { name: 'computer_use_snapshot' }>,
): Promise<string> {
  assertWindowsElectronHost();

  if (request.mode === 'list_windows') {
    const response = await listWindowsViaComputerUse();
    return formatHelperResponse(response);
  }

  if (
    !request.process_name?.trim()
    && !request.window_title?.trim()
    && !request.surface?.trim()
  ) {
    throw new Error(
      'computer_use_snapshot mode=tree requires surface, process_name, and/or window_title.',
    );
  }

  const uiaResponse = await snapshotWindowsUi({
    process_name: request.process_name,
    window_title: request.window_title,
    surface: request.surface,
    max_depth: request.max_depth,
    max_nodes: request.max_nodes,
  });

  if (!uiaResponse.ok) {
    return formatHelperResponse(uiaResponse);
  }

  const uiaData = uiaResponse.data as {
    host_kind?: string;
    window?: { hwnd: number; title: string; process_name: string };
    tree?: unknown;
  } | undefined;

  const shellSurface = request.surface?.trim();
  if (uiaData?.host_kind !== 'cef' || shellSurface) {
    return formatHelperResponse({
      ...uiaResponse,
      data: {
        ...uiaData,
        transport: 'uia',
      },
    });
  }

  const explicitWindowTitle = request.window_title?.trim() || undefined;
  const cdpMatchInput = {
    debug_port: request.debug_port,
    // UIA 窗口标题在 CEF 应用里常为歌曲名等动态文案，与 CDP page title 不一致，不得隐式代入。
    window_title: explicitWindowTitle,
    process_name: request.process_name ?? uiaData.window?.process_name,
    max_depth: request.max_depth,
    max_nodes: request.max_nodes,
  };
  const cdpResponse = await snapshotViaCdp(cdpMatchInput);

  if (!cdpResponse.ok || !cdpResponse.data) {
    return formatHelperResponse(cdpResponse);
  }

  const prunedTree = cdpResponse.data.tree ? pruneComputerUseTree(cdpResponse.data.tree) : null;
  return formatHelperResponse({
    ok: true,
    data: {
      ...cdpResponse.data,
      host_kind: 'cef',
      tree: prunedTree,
      uia_window: uiaData.window,
    },
  });
}

export async function executeComputerUseAction(
  request: Extract<HostToolRequest, { name: 'computer_use_action' }>,
): Promise<string> {
  assertWindowsElectronHost();

  if (isCdpComputerUseRef(request.ref)) {
    const response = await actViaCdp({
      ref: request.ref,
      action: request.action,
      text: request.text,
      debug_port: request.debug_port,
      window_title: request.window_title,
      process_name: request.process_name,
    });
    return formatHelperResponse(response);
  }

  const response = await actOnWindowsUi({
    ref: request.ref,
    action: request.action,
    text: request.text,
    invoke_timeout_ms: request.invoke_timeout_ms,
  });
  return formatHelperResponse(response);
}

export function isComputerUseToolRequest(
  request: HostToolRequest,
): request is Extract<HostToolRequest, { name: 'computer_use_snapshot' | 'computer_use_action' }> {
  return request.name === 'computer_use_snapshot' || request.name === 'computer_use_action';
}
