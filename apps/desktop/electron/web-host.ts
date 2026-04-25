import { invokeDesktopHostCommand } from '../src/host/service.js';
import { setDesktopWebHostRuntimeStatus } from '../src/host/web-host-state.js';
import { createDesktopHttpHost, resolveDesktopWebHostFromEnv } from './http-host.js';

const { host, port } = resolveDesktopWebHostFromEnv();
const webHost = createDesktopHttpHost({
  host,
  port,
  invokeHostCommand: invokeDesktopHostCommand,
});

const state = await webHost.start();
setDesktopWebHostRuntimeStatus({
  state: 'running',
  host: state.host,
  port: state.port,
  ...(state.url ? { url: state.url } : {}),
});

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
