import type {
  ApprovalLevel,
  WorkLocationKind,
} from '@spirit-agent/host-internal';

import type {
  AddMcpServerRequest,
  AddModelRequest,
  AddProviderModelsRequest,
  AskQuestionsResult,
  BootstrapRequest,
  CheckoutGitBranchRequest,
  CommitChangesRequest,
  CreateSkillRequest,
  DeleteExtensionRequest,
  DeleteMcpServerRequest,
  DeleteSkillRequest,
  DesktopApprovalDecision,
  ImportExtensionRequest,
  InstallMarketplaceExtensionRequest,
  PrepareMarketplaceExtensionInstallRequest,
  PreviewModelsRequest,
  QueryWorkspaceFileReferenceSuggestionsRequest,
  ReadGitHistoryRequest,
  RememberWorkspaceRequest,
  RemoveModelRequest,
  RemoveProviderModelsRequest,
  RewindAndSubmitMessageRequest,
  RunExtensionRequest,
  SubmitCreateSkillSlashRequest,
  SubmitSkillSlashRequest,
  SubmitUserTurnRequest,
  UpdateConfigRequest,
  UpdateExtensionSecretRequest,
  UpdateExtensionSettingsRequest,
  WriteWorkspaceTextFileRequest,
} from '../types.js';

export type CommandPayloads = {
  bootstrap: { request?: BootstrapRequest };
  rememberWorkspaceRoot: { request: RememberWorkspaceRequest };
  commitChanges: { request: CommitChangesRequest };
  updateConfig: { request: UpdateConfigRequest };
  setLoopEnabled: { enabled: boolean };
  setApprovalLevel: { approvalLevel: ApprovalLevel };
  setPendingGitBranch: { branch: string };
  setWorkLocation: { workLocation: WorkLocationKind };
  checkoutGitBranch: CheckoutGitBranchRequest;
  mergeWorktreeToMain: undefined;
  pushGitBranch: undefined;
  refreshGitSnapshot: undefined;
  readGitWorkingTree: undefined;
  readGitHistory: { request?: ReadGitHistoryRequest };
  setWebHostAuthTokenHash: { authTokenHash: string };
  addModel: { request: AddModelRequest };
  addProviderModels: { request: AddProviderModelsRequest };
  previewModels: { request: PreviewModelsRequest };
  removeModel: { request: RemoveModelRequest };
  removeProviderModels: { request: RemoveProviderModelsRequest };
  addMcpServer: { request: AddMcpServerRequest };
  deleteMcpServer: { request: DeleteMcpServerRequest };
  inspectMcpServer: { name: string };
  importExtension: { request: ImportExtensionRequest };
  listMarketplaceExtensions: undefined;
  getMarketplaceExtensionDetail: { extensionId: string };
  getMarketplaceExtensionReadme: { extensionId: string };
  prepareMarketplaceExtensionInstall: { request: PrepareMarketplaceExtensionInstallRequest };
  installMarketplaceExtension: { request: InstallMarketplaceExtensionRequest };
  deleteExtension: { request: DeleteExtensionRequest };
  runExtension: { request: RunExtensionRequest };
  updateExtensionSettings: { request: UpdateExtensionSettingsRequest };
  updateExtensionSecret: { request: UpdateExtensionSecretRequest };
  createSkill: { request: CreateSkillRequest };
  deleteSkill: { request: DeleteSkillRequest };
  submitCreateSkillSlash: { request: SubmitCreateSkillSlashRequest };
  submitSkillSlash: { request: SubmitSkillSlashRequest };
  submitStartImplementing: undefined;
  exportSessionLog: undefined;
  compactHistory: undefined;
  submitUserTurn: SubmitUserTurnRequest;
  abortConversation: undefined;
  continueAssistantCompletion: { messageId: number };
  poll: undefined;
  listDreamsOverview: undefined;
  replyPendingApproval: { decision: DesktopApprovalDecision };
  replyPendingQuestions: { result: AskQuestionsResult };
  resetSession: undefined;
  listSessions: undefined;
  openSession: { path: string };
  deleteSession: { path: string };
  listWorkspaceFileReferenceSuggestions: { request: QueryWorkspaceFileReferenceSuggestionsRequest };
  listWorkspaceExplorerChildren: { relativePath: string };
  readWorkspaceTextFile: { relativePath: string };
  writeWorkspaceTextFile: { request: WriteWorkspaceTextFileRequest };
  rewindAndSubmitMessage: { request: RewindAndSubmitMessageRequest };
};
