import type { ModelProviderId, ProviderModelTransportKind } from '@spirit-agent/host-internal';

export type SpiritModelCapability = 'chat' | 'image' | 'video' | 'imageGeneration' | 'videoGeneration';

export type SpiritModelReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

/** Subset of Desktop `ModelProfileSnapshot` used by ACP setup and transport resolution. */
export interface SpiritModelProfile {
  name: string;
  apiBase: string;
  reasoningEffort?: SpiritModelReasoningEffort;
  supportedReasoningEfforts?: SpiritModelReasoningEffort[];
  capabilities?: SpiritModelCapability[];
  provider?: ModelProviderId;
  transportKind?: ProviderModelTransportKind;
  providerSite?: string;
  alibabaWorkspaceId?: string;
  awsRegion?: string;
  azureResourceName?: string;
  vertexProject?: string;
  vertexLocation?: string;
  contextLength?: number;
}

/** Minimal `config.json` fields read/written by ACP; other Desktop fields are preserved on merge. */
export interface SpiritConfigFile {
  models: SpiritModelProfile[];
  activeModel: string;
  [key: string]: unknown;
}

export interface BedrockSetupCredentials {
  apiKey?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
}

export interface GoogleVertexSetupCredentials {
  apiKey?: string;
  clientEmail?: string;
  privateKey?: string;
}

/** Result collected by the setup wizard before persistence. */
export interface ProviderSetupResult {
  profile: SpiritModelProfile;
  providerScope: ModelProviderId;
  apiKey?: string;
  bedrock?: BedrockSetupCredentials;
  vertex?: GoogleVertexSetupCredentials;
}
