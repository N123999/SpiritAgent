// 后续：设置页 / SPIRIT_LSP_* 环境变量覆盖 server 启动命令。

export interface LspTimingConfig {
  diagnosticsWaitMs: number;
  writeAppendDiagnosticsWaitMs: number;
  syncDebounceMs: number;
}

export const DEFAULT_LSP_TIMING: LspTimingConfig = {
  diagnosticsWaitMs: 4_000,
  // 写后 append 需等 TLS publishDiagnostics；1.5s 实测常拿不到结果，与 agent 主动 get_diagnostics 对齐为 4s
  writeAppendDiagnosticsWaitMs: 4_000,
  syncDebounceMs: 300,
};
