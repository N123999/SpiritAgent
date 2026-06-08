import type { HostApi } from '../host-api';
import type {
  AddModelRequest,
  AddMcpServerRequest,
  AddProviderModelsRequest,
  AskQuestionsResult,
  BootstrapRequest,
  CommitChangesRequest,
  GitHistorySnapshot,
  GitWorkingTreeSnapshot,
  ReadGitHistoryRequest,
  CreateRuleRequest,
  CreateSkillRequest,
  DeleteExtensionRequest,
  DeleteMcpServerRequest,
  DeleteRuleRequest,
  DesktopDreamOverviewItem,
  DesktopMarketplaceCatalogItem,
  DesktopMarketplaceDetail,
  DesktopMarketplacePreparedInstall,
  DeleteSkillRequest,
  DesktopMcpServerInspection,
  DesktopSnapshot,
  ImportExtensionRequest,
  InstallLspProviderRequest,
  InstallMarketplaceExtensionRequest,
  PrepareMarketplaceExtensionInstallRequest,
  RunExtensionRequest,
  UpdateExtensionSecretRequest,
  UpdateExtensionSettingsRequest,
  PreviewModelsRequest,
  PreviewModelsResponse,
  QueryWorkspaceFileReferenceSuggestionsRequest,
  RewindAndSubmitMessageRequest,
  SessionListItem,
  WorkspaceExplorerListResult,
  WorkspaceFileReferenceSuggestionsResponse,
  HostTextFileStatResult,
  WorkspaceReadTextFileResult,
  WriteHostTextFileRequest,
  WriteWorkspaceTextFileRequest,
  SubmitCreateRuleSlashRequest,
  SubmitCreateSkillSlashRequest,
  SubmitSkillSlashRequest,
  UpdateConfigRequest,
  DesktopModelProvider,
} from '../types';

const DEFAULT_HOST_URL =
  import.meta.env.VITE_SPIRIT_HOST_URL?.toString().trim() || '';
const WEB_HOST_TOKEN_STORAGE_KEY = 'spirit-agent-web-host-token';

type WebHostPairingResponse = {
  token: string;
};

