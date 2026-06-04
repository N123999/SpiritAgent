import { APPEND_DIAGNOSTICS_AFTER_WRITES, HOST_WRITE_TOOL_NAMES } from './constants.js';
import { DEFAULT_LSP_TIMING } from './config.js';
import { formatDiagnosticsSummaryBlock } from './format-diagnostics.js';
import { isTypescriptJavascriptPath, resolveWorkspaceFilePath } from './paths.js';
import type { LspService } from './service.js';
import type { JsonValue } from '../ports.js';
import type { ToolExecutionOutput } from '../ports.js';

export async function appendLspDiagnosticsAfterWriteIfNeeded(
  lsp: LspService | undefined,
  request: JsonValue,
  output: ToolExecutionOutput,
): Promise<ToolExecutionOutput> {
  if (!APPEND_DIAGNOSTICS_AFTER_WRITES || !lsp?.enabled) {
    return output;
  }

  const resolvedPath = resolvedPathFromWriteRequest(lsp.workspaceRoot, request);
  if (!resolvedPath || !isTypescriptJavascriptPath(resolvedPath)) {
    return output;
  }

  try {
    const diagnostics = await lsp.getDiagnosticsForPath(
      resolvedPath,
      DEFAULT_LSP_TIMING.writeAppendDiagnosticsWaitMs,
    );
    const block = formatDiagnosticsSummaryBlock(diagnostics.relativePath, diagnostics.diagnostics);
    if (!block) {
      return output;
    }
    const summaryText = `${output.summaryText ?? ''}${block}`.trim();
    return {
      ...output,
      summaryText,
      content: output.content.map((part) => {
        if (part.type !== 'text') {
          return part;
        }
        return { type: 'text', text: `${part.text}${block}` };
      }),
    };
  } catch {
    const note = '\n\n[lsp]\n(diagnostics pending or timed out)';
    return {
      ...output,
      summaryText: `${output.summaryText ?? ''}${note}`.trim(),
      content: output.content.map((part) => {
        if (part.type !== 'text') {
          return part;
        }
        return { type: 'text', text: `${part.text}${note}` };
      }),
    };
  }
}

function resolvedPathFromWriteRequest(workspaceRoot: string, request: JsonValue): string | undefined {
  if (typeof request !== 'object' || request === null || Array.isArray(request)) {
    return undefined;
  }
  const record = request as Record<string, unknown>;
  const name = typeof record.name === 'string' ? record.name : '';
  if (!HOST_WRITE_TOOL_NAMES.has(name)) {
    return undefined;
  }
  if (name === 'apply_patch') {
    const operation = record.operation;
    if (typeof operation !== 'object' || operation === null || Array.isArray(operation)) {
      return undefined;
    }
    const pathValue = (operation as Record<string, unknown>).path;
    if (typeof pathValue !== 'string') {
      return undefined;
    }
    try {
      return resolveWorkspaceFilePath(workspaceRoot, pathValue);
    } catch {
      return undefined;
    }
  }
  const pathValue = record.path;
  if (typeof pathValue !== 'string') {
    return undefined;
  }
  try {
    return resolveWorkspaceFilePath(workspaceRoot, pathValue);
  } catch {
    return undefined;
  }
}
