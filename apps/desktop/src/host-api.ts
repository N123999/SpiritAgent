import type {
  AddModelRequest,
  AddMcpServerRequest,
  AddProviderModelsRequest,
  AskQuestionsResult,
  BootstrapRequest,
  CheckoutGitBranchRequest,
  CommitChangesRequest,
  GitHistorySnapshot,
  GitWorkingTreeSnapshot,
  HostTextFileStatResult,
  ReadGitHistoryRequest,
  CreateRuleRequest,
  CreateSkillRequest,
  DeleteExtensionRequest,
  DeleteMcpServerRequest,
  DeleteRuleRequest,
  DesktopApprovalDecision,
  DesktopAutomationDetail,
  DesktopAutomationListItem,
  DesktopCreateAutomationRequest,
  DesktopDreamOverviewItem,
  DesktopUpdateAutomationRequest,
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
  ForgetWorkspaceRequest,
  QueuedUserTurnRequest,
  RewindAndSubmitMessageRequest,
  SubmitUserTurnRequest,
  SessionListItem,
  WorkspaceExplorerListResult,
  WorkspaceFileReferenceSuggestionsResponse,
  WorkspaceReadTextFileResult,
  WriteHostTextFileRequest,
  WriteWorkspaceTextFileRequest,
  SubmitGitChipRequest,
  SubmitSkillSlashRequest,
  UpdateConfigRequest,
  InstallLspProviderRequest,
} from './types';

import { createElectronHostApi } from './adapters/electron';
import { createWebHostApi } from './adapters/web';

