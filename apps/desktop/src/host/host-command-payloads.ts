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
  CreateRuleRequest,
  CreateSkillRequest,
  DeleteExtensionRequest,
  DeleteMcpServerRequest,
  DeleteRuleRequest,
  DeleteSkillRequest,
  DesktopApprovalDecision,
  DesktopCreateAutomationRequest,
  DesktopUpdateAutomationRequest,
  ImportExtensionRequest,
  InstallLspProviderRequest,
  InstallMarketplaceExtensionRequest,
  PrepareMarketplaceExtensionInstallRequest,
  PreviewModelsRequest,
  QueryWorkspaceFileReferenceSuggestionsRequest,
  ReadGitHistoryRequest,
  RememberWorkspaceRequest,
  ForgetWorkspaceRequest,
  RemoveModelRequest,
  RemoveProviderModelsRequest,
  QueuedUserTurnRequest,
  RewindAndSubmitMessageRequest,
  RunExtensionRequest,
  SubmitGitChipRequest,
  SubmitSkillSlashRequest,
  SubmitUserTurnRequest,
  UpdateConfigRequest,
  UpdateExtensionSecretRequest,
  UpdateExtensionSettingsRequest,
  WriteHostTextFileRequest,
  WriteWorkspaceTextFileRequest,
} from '../types.js';

export type CommandPayloads = {
  bootstrap: { request?: BootstrapRequest };
  rememberWorkspaceRoot: { request: RememberWorkspaceRequest };
  forgetWorkspace: { request: ForgetWorkspaceRequest };
  commitChanges: { request: CommitChangesRequest };
  updateConfig: { request: UpdateConfigRequest };
  installLspProvider: { request: InstallLspProviderRequest };
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
  createRule: { request: CreateRuleRequest };
  createSkill: { request: CreateSkillRequest };
  deleteRule: { request: DeleteRuleRequest };
  deleteSkill: { request: DeleteSkillRequest };
  submitSkillSlash: { request: SubmitSkillSlashRequest };
  submitGitChip: { request: SubmitGitChipRequest };
  submitStartImplementing: undefined;
  exportSessionLog: undefined;
  compactHistory: undefined;
  submitUserTurn: SubmitUserTurnRequest;
  abortConversation: undefined;
  abortShellCommand: { toolCallId: string };
  continueAssistantCompletion: { messageId: number };
  poll: undefined;
  listDreamsOverview: undefined;
  listAutomations: undefined;
  getAutomation: { automationId: string };
  createAutomation: { request: DesktopCreateAutomationRequest };
  updateAutomation: { automationId: string; patch: DesktopUpdateAutomationRequest };
  deleteAutomation: { automationId: string };
  setAutomationEnabled: { automationId: string; enabled: boolean };
  replyPendingApproval: { decision: DesktopApprovalDecision };
  replyPendingQuestions: { result: AskQuestionsResult };
  resetSession: undefined;
  listSessions: undefined;
  openSession: { path: string };
  deleteSession: { path: string };
  listWorkspaceFileReferenceSuggestions: { request: QueryWorkspaceFileReferenceSuggestionsRequest };
  primeWorkspaceFileReferenceIndex: undefined;
  getWorkspaceFileReferenceIndex: undefined;
  listWorkspaceExplorerChildren: { relativePath: string };
  readWorkspaceTextFile: { relativePath: string };
  writeWorkspaceTextFile: { request: WriteWorkspaceTextFileRequest };
  readHostTextFile: { absolutePath: string };
  writeHostTextFile: { request: WriteHostTextFileRequest };
  statHostTextFile: { absolutePath: string };
  rewindAndSubmitMessage: { request: RewindAndSubmitMessageRequest };
  reorderQueuedUserTurn: { request: QueuedUserTurnRequest };
  sendQueuedUserTurnNow: { request: QueuedUserTurnRequest };
  removeQueuedUserTurn: { request: QueuedUserTurnRequest };
  setSubagentViewerTarget: { parentToolCallId: string | null };
};
