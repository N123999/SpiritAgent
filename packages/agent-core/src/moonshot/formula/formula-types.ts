import type { JsonObject } from '../../ports.js';

/** Moonshot Formula semantic URI, e.g. `moonshot/web-search:latest`. */
export type FormulaUri = string;

export type FormulaToolDefinition = {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters?: JsonObject;
  };
};

export type FormulaToolsListResponse = {
  object?: string;
  tools?: FormulaToolDefinition[];
};

export type FormulaFiberContext = {
  input?: string;
  output?: string;
  encrypted_output?: string;
  error?: string;
};

export type FormulaFiberResponse = {
  id?: string;
  object?: string;
  status?: string;
  context?: FormulaFiberContext;
  formula?: FormulaUri;
  error?: string;
};

export type FormulaFiberInvokeResult =
  | { kind: 'succeeded'; content: string }
  | { kind: 'failed'; error: string };
