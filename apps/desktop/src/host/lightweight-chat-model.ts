import type { ModelProfileSnapshot } from '../types.js';

export type LightweightChatModelResolveInput = {
  activeModel: string;
  lightweightChatModel?: string;
  models: ModelProfileSnapshot[];
};

export const LIGHTWEIGHT_CHAT_MODEL_FALLBACK_PATTERNS = ['deepseek-v4-flash'] as const;

export function modelSupportsChat(model: ModelProfileSnapshot): boolean {
  return model.capabilities === undefined || model.capabilities.includes('chat');
}

export function normalizeLightweightChatModel(
  value: unknown,
  models: readonly ModelProfileSnapshot[],
): string | undefined {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return undefined;
  }

  const modelName = value.trim();
  const profile = models.find((model) => model.name === modelName);
  return profile && modelSupportsChat(profile) ? profile.name : undefined;
}

export function resolveLightweightChatModelName(config: LightweightChatModelResolveInput): string {
  const explicit = normalizeLightweightChatModel(config.lightweightChatModel, config.models);
  if (explicit) {
    return explicit;
  }

  for (const pattern of LIGHTWEIGHT_CHAT_MODEL_FALLBACK_PATTERNS) {
    const lowerPattern = pattern.toLowerCase();
    const match = config.models.find(
      (model) => modelSupportsChat(model) && model.name.toLowerCase().includes(lowerPattern),
    );
    if (match) {
      return match.name;
    }
  }

  return config.activeModel;
}

export function resolveLightweightChatModelProfile(
  config: LightweightChatModelResolveInput,
): { name: string; profile: ModelProfileSnapshot } | null {
  const name = resolveLightweightChatModelName(config).trim();
  if (!name) {
    return null;
  }

  const profile = config.models.find((model) => model.name === name);
  if (!profile || !modelSupportsChat(profile)) {
    return null;
  }

  return { name, profile };
}
