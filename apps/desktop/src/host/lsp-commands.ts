import { spawn } from 'node:child_process';

import { findLspProvider } from '@spirit-agent/agent-core';

import type { DesktopSnapshot, InstallLspProviderRequest } from '../types.js';
import { buildDesktopLspSnapshot } from './lsp-snapshot.js';
import type { HostModelCommandContext } from './host-model-commands.js';

function runNpmGlobalInstall(packageName: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('npm', ['install', '-g', packageName], {
      shell: process.platform === 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stderr = '';
    child.stderr?.on('data', (chunk: Buffer | string) => {
      stderr += String(chunk);
    });

    child.on('error', (error) => {
      reject(error);
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(stderr.trim() || `npm install -g ${packageName} failed with exit code ${code ?? 'unknown'}`));
    });
  });
}

export async function installLspProviderCommand(
  ctx: HostModelCommandContext,
  request: InstallLspProviderRequest,
): Promise<DesktopSnapshot> {
  return ctx.runSerialized(async () => {
    await ctx.ensureInitialized();
    const provider = findLspProvider(request.providerId.trim());
    if (!provider) {
      throw new Error(`Unknown LSP provider: ${request.providerId}`);
    }

    await runNpmGlobalInstall(provider.npmPackage);
    await ctx.disposeAllLspServices();
    ctx.invalidateToolExecutors();
    await ctx.refreshLspSnapshot();

    const wasBusy = ctx.isRuntimeBusy();
    if (wasBusy) {
      ctx.activeBundle().deferredRuntimeRefreshWhileBusy = true;
    } else {
      ctx.activeBundle().deferredRuntimeRefreshWhileBusy = false;
      await ctx.refreshRuntime();
    }
    await ctx.flushDeferredRuntimeRefreshIfIdle();
    return ctx.buildSnapshot();
  });
}
