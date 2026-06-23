import path from 'node:path';

import { app } from 'electron';

import {
  SPIRIT_NOTIFICATION_PROTOCOL,
  dispatchSpiritNotificationProtocolUrl,
  handleSpiritNotificationProtocolArgv as dispatchSpiritNotificationProtocolArgv,
  type SpiritNotificationProtocolHandlers,
} from '../src/lib/spirit-notification-protocol.js';

export type { SpiritNotificationProtocolHandlers };

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

/** Returns true when argv contains a spirit:// URL that was dispatched successfully. */
export function handleSpiritNotificationProtocolArgv(argv: readonly string[]): boolean {
  return dispatchSpiritNotificationProtocolArgv(argv, handlers);
}

function dispatchSpiritNotificationProtocolUrlFromOpenUrl(rawUrl: string): void {
  dispatchSpiritNotificationProtocolUrl(rawUrl, handlers);
}

export function installSpiritNotificationProtocolRouting(): void {
  if (process.platform === 'darwin') {
    app.on('open-url', (event, url) => {
      event.preventDefault();
      dispatchSpiritNotificationProtocolUrlFromOpenUrl(url);
    });
  }
}
