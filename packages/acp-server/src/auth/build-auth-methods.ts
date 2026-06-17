import type * as schema from '@agentclientprotocol/sdk';

import {
  TERMINAL_AUTH_ARGS,
  TERMINAL_AUTH_DESCRIPTION,
  TERMINAL_AUTH_METHOD_ID,
  TERMINAL_AUTH_NAME,
} from './constants.js';

/** Terminal Auth method advertised during initialize. */
export function buildTerminalAuthMethod(): schema.AuthMethod {
  return {
    id: TERMINAL_AUTH_METHOD_ID,
    name: TERMINAL_AUTH_NAME,
    description: TERMINAL_AUTH_DESCRIPTION,
    type: 'terminal',
    args: [...TERMINAL_AUTH_ARGS],
  };
}

export function buildAuthMethods(): schema.AuthMethod[] {
  return [buildTerminalAuthMethod()];
}
