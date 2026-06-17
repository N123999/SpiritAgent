import { readFileSync } from 'node:fs';

import { confirm, input, password, select } from '@inquirer/prompts';
import {
  PROVIDER_PICKER_ROWS,
  listProviderModels,
  type ModelProviderId,
} from '@spirit-agent/host-internal';

import type { ProviderSetupResult } from '../credentials/types.js';
import {
  buildSetupProfile,
  listSiteOptions,
  providerNeedsSiteSelection,
  resolveProfileApiBase,
  resolveSetupTransportKind,
  siteNeedsWorkspaceId,
  validateApiKeyRequired,
  validateAzureSetup,
  validateBedrockCredentials,
  validateCustomSetup,
  validateModelName,
  validateVertexCredentials,
} from './provider-wizard.js';

async function promptModelId(
  provider: ModelProviderId,
  apiKey: string,
  profileDraft: ReturnType<typeof buildSetupProfile>,
  extras?: {
    accessKeyId?: string;
    secretAccessKey?: string;
    vertexClientEmail?: string;
    vertexPrivateKey?: string;
  },
): Promise<string> {
  const transportKind = resolveSetupTransportKind(provider, profileDraft.transportKind);
  const baseUrl = resolveProfileApiBase(profileDraft);

  let catalog: Array<{ id: string; displayName?: string }> = [];
  if (provider !== 'custom') {
    try {
      const listed = await listProviderModels({
        provider,
        transportKind,
        apiKey: apiKey.trim(),
        baseUrl,
        ...(profileDraft.awsRegion ? { awsRegion: profileDraft.awsRegion } : {}),
        ...(profileDraft.vertexProject ? { vertexProject: profileDraft.vertexProject } : {}),
        ...(profileDraft.vertexLocation ? { vertexLocation: profileDraft.vertexLocation } : {}),
        ...(extras?.accessKeyId ? { accessKeyId: extras.accessKeyId } : {}),
        ...(extras?.secretAccessKey ? { secretAccessKey: extras.secretAccessKey } : {}),
        ...(extras?.vertexClientEmail ? { vertexClientEmail: extras.vertexClientEmail } : {}),
        ...(extras?.vertexPrivateKey ? { vertexPrivateKey: extras.vertexPrivateKey } : {}),
      });
      catalog = listed.map((entry) => ({
        id: entry.id,
        ...(entry.displayName ? { displayName: entry.displayName } : {}),
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[acp-server] Could not fetch model catalog: ${message}`);
    }
  }

  if (catalog.length > 0) {
    const choice = await select({
      message: 'Select a model',
      choices: [
        ...catalog.slice(0, 40).map((entry) => ({
          name: entry.displayName ? `${entry.id} — ${entry.displayName}` : entry.id,
          value: entry.id,
        })),
        { name: 'Enter model ID manually', value: '__manual__' },
      ],
    });
    if (choice !== '__manual__') {
      return choice;
    }
  }

  const modelName = await input({
    message: provider === 'azure' ? 'Azure deployment name' : 'Model ID',
    validate: (value) => validateModelName(value) ?? true,
  });
  return modelName.trim();
}

async function collectBedrockCredentials(): Promise<{
  apiKey?: string;
  bedrock: NonNullable<ProviderSetupResult['bedrock']>;
  awsRegion: string;
}> {
  const awsRegion = await input({
    message: 'AWS region (e.g. us-east-1)',
    validate: (value) => (value.trim() ? true : 'Region is required.'),
  });
  const authMode = await select({
    message: 'Bedrock authentication',
    choices: [
      { name: 'API key (Bearer)', value: 'api_key' as const },
      { name: 'IAM access key', value: 'iam' as const },
    ],
  });

  if (authMode === 'api_key') {
    const apiKey = await password({
      message: 'Bedrock API key',
      mask: '*',
      validate: (value) => (value.trim() ? true : 'API key is required.'),
    });
    const bedrock = { apiKey: apiKey.trim(), awsRegion: awsRegion.trim() };
    const error = validateBedrockCredentials(bedrock);
    if (error) {
      throw new Error(error);
    }
    return { apiKey: apiKey.trim(), bedrock, awsRegion: awsRegion.trim() };
  }

  const accessKeyId = await input({
    message: 'AWS access key ID',
    validate: (value) => (value.trim() ? true : 'Access key ID is required.'),
  });
  const secretAccessKey = await password({
    message: 'AWS secret access key',
    mask: '*',
    validate: (value) => (value.trim() ? true : 'Secret access key is required.'),
  });
  const bedrock = {
    accessKeyId: accessKeyId.trim(),
    secretAccessKey: secretAccessKey.trim(),
    awsRegion: awsRegion.trim(),
  };
  const error = validateBedrockCredentials(bedrock);
  if (error) {
    throw new Error(error);
  }
  return { bedrock, awsRegion: awsRegion.trim() };
}

async function collectVertexCredentials(): Promise<{
  apiKey?: string;
  vertex: NonNullable<ProviderSetupResult['vertex']>;
  vertexProject: string;
  vertexLocation: string;
}> {
  const vertexProject = await input({
    message: 'GCP project ID',
    validate: (value) => (value.trim() ? true : 'Project ID is required.'),
  });
  const vertexLocation = await input({
    message: 'GCP location (e.g. us-central1)',
    validate: (value) => (value.trim() ? true : 'Location is required.'),
  });
  const authMode = await select({
    message: 'Vertex authentication',
    choices: [
      { name: 'API key', value: 'api_key' as const },
      { name: 'Service account', value: 'service_account' as const },
    ],
  });

  if (authMode === 'api_key') {
    const apiKey = await password({
      message: 'Vertex API key',
      mask: '*',
      validate: (value) => (value.trim() ? true : 'API key is required.'),
    });
    const vertex = {
      apiKey: apiKey.trim(),
      vertexProject: vertexProject.trim(),
      vertexLocation: vertexLocation.trim(),
    };
    const error = validateVertexCredentials(vertex);
    if (error) {
      throw new Error(error);
    }
    return {
      apiKey: apiKey.trim(),
      vertex: { apiKey: apiKey.trim() },
      vertexProject: vertexProject.trim(),
      vertexLocation: vertexLocation.trim(),
    };
  }

  const clientEmail = await input({
    message: 'Service account client email',
    validate: (value) => (value.trim() ? true : 'Client email is required.'),
  });
  const keySource = await select({
    message: 'Private key input',
    choices: [
      { name: 'Paste PEM private key', value: 'paste' as const },
      { name: 'Path to service account JSON', value: 'file' as const },
    ],
  });
  let privateKey = '';
  if (keySource === 'file') {
    const jsonPath = await input({
      message: 'Path to service account JSON file',
      validate: (value) => (value.trim() ? true : 'Path is required.'),
    });
    const raw = readFileSync(jsonPath.trim(), 'utf8');
    const parsed = JSON.parse(raw) as { private_key?: string; client_email?: string };
    privateKey = parsed.private_key?.trim() ?? '';
    if (!privateKey) {
      throw new Error('Service account JSON is missing private_key.');
    }
  } else {
    privateKey = await input({
      message: 'Paste private key (PEM)',
      validate: (value) => (value.trim() ? true : 'Private key is required.'),
    });
  }

  const vertex = {
    clientEmail: clientEmail.trim(),
    privateKey: privateKey.trim(),
  };
  const error = validateVertexCredentials({
    clientEmail: vertex.clientEmail,
    privateKey: vertex.privateKey,
    vertexProject: vertexProject.trim(),
    vertexLocation: vertexLocation.trim(),
  });
  if (error) {
    throw new Error(error);
  }
  return {
    vertex,
    vertexProject: vertexProject.trim(),
    vertexLocation: vertexLocation.trim(),
  };
}

export async function runProviderWizard(): Promise<ProviderSetupResult> {
  const provider = await select({
    message: 'LLM provider',
    choices: PROVIDER_PICKER_ROWS.map((row) => ({
      name: row.fallbackLabel,
      value: row.id,
    })),
  });

  let providerSite: string | undefined;
  if (providerNeedsSiteSelection(provider)) {
    providerSite = await select({
      message: 'Provider region / site',
      choices: listSiteOptions(provider),
    });
  }

  let alibabaWorkspaceId: string | undefined;
  if (provider === 'alibaba' && providerSite && siteNeedsWorkspaceId(provider, providerSite)) {
    alibabaWorkspaceId = await input({
      message: 'Alibaba workspace ID',
      validate: (value) => (value.trim() ? true : 'Workspace ID is required for this region.'),
    });
  }

  let apiKey = '';
  let bedrock: ProviderSetupResult['bedrock'];
  let vertex: ProviderSetupResult['vertex'];
  let awsRegion: string | undefined;
  let azureResourceName: string | undefined;
  let vertexProject: string | undefined;
  let vertexLocation: string | undefined;
  let apiBaseOverride: string | undefined;

  if (provider === 'amazon-bedrock') {
    const collected = await collectBedrockCredentials();
    bedrock = collected.bedrock;
    apiKey = collected.apiKey ?? '';
    awsRegion = collected.awsRegion;
  } else if (provider === 'google-vertex-ai') {
    const collected = await collectVertexCredentials();
    vertex = collected.vertex;
    apiKey = collected.apiKey ?? '';
    vertexProject = collected.vertexProject;
    vertexLocation = collected.vertexLocation;
  } else if (provider === 'azure') {
    azureResourceName = await input({
      message: 'Azure OpenAI resource name',
      validate: (value) => (value.trim() ? true : 'Resource name is required.'),
    });
    apiKey = await password({
      message: 'Azure API key',
      mask: '*',
      validate: (value) => (value.trim() ? true : 'API key is required.'),
    });
  } else if (provider === 'custom') {
    apiBaseOverride = await input({
      message: 'API base URL',
      validate: (value) => (value.trim() ? true : 'API base URL is required.'),
    });
    apiKey = await password({
      message: 'API key',
      mask: '*',
      validate: (value) => (value.trim() ? true : 'API key is required.'),
    });
  } else {
    apiKey = await password({
      message: 'API key',
      mask: '*',
      validate: (value) => validateApiKeyRequired(provider, value) ?? true,
    });
  }

  const draftProfile = buildSetupProfile({
    provider,
    modelName: 'placeholder',
    ...(providerSite ? { providerSite } : {}),
    ...(alibabaWorkspaceId ? { alibabaWorkspaceId } : {}),
    ...(awsRegion ? { awsRegion } : {}),
    ...(azureResourceName ? { azureResourceName } : {}),
    ...(vertexProject ? { vertexProject } : {}),
    ...(vertexLocation ? { vertexLocation } : {}),
    ...(apiBaseOverride ? { apiBaseOverride } : {}),
  });

  const modelName = await promptModelId(provider, apiKey, draftProfile, {
    ...(bedrock?.accessKeyId ? { accessKeyId: bedrock.accessKeyId } : {}),
    ...(bedrock?.secretAccessKey ? { secretAccessKey: bedrock.secretAccessKey } : {}),
    ...(vertex?.clientEmail ? { vertexClientEmail: vertex.clientEmail } : {}),
    ...(vertex?.privateKey ? { vertexPrivateKey: vertex.privateKey } : {}),
  });

  if (provider === 'azure') {
    const azureError = validateAzureSetup({
      ...(azureResourceName ? { azureResourceName } : {}),
      apiKey,
      modelName,
    });
    if (azureError) {
      throw new Error(azureError);
    }
  }
  if (provider === 'custom') {
    const customError = validateCustomSetup({
      ...(apiBaseOverride ? { apiBase: apiBaseOverride } : {}),
      apiKey,
      modelName,
    });
    if (customError) {
      throw new Error(customError);
    }
  }

  const profile = buildSetupProfile({
    provider,
    modelName,
    ...(providerSite ? { providerSite } : {}),
    ...(alibabaWorkspaceId ? { alibabaWorkspaceId } : {}),
    ...(awsRegion ? { awsRegion } : {}),
    ...(azureResourceName ? { azureResourceName } : {}),
    ...(vertexProject ? { vertexProject } : {}),
    ...(vertexLocation ? { vertexLocation } : {}),
    ...(apiBaseOverride ? { apiBaseOverride } : {}),
  });

  const confirmed = await confirm({
    message: `Save ${profile.name} (${provider}) as the active model?`,
    default: true,
  });
  if (!confirmed) {
    throw new Error('Setup cancelled.');
  }

  const result: ProviderSetupResult = {
    profile,
    providerScope: provider,
  };
  if (apiKey.trim()) {
    result.apiKey = apiKey.trim();
  }
  if (bedrock) {
    result.bedrock = bedrock;
  }
  if (vertex) {
    result.vertex = vertex;
  }
  return result;
}