export function createWebHostApi(): HostApi {
  const baseUrl = DEFAULT_HOST_URL || '';

  return {
    kind: 'web',
    bootstrap(request?: BootstrapRequest) {
      return post<DesktopSnapshot>(baseUrl, '/api/bootstrap', request ?? {});
    },
    commitChanges(request: CommitChangesRequest) {
      return post<DesktopSnapshot>(baseUrl, '/api/git/commit', request);
    },
    updateConfig(request: UpdateConfigRequest) {
      return post<DesktopSnapshot>(baseUrl, '/api/config', request);
    },
    installLspProvider(_request: InstallLspProviderRequest) {
      return Promise.reject(new Error('LSP provider install is only available in the desktop app.'));
    },
    addModel(request: AddModelRequest) {
      return post<DesktopSnapshot>(baseUrl, '/api/models', request);
    },
    addProviderModels(request: AddProviderModelsRequest) {
      return post<DesktopSnapshot>(baseUrl, '/api/models/add-provider', request);
    },
    previewModels(request: PreviewModelsRequest) {
      return post<PreviewModelsResponse>(baseUrl, '/api/models/preview', request);
    },
    removeModel(name: string) {
      return post<DesktopSnapshot>(baseUrl, '/api/models/remove', { name });
    },
    removeProviderModels(provider: DesktopModelProvider) {
      return post<DesktopSnapshot>(baseUrl, '/api/models/remove-provider', { provider });
    },
    addMcpServer(request: AddMcpServerRequest) {
      return post<DesktopSnapshot>(baseUrl, '/api/mcps', request);
    },
    deleteMcpServer(request: DeleteMcpServerRequest) {
      return post<DesktopSnapshot>(baseUrl, '/api/mcps/remove', request);
    },
    inspectMcpServer(name: string) {
      return post<DesktopMcpServerInspection>(baseUrl, '/api/mcps/inspect', { name });
    },
    importExtension(request: ImportExtensionRequest) {
      return post<DesktopSnapshot>(baseUrl, '/api/extensions', request);
    },
    listMarketplaceExtensions() {
      return get<DesktopMarketplaceCatalogItem[]>(baseUrl, '/api/marketplace/extensions');
    },
    getMarketplaceExtensionDetail(extensionId: string) {
      return post<DesktopMarketplaceDetail>(baseUrl, '/api/marketplace/extensions/detail', {
        extensionId,
      });
    },
    getMarketplaceExtensionReadme(extensionId: string) {
      return post<string>(baseUrl, '/api/marketplace/extensions/readme', { extensionId });
    },
    prepareMarketplaceExtensionInstall(request: PrepareMarketplaceExtensionInstallRequest) {
      return post<DesktopMarketplacePreparedInstall>(baseUrl, '/api/marketplace/extensions/prepare', request);
    },
    installMarketplaceExtension(request: InstallMarketplaceExtensionRequest) {
      return post<DesktopSnapshot>(baseUrl, '/api/marketplace/extensions/install', request);
    },
    deleteExtension(request: DeleteExtensionRequest) {
      return post<DesktopSnapshot>(baseUrl, '/api/extensions/remove', request);
    },
    runExtension(request: RunExtensionRequest) {
      return post<DesktopSnapshot>(baseUrl, '/api/extensions/run', request);
    },
    updateExtensionSettings(request: UpdateExtensionSettingsRequest) {
      return post<DesktopSnapshot>(baseUrl, '/api/extensions/settings', request);
    },
    updateExtensionSecret(request: UpdateExtensionSecretRequest) {
      return post<DesktopSnapshot>(baseUrl, '/api/extensions/secret', request);
    },
    createRule(request: CreateRuleRequest) {
      return post<DesktopSnapshot>(baseUrl, '/api/rules', request);
    },
    createSkill(request: CreateSkillRequest) {
      return post<DesktopSnapshot>(baseUrl, '/api/skills', request);
    },
    deleteRule(request: DeleteRuleRequest) {
      return post<DesktopSnapshot>(baseUrl, '/api/rules/remove', request);
    },
    deleteSkill(request: DeleteSkillRequest) {
      return post<DesktopSnapshot>(baseUrl, '/api/skills/remove', request);
    },
    submitCreateRuleSlash(request: SubmitCreateRuleSlashRequest) {
      return post<DesktopSnapshot>(baseUrl, '/api/rules/create-slash', request);
    },
    submitCreateSkillSlash(request: SubmitCreateSkillSlashRequest) {
      return post<DesktopSnapshot>(baseUrl, '/api/skills/create-slash', request);
    },
    submitSkillSlash(request: SubmitSkillSlashRequest) {
      return post<DesktopSnapshot>(baseUrl, '/api/skills/submit', request);
    },
    submitGitChip(request) {
      return post<DesktopSnapshot>(baseUrl, '/api/git/chip', request);
    },
    submitStartImplementing() {
      return post<DesktopSnapshot>(baseUrl, '/api/start-implementing');
    },
    compactHistory() {
      return post<DesktopSnapshot>(baseUrl, '/api/compact');
    },
    submitUserTurn(request) {
      return post<DesktopSnapshot>(baseUrl, '/api/submit', request);
    },
    setLoopEnabled(enabled: boolean) {
      return post<DesktopSnapshot>(baseUrl, '/api/loop', { enabled });
    },
    setApprovalLevel(approvalLevel: import('@spirit-agent/host-internal').ApprovalLevel) {
      return post<DesktopSnapshot>(baseUrl, '/api/approval', { approvalLevel });
    },
    setPendingGitBranch(branch: string) {
      return post<DesktopSnapshot>(baseUrl, '/api/git/pending-branch', { branch });
    },
    setWorkLocation(workLocation: import('@spirit-agent/host-internal').WorkLocationKind) {
      return post<DesktopSnapshot>(baseUrl, '/api/git/work-location', { workLocation });
    },
    checkoutGitBranch(request: import('../types.js').CheckoutGitBranchRequest) {
      return post<DesktopSnapshot>(baseUrl, '/api/git/checkout', request);
    },
    mergeWorktreeToMain() {
      return post<DesktopSnapshot>(baseUrl, '/api/git/merge-worktree');
    },
    pushGitBranch() {
      return post<DesktopSnapshot>(baseUrl, '/api/git/push');
    },
    refreshGitSnapshot() {
      return post<DesktopSnapshot>(baseUrl, '/api/git/refresh-snapshot', {});
    },
    readGitWorkingTree() {
      return post<GitWorkingTreeSnapshot>(baseUrl, '/api/git/working-tree', {});
    },
    readGitHistory(request: ReadGitHistoryRequest = {}) {
      return post<GitHistorySnapshot>(baseUrl, '/api/git/history', request);
    },
    abortConversation() {
      return post<DesktopSnapshot>(baseUrl, '/api/abort');
    },
    continueAssistantCompletion(messageId: number) {
      return post<DesktopSnapshot>(baseUrl, '/api/continue', { messageId });
    },
    rewindAndSubmitMessage(request: RewindAndSubmitMessageRequest) {
      return post<DesktopSnapshot>(baseUrl, '/api/rewind-submit', request);
    },
    poll() {
      return post<DesktopSnapshot>(baseUrl, '/api/poll');
    },
    setSubagentViewerTarget(parentToolCallId: string | null) {
      return post<DesktopSnapshot>(baseUrl, '/api/subagent-viewer-target', { parentToolCallId });
    },
    listDreamsOverview() {
      return get<DesktopDreamOverviewItem[]>(baseUrl, '/api/dreams');
    },
    replyPendingApproval(decision) {
      return post<DesktopSnapshot>(baseUrl, '/api/approval', { decision });
    },
    replyPendingQuestions(result: AskQuestionsResult) {
      return post<DesktopSnapshot>(baseUrl, '/api/questions', { result });
    },
    resetSession() {
      return post<DesktopSnapshot>(baseUrl, '/api/reset');
    },
    listSessions() {
      return get<SessionListItem[]>(baseUrl, '/api/sessions');
    },
    openSession(path: string) {
      return post<DesktopSnapshot>(baseUrl, '/api/sessions/open', { path });
    },
    deleteSession(path: string) {
      return post<DesktopSnapshot>(baseUrl, '/api/sessions/delete', { path });
    },
    listWorkspaceFileReferenceSuggestions(request: QueryWorkspaceFileReferenceSuggestionsRequest) {
      return post<WorkspaceFileReferenceSuggestionsResponse>(
        baseUrl,
        '/api/workspace/file-reference-suggestions',
        request,
      );
    },
    primeWorkspaceFileReferenceIndex() {
      return post<void>(baseUrl, '/api/workspace/file-reference-index/prime');
    },
    getWorkspaceFileReferenceIndex() {
      return post<import('../types').WorkspaceFileReferenceIndexSnapshot>(
        baseUrl,
        '/api/workspace/file-reference-index',
      );
    },
    listWorkspaceExplorerChildren(relativePath: string) {
      return post<WorkspaceExplorerListResult>(baseUrl, '/api/workspace/explorer', {
        relativePath,
      });
    },
    readWorkspaceTextFile(relativePath: string) {
      return post<WorkspaceReadTextFileResult>(baseUrl, '/api/workspace/file', {
        relativePath,
      });
    },
    writeWorkspaceTextFile(request: WriteWorkspaceTextFileRequest) {
      return post<void>(baseUrl, '/api/workspace/file/write', request);
    },
    readHostTextFile(absolutePath: string) {
      return post<WorkspaceReadTextFileResult>(baseUrl, '/api/host/file', { absolutePath });
    },
    writeHostTextFile(request: WriteHostTextFileRequest) {
      return post<void>(baseUrl, '/api/host/file/write', request);
    },
    statHostTextFile(absolutePath: string) {
      return post<HostTextFileStatResult>(baseUrl, '/api/host/file/stat', { absolutePath });
    },
    async readLocalImagePreviewDataUrl() {
      return null;
    },
    async readManagedImagePreviewDataUrl() {
      return null;
    },
    async readLocalVideoPreviewUrl() {
      return null;
    },
    async readManagedVideoPreviewUrl() {
      return null;
    },
    async saveLocalImageAs() {
      return false;
    },
    async pairWebHost(code: string) {
      const result = await post<WebHostPairingResponse>(baseUrl, '/api/pairing', { code }, {
        auth: false,
      });
      storeWebHostToken(result.token);
    },
  };
}

