import { JsonRpcPeer } from '@spirit-agent/core/host-bridge';
import { PassThrough } from 'node:stream';

/**
 * Creates a no-op JsonRpcPeer that does not bind to any real stdin/stdout.
 *
 * In ACP server mode, stdio is occupied by the ndJSON transport.
 * Tool execution is handled locally via NodeHostToolService (setLocalHostService),
 * so the peer's `call()` method should never be invoked during normal operation.
 *
 * The PassThrough streams are used as dummy placeholders to satisfy the
 * JsonRpcPeer constructor signature without binding to process.stdin/stdout.
 */
export function createNoopPeer(): JsonRpcPeer {
  const dummyInput = new PassThrough();
  const dummyOutput = new PassThrough();
  // Immediately end the input so it doesn't hang
  dummyInput.end();
  // Swallow any output
  dummyOutput.resume();
  const peer = new JsonRpcPeer(dummyInput, dummyOutput);
  // Intentionally NOT calling peer.start() to avoid any data processing
  return peer;
}
