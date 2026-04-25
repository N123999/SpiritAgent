import { invokeDesktopHostCommand } from '../src/host/service.js';
import { createDesktopHttpHost, resolveDesktopWebHostFromEnv } from './http-host.js';

const { host, port } = resolveDesktopWebHostFromEnv();
const webHost = createDesktopHttpHost({
  host,
  port,
  invokeHostCommand: invokeDesktopHostCommand,
});

await webHost.start();

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void webHost.stop().finally(() => {
      process.exit(0);
    });
  });
}
