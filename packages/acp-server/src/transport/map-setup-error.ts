import { RequestError } from '@agentclientprotocol/sdk';

/** Maps transport/session setup failures to ACP JSON-RPC errors. */
export function mapSessionSetupError(err: unknown): RequestError {
  const message = err instanceof Error ? err.message : String(err);
  if (
    message.includes('Run spirit-agent-acp --setup')
    || message.includes('Run --setup')
    || message.includes('No active model configured')
    || message.includes('No API key found')
    || message.includes('No Vertex credentials')
    || message.includes('requires a Bearer API key or IAM credentials')
    || message.includes('missing AWS region')
  ) {
    return RequestError.authRequired(undefined, message);
  }
  return RequestError.internalError(undefined, message);
}
