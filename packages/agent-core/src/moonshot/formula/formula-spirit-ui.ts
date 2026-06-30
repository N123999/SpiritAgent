import type { JsonObject } from '../../ports.js';
import { RESPONSES_BUILT_IN_SPIRIT_UI_KEY } from '../../open-responses/responses-built-in-tools.js';
import { isJsonObject } from '../../tool-agent.js';

export const MOONSHOT_FORMULA_SPIRIT_UI_SUPPRESS_EXPAND_KEY = 'suppressExpand';

export type MoonshotFormulaSpiritUi = {
  inputExcerpt: string;
  headlineDetail?: string;
  suppressExpand: true;
};

export function buildMoonshotFormulaWebSearchSpiritUi(query: string): MoonshotFormulaSpiritUi {
  const trimmedQuery = query.trim();
  return {
    inputExcerpt: trimmedQuery.length > 0 ? trimmedQuery : 'Web search',
    ...(trimmedQuery.length > 0 ? { headlineDetail: trimmedQuery } : {}),
    suppressExpand: true,
  };
}

export function buildMoonshotFormulaToolPreviewArgumentsJson(input: {
  query?: string;
  status?: string;
  failed?: boolean;
}): string {
  const query = typeof input.query === 'string' ? input.query.trim() : '';
  const spiritUi = buildMoonshotFormulaWebSearchSpiritUi(query);
  const payload: JsonObject = {
    status: input.failed ? 'failed' : (input.status ?? 'completed'),
    [RESPONSES_BUILT_IN_SPIRIT_UI_KEY]: spiritUi as JsonObject,
  };
  return JSON.stringify(payload);
}

export type ParsedMoonshotFormulaSpiritUi = {
  inputExcerpt: string;
  headlineDetail?: string;
  suppressExpand: boolean;
};

export function parseMoonshotFormulaSpiritUiFromArgumentsJson(
  argumentsJson: string,
): ParsedMoonshotFormulaSpiritUi | undefined {
  try {
    const parsed = JSON.parse(argumentsJson) as JsonObject;
    if (!isJsonObject(parsed)) {
      return undefined;
    }

    const raw = parsed[RESPONSES_BUILT_IN_SPIRIT_UI_KEY];
    if (!isJsonObject(raw as JsonObject)) {
      return undefined;
    }

    const ui = raw as JsonObject;
    const inputExcerpt = typeof ui.inputExcerpt === 'string' ? ui.inputExcerpt : '';
    if (!inputExcerpt.trim()) {
      return undefined;
    }

    const headlineDetail =
      typeof ui.headlineDetail === 'string' && ui.headlineDetail.trim()
        ? ui.headlineDetail.trim()
        : undefined;
    const suppressExpand = ui[MOONSHOT_FORMULA_SPIRIT_UI_SUPPRESS_EXPAND_KEY] === true;

    return {
      inputExcerpt,
      ...(headlineDetail ? { headlineDetail } : {}),
      suppressExpand,
    };
  } catch {
    return undefined;
  }
}

export function moonshotFormulaSpiritUiSuppressesExpand(argumentsJson: string): boolean {
  return parseMoonshotFormulaSpiritUiFromArgumentsJson(argumentsJson)?.suppressExpand === true;
}
