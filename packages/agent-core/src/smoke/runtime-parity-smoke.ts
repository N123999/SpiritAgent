import { runRuntimeParitySmoke } from './cases/runtime/runtime-parity-case.js';

runRuntimeParitySmoke().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`runtime parity smoke failed: ${message}`);
  process.exitCode = 1;
});