async function get<T>(baseUrl: string, path: string): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: authHeaders(),
  });
  if (!response.ok) {
    throw await responseError(response);
  }
  return (await response.json()) as T;
}

async function post<T>(
  baseUrl: string,
  path: string,
  body?: unknown,
  options?: { auth?: boolean },
): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(options?.auth === false ? {} : authHeaders()),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (!response.ok) {
    throw await responseError(response);
  }

  return (await response.json()) as T;
}

function authHeaders(): Record<string, string> {
  const token = readWebHostToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function readWebHostToken(): string | undefined {
  try {
    return localStorage.getItem(WEB_HOST_TOKEN_STORAGE_KEY)?.trim() || undefined;
  } catch {
    return undefined;
  }
}

function storeWebHostToken(token: string): void {
  try {
    localStorage.setItem(WEB_HOST_TOKEN_STORAGE_KEY, token);
  } catch {
    /* storage unavailable */
  }
}

async function responseError(response: Response): Promise<Error> {
  const text = await response.text();
  try {
    const parsed = JSON.parse(text) as { error?: string; code?: string };
    const error = new Error(parsed.error ?? text) as Error & {
      code?: string;
      status?: number;
    };
    error.code = parsed.code;
    error.status = response.status;
    return error;
  } catch {
    const error = new Error(text) as Error & { status?: number };
    error.status = response.status;
    return error;
  }
}
