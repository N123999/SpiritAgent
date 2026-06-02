import path from 'node:path';

import { app } from 'electron';

import {
  SPIRIT_NOTIFICATION_PROTOCOL,
  findSpiritNotificationProtocolUrl,
  parseSpiritNotificationProtocolUrl,
} from '../src/lib/spirit-notification-protocol.js';

export type SpiritNotificationProtocolHandlers = {
  onApproval: (decision: 'allow' | 'deny') => void | Promise<void>;
  onFocus?: () => void;
};

let handlers: SpiritNotificationProtocolHandlers | undefined;

export function registerSpiritNotificationProtocolClient(): void {
  if (process.platform !== 'win32') {
    return;
  }
  if (process.defaultApp) {
    if (process.argv.length >= 2) {
      app.setAsDefaultProtocolClient(SPIRIT_NOTIFICATION_PROTOCOL, process.execPath, [
        path.resolve(process.argv[1]),
      ]);
    }
  } else {
    app.setAsDefaultProtocolClient(SPIRIT_NOTIFICATION_PROTOCOL);
  }
}

export function bindSpiritNotificationProtocolHandlers(
  next: SpiritNotificationProtocolHandlers,
): void {
  handlers = next;
}

export function handleSpiritNotificationProtocolArgv(argv: readonly string[]): void {
  const rawUrl = findSpiritNotificationProtocolUrl(argv);
  if (!rawUrl) {
    return;
  }
  dispatchSpiritNotificationProtocolUrl(rawUrl);
}

function dispatchSpiritNotificationProtocolUrl(rawUrl: string): void {
  const parsed = parseSpiritNotificationProtocolUrl(rawUrl);
  if (!parsed || !handlers) {
    return;
  }
  if (parsed.kind === 'approval') {
    void handlers.onApproval(parsed.decision);
    return;
  }
  handlers.onFocus?.();
}

export function installSpiritNotificationProtocolRouting(): void {
  if (process.platform === 'darwin') {
    app.on('open-url', (event, url) => {
      event.preventDefault();
      dispatchSpiritNotificationProtocolUrl(url);
    });
  }
}
