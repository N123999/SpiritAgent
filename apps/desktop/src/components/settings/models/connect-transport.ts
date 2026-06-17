import i18n from "@/lib/i18n";
import type { DesktopModelProvider, DesktopTransportKind } from "@/types";

export type ConnectTransportOption = {
  value: DesktopTransportKind;
  label: string;
  summaryKey?: string;
};

export const connectTransportOptionCatalog = {
  chatCompletions: {
    value: "openai-compatible" as const,
    label: "Chat Completions API",
  },
  messagesApi: {
    value: "anthropic" as const,
    label: "Messages API",
  },
  bedrockApi: {
    value: "bedrock" as const,
    label: "Amazon Bedrock",
  },
  responsesApi: {
    value: "open-responses" as const,
    label: "Responses API",
    summaryKey: 'settings.transportResponsesApi',
  },
  openResponsesApi: {
    value: "open-responses" as const,
    label: "Open Responses API",
  },
} satisfies Record<string, ConnectTransportOption>;

export function connectTransportOptionsForProvider(provider: DesktopModelProvider): ConnectTransportOption[] {
  switch (provider) {
    case "openai":
    case "xai":
      return [connectTransportOptionCatalog.chatCompletions, connectTransportOptionCatalog.responsesApi];
    case "google":
    case "google-vertex-ai":
      return [connectTransportOptionCatalog.chatCompletions];
    case "minimax":
    case "deepseek":
    case "xiaomi":
    case "siliconflow":
      return [connectTransportOptionCatalog.chatCompletions, connectTransportOptionCatalog.messagesApi];
    case "alibaba":
      return [
        connectTransportOptionCatalog.chatCompletions,
        connectTransportOptionCatalog.messagesApi,
        connectTransportOptionCatalog.openResponsesApi,
      ];
    case "openrouter":
    case "custom":
      return [
        connectTransportOptionCatalog.chatCompletions,
        connectTransportOptionCatalog.openResponsesApi,
        connectTransportOptionCatalog.messagesApi,
      ];
    case "volcengine":
      return [
        connectTransportOptionCatalog.chatCompletions,
        { ...connectTransportOptionCatalog.responsesApi, summaryKey: undefined },
      ];
    case "amazon-bedrock":
      return [connectTransportOptionCatalog.bedrockApi];
    case "azure":
      return [];
    default:
      return [];
  }
}

export function defaultConnectTransportKind(provider: DesktopModelProvider): DesktopTransportKind {
  if (provider === "vercel-ai-gateway") {
    return "open-responses";
  }
  if (provider === "amazon-bedrock") {
    return "bedrock";
  }
  if (provider === "azure") {
    return "open-responses";
  }

  return connectTransportOptionsForProvider(provider)[0]?.value ?? "openai-compatible";
}

export function providerSupportsConnectTransportPicker(
  provider: DesktopModelProvider | null,
): provider is DesktopModelProvider {
  return (
    provider === "openai" ||
    provider === "xai" ||
    provider === "minimax" ||
    provider === "deepseek" ||
    provider === "xiaomi" ||
    provider === "siliconflow" ||
    provider === "alibaba" ||
    provider === "custom" ||
    provider === "openrouter" ||
    provider === "volcengine"
  );
}

export function providerShowsConnectTransportPicker(provider: DesktopModelProvider | null): boolean {
  return provider !== null
    && provider !== "vercel-ai-gateway"
    && providerSupportsConnectTransportPicker(provider);
}

export function resolveConnectTransportKindForProvider(
  provider: DesktopModelProvider | null,
  connectTransportKind: DesktopTransportKind,
): DesktopTransportKind | undefined {
  if (provider === "vercel-ai-gateway") {
    return "open-responses";
  }
  if (provider === "amazon-bedrock") {
    return "bedrock";
  }
  if (provider === "azure") {
    return "open-responses";
  }

  if (provider === null || !providerSupportsConnectTransportPicker(provider)) {
    return undefined;
  }

  return connectTransportKind;
}

export function connectTransportOptionSummary(
  option: ConnectTransportOption,
  provider: DesktopModelProvider | null,
): string | undefined {
  if (option.value === "open-responses" && provider === "xai") {
    return i18n.t('settings.transportXaiResponses');
  }

  if (option.value === "open-responses" && provider === "alibaba") {
    return i18n.t('settings.transportAlibabaResponses');
  }

  return option.summaryKey ? i18n.t(option.summaryKey) : undefined;
}

export function resolveCustomConnectApiBase(customApiBase: string): string {
  return customApiBase.trim();
}
