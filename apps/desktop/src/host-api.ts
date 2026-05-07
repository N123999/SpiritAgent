import type {
  AddModelRequest,
  AddMcpServerRequest,
  AddProviderModelsRequest,
  AskQuestionsResult,
  BootstrapRequest,
  CommitChangesRequest,
  CreateSkillRequest,
  DeleteExtensionRequest,
  DeleteMcpServerRequest,
  DesktopApprovalDecision,
  DesktopDreamOverviewItem,
  DesktopMarketplaceCatalogItem,
  DesktopMarketplaceDetail,
  DesktopMarketplacePreparedInstall,
  DeleteSkillRequest,
  DesktopMcpServerInspection,
  DesktopModelProvider,
  DesktopSnapshot,
  ImportExtensionRequest,
  InstallMarketplaceExtensionRequest,
  PrepareMarketplaceExtensionInstallRequest,
  RunExtensionRequest,
  UpdateExtensionSecretRequest,
  UpdateExtensionSettingsRequest,
  PreviewModelsRequest,
  PreviewModelsResponse,
  QueryWorkspaceFileReferenceSuggestionsRequest,
  RememberWorkspaceRequest,
  RewindAndSubmitMessageRequest,
  SubmitUserTurnRequest,
  SessionListItem,
  WorkspaceExplorerListResult,
  WorkspaceFileReferenceSuggestionsResponse,
  WorkspaceReadTextFileResult,
  WriteWorkspaceTextFileRequest,
  SubmitCreateSkillSlashRequest,
  SubmitSkillSlashRequest,
  UpdateConfigRequest,
} from './types';

import { createElectronHostApi } from './adapters/electron';
import { createWebHostApi } from './adapters/web';

export interface HostApi {
  kind: 'electron' | 'web';
  bootstrap(request?: BootstrapRequest): Promise<DesktopSnapshot>;
  rememberWorkspaceRoot?(request: RememberWorkspaceRequest): Promise<DesktopSnapshot>;
  commitChanges(request: CommitChangesRequest): Promise<DesktopSnapshot>;
  updateConfig(request: UpdateConfigRequest): Promise<DesktopSnapshot>;
  addModel(request: AddModelRequest): Promise<DesktopSnapshot>;
  addProviderModels(request: AddProviderModelsRequest): Promise<DesktopSnapshot>;
  previewModels(request: PreviewModelsRequest): Promise<PreviewModelsResponse>;
  removeModel(name: string): Promise<DesktopSnapshot>;
  removeProviderModels(provider: DesktopModelProvider): Promise<DesktopSnapshot>;
  addMcpServer(request: AddMcpServerRequest): Promise<DesktopSnapshot>;
  deleteMcpServer(request: DeleteMcpServerRequest): Promise<DesktopSnapshot>;
  inspectMcpServer(name: string): Promise<DesktopMcpServerInspection>;
  importExtension(request: ImportExtensionRequest): Promise<DesktopSnapshot>;
  listMarketplaceExtensions(): Promise<DesktopMarketplaceCatalogItem[]>;
  getMarketplaceExtensionDetail(extensionId: string): Promise<DesktopMarketplaceDetail>;
  getMarketplaceExtensionReadme(extensionId: string): Promise<string>;
  prepareMarketplaceExtensionInstall(
    request: PrepareMarketplaceExtensionInstallRequest,
  ): Promise<DesktopMarketplacePreparedInstall>;
  installMarketplaceExtension(request: InstallMarketplaceExtensionRequest): Promise<DesktopSnapshot>;
  deleteExtension(request: DeleteExtensionRequest): Promise<DesktopSnapshot>;
  runExtension(request: RunExtensionRequest): Promise<DesktopSnapshot>;
  updateExtensionSettings(request: UpdateExtensionSettingsRequest): Promise<DesktopSnapshot>;
  updateExtensionSecret(request: UpdateExtensionSecretRequest): Promise<DesktopSnapshot>;
  createSkill(request: CreateSkillRequest): Promise<DesktopSnapshot>;
  deleteSkill(request: DeleteSkillRequest): Promise<DesktopSnapshot>;
  submitCreateSkillSlash(request: SubmitCreateSkillSlashRequest): Promise<DesktopSnapshot>;
  submitSkillSlash(request: SubmitSkillSlashRequest): Promise<DesktopSnapshot>;
  exportSessionLog?(): Promise<DesktopSnapshot>;
  submitUserTurn(request: SubmitUserTurnRequest): Promise<DesktopSnapshot>;
  abortConversation(): Promise<DesktopSnapshot>;
  continueAssistantCompletion(messageId: number): Promise<DesktopSnapshot>;
  rewindAndSubmitMessage(request: RewindAndSubmitMessageRequest): Promise<DesktopSnapshot>;
  poll(): Promise<DesktopSnapshot>;
  listDreamsOverview(): Promise<DesktopDreamOverviewItem[]>;
  subscribeDreamUpdates?(callback: (snapshot: DesktopSnapshot) => void): () => void;
  replyPendingApproval(decision: DesktopApprovalDecision): Promise<DesktopSnapshot>;
  replyPendingQuestions(result: AskQuestionsResult): Promise<DesktopSnapshot>;
  resetSession(): Promise<DesktopSnapshot>;
  listSessions(): Promise<SessionListItem[]>;
  openSession(path: string): Promise<DesktopSnapshot>;
  listWorkspaceFileReferenceSuggestions(
    request: QueryWorkspaceFileReferenceSuggestionsRequest,
  ): Promise<WorkspaceFileReferenceSuggestionsResponse>;
  listWorkspaceExplorerChildren(relativePath: string): Promise<WorkspaceExplorerListResult>;
  readWorkspaceTextFile(relativePath: string): Promise<WorkspaceReadTextFileResult>;
  writeWorkspaceTextFile(request: WriteWorkspaceTextFileRequest): Promise<void>;
  pickWorkspaceDirectory?(): Promise<string | null>;
  pickLocalFile?(): Promise<string | null>;
  readLocalImagePreviewDataUrl?(filePath: string): Promise<string | null>;
  pairWebHost?(code: string): Promise<void>;
}

export async function createHostApi(): Promise<HostApi> {
  if (typeof window !== 'undefined' && window.spiritDesktop) {
    return createElectronHostApi();
  }

  return createWebHostApi();
}