export interface HostApi {
  kind: 'electron' | 'web';
  bootstrap(request?: BootstrapRequest): Promise<DesktopSnapshot>;
  rememberWorkspaceRoot?(request: RememberWorkspaceRequest): Promise<DesktopSnapshot>;
  forgetWorkspace?(request: ForgetWorkspaceRequest): Promise<DesktopSnapshot>;
  commitChanges(request: CommitChangesRequest): Promise<DesktopSnapshot>;
  updateConfig(request: UpdateConfigRequest): Promise<DesktopSnapshot>;
  installLspProvider(request: InstallLspProviderRequest): Promise<DesktopSnapshot>;
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
  createRule(request: CreateRuleRequest): Promise<DesktopSnapshot>;
  createSkill(request: CreateSkillRequest): Promise<DesktopSnapshot>;
  deleteRule(request: DeleteRuleRequest): Promise<DesktopSnapshot>;
  deleteSkill(request: DeleteSkillRequest): Promise<DesktopSnapshot>;
  submitSkillSlash(request: SubmitSkillSlashRequest): Promise<DesktopSnapshot>;
  submitGitChip(request: SubmitGitChipRequest): Promise<DesktopSnapshot>;
  submitStartImplementing(): Promise<DesktopSnapshot>;
  exportSessionLog?(): Promise<DesktopSnapshot>;
  compactHistory(): Promise<DesktopSnapshot>;
  submitUserTurn(request: SubmitUserTurnRequest): Promise<DesktopSnapshot>;
  setLoopEnabled(enabled: boolean): Promise<DesktopSnapshot>;
  setApprovalLevel(approvalLevel: import('@spirit-agent/host-internal').ApprovalLevel): Promise<DesktopSnapshot>;
  setPendingGitBranch(branch: string): Promise<DesktopSnapshot>;
  setWorkLocation(workLocation: import('@spirit-agent/host-internal').WorkLocationKind): Promise<DesktopSnapshot>;
  checkoutGitBranch(request: CheckoutGitBranchRequest): Promise<DesktopSnapshot>;
  mergeWorktreeToMain(): Promise<DesktopSnapshot>;
  pushGitBranch(): Promise<DesktopSnapshot>;
  refreshGitSnapshot(): Promise<DesktopSnapshot>;
  readGitWorkingTree(): Promise<GitWorkingTreeSnapshot>;
  readGitHistory(request?: ReadGitHistoryRequest): Promise<GitHistorySnapshot>;
  abortConversation(): Promise<DesktopSnapshot>;
  continueAssistantCompletion(messageId: number): Promise<DesktopSnapshot>;
  rewindAndSubmitMessage(request: RewindAndSubmitMessageRequest): Promise<DesktopSnapshot>;
  reorderQueuedUserTurn(request: QueuedUserTurnRequest): Promise<DesktopSnapshot>;
  sendQueuedUserTurnNow(request: QueuedUserTurnRequest): Promise<DesktopSnapshot>;
  removeQueuedUserTurn(request: QueuedUserTurnRequest): Promise<DesktopSnapshot>;
  poll(): Promise<DesktopSnapshot>;
  setSubagentViewerTarget(parentToolCallId: string | null): Promise<DesktopSnapshot>;
  listDreamsOverview(): Promise<DesktopDreamOverviewItem[]>;
  listAutomations(): Promise<DesktopAutomationListItem[]>;
  getAutomation(automationId: string): Promise<DesktopAutomationDetail | undefined>;
  createAutomation(request: DesktopCreateAutomationRequest): Promise<DesktopSnapshot>;
  updateAutomation(automationId: string, patch: DesktopUpdateAutomationRequest): Promise<DesktopSnapshot>;
  deleteAutomation(automationId: string): Promise<DesktopSnapshot>;
  setAutomationEnabled(automationId: string, enabled: boolean): Promise<DesktopSnapshot>;
  subscribeDreamUpdates?(callback: (snapshot: DesktopSnapshot) => void): () => void;
  subscribeAutomationsUpdates?(callback: (snapshot: DesktopSnapshot) => void): () => void;
  subscribeSessionListUpdates?(callback: () => void): () => void;
  replyPendingApproval(decision: DesktopApprovalDecision): Promise<DesktopSnapshot>;
  replyPendingQuestions(result: AskQuestionsResult): Promise<DesktopSnapshot>;
  resetSession(): Promise<DesktopSnapshot>;
  listSessions(): Promise<SessionListItem[]>;
  openSession(path: string): Promise<DesktopSnapshot>;
  deleteSession(path: string): Promise<DesktopSnapshot>;
  listWorkspaceFileReferenceSuggestions(
    request: QueryWorkspaceFileReferenceSuggestionsRequest,
  ): Promise<WorkspaceFileReferenceSuggestionsResponse>;
  primeWorkspaceFileReferenceIndex(): Promise<void>;
  getWorkspaceFileReferenceIndex(): Promise<import('./types').WorkspaceFileReferenceIndexSnapshot>;
  listWorkspaceExplorerChildren(relativePath: string): Promise<WorkspaceExplorerListResult>;
  readWorkspaceTextFile(relativePath: string): Promise<WorkspaceReadTextFileResult>;
  writeWorkspaceTextFile(request: WriteWorkspaceTextFileRequest): Promise<void>;
  readHostTextFile(absolutePath: string): Promise<WorkspaceReadTextFileResult>;
  writeHostTextFile(request: WriteHostTextFileRequest): Promise<void>;
  statHostTextFile(absolutePath: string): Promise<HostTextFileStatResult>;
  pickWorkspaceDirectory?(): Promise<string | null>;
  pickLocalFile?(): Promise<string | null>;
  ingestClipboardImage?(): Promise<string | null>;
  readLocalImagePreviewDataUrl?(filePath: string): Promise<string | null>;
  readManagedImagePreviewDataUrl?(reference: string): Promise<string | null>;
  readLocalVideoPreviewUrl?(filePath: string): Promise<string | null>;
  readManagedVideoPreviewUrl?(reference: string): Promise<string | null>;
  saveLocalImageAs?(filePath: string): Promise<boolean>;
  pairWebHost?(code: string): Promise<void>;
}

export async function createHostApi(): Promise<HostApi> {
  if (typeof window !== 'undefined' && window.spiritDesktop) {
    return createElectronHostApi();
  }

  return createWebHostApi();
}
