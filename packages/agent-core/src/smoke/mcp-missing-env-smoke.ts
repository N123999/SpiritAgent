import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { McpService } from '../mcp/service.js';

const MISSING_ENV_NAME = 'SPIRIT_AGENT_MCP_MISSING_ENV_SMOKE_TOKEN';

runMcpMissingEnvSmoke().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`mcp missing env smoke failed: ${message}`);
  process.exitCode = 1;
});

async function runMcpMissingEnvSmoke(): Promise<void> {
  const tempRoot = await mkdtemp(join(tmpdir(), 'spirit-agent-mcp-missing-env-'));
  const originalAppData = process.env.APPDATA;
  const originalUserProfile = process.env.USERPROFILE;
  const originalMissingEnv = process.env[MISSING_ENV_NAME];

  try {
    const appData = join(tempRoot, 'AppData');
    const dataDir = join(appData, 'SpiritAgent');
    await mkdir(dataDir, { recursive: true });
    await writeFile(
      join(dataDir, 'mcp.json'),
      JSON.stringify(
        {
          servers: {
            smoke: {
              transport: {
                type: 'http',
                url: 'https://example.invalid/mcp',
                headers: {
                  Authorization: `Bearer ${'${env:' + MISSING_ENV_NAME + '}'}`,
                },
              },
            },
          },
        },
        null,
        2,
      ),
      'utf8',
    );

    process.env.APPDATA = appData;
    delete process.env.USERPROFILE;
    delete process.env[MISSING_ENV_NAME];

    const service = new McpService(process.cwd());
    service.startBackgroundRefreshInBackground(true);

    const backgroundSnapshot = await waitForSnapshot(
      service,
      (snapshot) => snapshot.state === 'error',
      'background refresh should degrade into MCP error state',
    );

    if (backgroundSnapshot.configuredServers !== 1) {
      throw new Error(
        `background refresh 应保留 1 个配置服务器，实际为 ${backgroundSnapshot.configuredServers}`,
      );
    }
    if (!backgroundSnapshot.lastError?.includes(`缺少环境变量 ${MISSING_ENV_NAME}`)) {
      throw new Error(
        `background refresh 错误信息不正确: ${backgroundSnapshot.lastError ?? '<none>'}`,
      );
    }
    if (service.toolDefinitionsJson().length !== 0) {
      throw new Error('background refresh 失败后不应保留任何 MCP 工具定义。');
    }

    let explicitError: unknown;
    try {
      await service.ensureToolingCache();
    } catch (error) {
      explicitError = error;
    }

    if (!(explicitError instanceof Error) || !explicitError.message.includes(MISSING_ENV_NAME)) {
      throw new Error('显式等待 ensureToolingCache() 时应继续暴露缺失环境变量错误。');
    }

    const explicitSnapshot = service.statusSnapshot();
    if (explicitSnapshot.state !== 'error') {
      throw new Error(`显式等待失败后 MCP 状态应保持 error，实际为 ${explicitSnapshot.state}`);
    }

    console.log('mcp missing env smoke OK', explicitSnapshot);
  } finally {
    restoreEnv('APPDATA', originalAppData);
    restoreEnv('USERPROFILE', originalUserProfile);
    restoreEnv(MISSING_ENV_NAME, originalMissingEnv);
    await rm(tempRoot, { recursive: true, force: true });
  }
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}

async function waitForSnapshot(
  service: McpService,
  predicate: (snapshot: ReturnType<McpService['statusSnapshot']>) => boolean,
  description: string,
): Promise<ReturnType<McpService['statusSnapshot']>> {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const snapshot = service.statusSnapshot();
    if (predicate(snapshot)) {
      return snapshot;
    }

    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  throw new Error(`${description}; final snapshot=${JSON.stringify(service.statusSnapshot())}`);
}