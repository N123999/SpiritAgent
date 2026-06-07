// Desktop 首批消费方：首条用户消息后异步生成会话标题；CLI 待产品定义后再接入。
import { createJsonSchemaTransport } from '@spirit-agent/core';
import {
  buildSessionTitlePrompt,
  normalizeGeneratedSessionTitle,
  SESSION_TITLE_JSON_SCHEMA,
} from '@spirit-agent/host-internal';

import { resolveLightweightChatModelProfile } from './lightweight-chat-model.js';
import { buildPrimaryTransportConfig } from './model-config.js';
import { currentApiBase } from './service-utils.js';
import type { DesktopConfigFile } from './storage.js';
import { resolveApiKeyForConfigModel } from './storage.js';

export type GeneratedSessionTitle = {
  title: string;
  modelName: string;
};

type SessionTitleGenerationContext = {
  config: DesktopConfigFile;
  workspaceRoot: string;
  firstUserMessage: string;
  fallbackSeedTitle: string;
};

export async function generateSessionTitleFromModelTask(
  context: SessionTitleGenerationContext,
): Promise<GeneratedSessionTitle> {
  const resolved = resolveLightweightChatModelProfile(context.config);
  if (!resolved) {
    throw new Error('Lightweight chat model is not available.');
  }

  const apiKey = await resolveApiKeyForConfigModel(context.config, resolved.name);
  if (!apiKey) {
    throw new Error(`API key is not configured for lightweight chat model: ${resolved.name}`);
  }

  const transportConfig = buildPrimaryTransportConfig({
    apiKey,
    model: resolved.name,
    baseUrl: resolved.profile.apiBase ?? currentApiBase(context.config),
    workspaceRoot: context.workspaceRoot,
    profile: resolved.profile,
  });
  const transport = createJsonSchemaTransport(transportConfig);
  const userPrompt = buildSessionTitlePrompt(context.firstUserMessage);
  const result = await transport.createJsonSchemaCompletion<{ title: string }>(
    transportConfig,
    {
      userPrompt,
      schemaName: 'session_title',
      schema: SESSION_TITLE_JSON_SCHEMA,
    },
  );

  return {
    title: normalizeGeneratedSessionTitle(result.output.title, context.fallbackSeedTitle),
    modelName: resolved.name,
  };
}
