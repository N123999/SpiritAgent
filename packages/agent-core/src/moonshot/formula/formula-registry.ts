import type { FormulaUri } from './formula-types.js';

export const MOONSHOT_FORMULA_WEB_SEARCH_URI = 'moonshot/web-search:latest' as const satisfies FormulaUri;

export const MOONSHOT_FORMULA_WEB_SEARCH_FUNCTION_NAME = 'web_search' as const;

export type MoonshotFormulaRegistration = {
  formulaUri: FormulaUri;
  functionName: string;
};

const MOONSHOT_FORMULA_REGISTRATIONS: readonly MoonshotFormulaRegistration[] = [
  {
    formulaUri: MOONSHOT_FORMULA_WEB_SEARCH_URI,
    functionName: MOONSHOT_FORMULA_WEB_SEARCH_FUNCTION_NAME,
  },
];

const functionNameToFormulaUri = new Map<string, FormulaUri>(
  MOONSHOT_FORMULA_REGISTRATIONS.map((entry) => [entry.functionName, entry.formulaUri]),
);

export function listMoonshotFormulaRegistrations(): readonly MoonshotFormulaRegistration[] {
  return MOONSHOT_FORMULA_REGISTRATIONS;
}

export function resolveMoonshotFormulaUri(functionName: string): FormulaUri | undefined {
  return functionNameToFormulaUri.get(functionName);
}

export function isRegisteredMoonshotFormulaFunctionName(functionName: string): boolean {
  return functionNameToFormulaUri.has(functionName);
}
