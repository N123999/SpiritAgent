import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { invokeDesktopHostCommand } from '../src/host/service.js';
import { loadConfig, type DesktopWebHostConfigFile } from '../src/host/storage.js';
import { setDesktopWebHostRuntimeStatus } from '../src/host/web-host-state.js';
import {
  createDesktopHttpHost,
  createDesktopWebPairingCode,
  resolveDesktopWebHostFromEnv,
} from './http-host.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const { host, port } = resolveDesktopWebHostFromEnv();
let webHostConfig: DesktopWebHostConfigFile = (await loadConfig()).webHost;
let pairingCode = webHostConfig.authTokenHash ? '' : createDesktopWebPairingCode();
const webHost = createDesktopHttpHost({
  host,
  port,
  invokeHostCommand: invokeDesktopHostCommand,
  auth: {
    getTokenHash: () => webHostConfig.authTokenHash,
    getPairingCode: () => pairingCode,
    completePairing: async (authTokenHash) => {
      await invokeDesktopHostCommand('setWebHostAuthTokenHash', { authTokenHash });
      webHostConfig = (await loadConfig()).webHost;
      pairingCode = '';
      const current = webHost.getState();
      setDesktopWebHostRuntimeStatus({
        state: current.running ? 'running' : 'stopped',
        host,
        port,
        ...(current.url ? { url: current.url } : {}),
      });
    },
  },
  static: {
    root: path.join(__dirname, '..', 'dist'),
    spaFallback: true,
  },
});

const state = await webHost.start();
setDesktopWebHostRuntimeStatus({
  state: 'running',
  host: state.host,
  port: state.port,
  ...(state.url ? { url: state.url } : {}),
  ...(webHostConfig.authTokenHash ? {} : { pairingCode }),
});

if (!webHostConfig.authTokenHash) {
  console.log(`Spirit desktop web pairing code: ${pairingCode}`);
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void webHost.stop().finally(() => {
      setDesktopWebHostRuntimeStatus({
        state: 'stopped',
        host,
        port,
      });
      process.exit(0);
    });
  });
}
