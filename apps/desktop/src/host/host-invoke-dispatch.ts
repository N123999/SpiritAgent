import type { HostCommandName } from './contracts.js';
import type { CommandPayloads } from './host-command-payloads.js';

export interface HostCommandDelegate {
  bootstrap(request?: CommandPayloads['bootstrap']['request']): Promise<unknown>;
  rememberWorkspaceRoot(request: CommandPayloads['rememberWorkspaceRoot']['request']): Promise<unknown>;
  forgetWorkspace(request: CommandPayloads['forgetWorkspace']['request']): Promise<unknown>;
  commitChanges(request: CommandPayloads['commitChanges']['request']): Promise<unknown>;
  updateConfig(request: CommandPayloads['updateConfig']['request']): Promise<unknown>;
  installLspProvider(request: CommandPayloads['installLspProvider']['request']): Promise<unknown>;
  setWebHostAuthTokenHash(authTokenHash: string): Promise<unknown>;
  addModel(request: CommandPayloads['addModel']['request']): Promise<unknown>;
  addProviderModels(request: CommandPayloads['addProviderModels']['request']): Promise<unknown>;
  previewModels(request: CommandPayloads['previewModels']['request']): Promise<unknown>;
  removeModel(request: CommandPayloads['removeModel']['request']): Promise<unknown>;
  removeProviderModels(request: CommandPayloads['removeProviderModels']['request']): Promise<unknown>;
  addMcpServer(request: CommandPayloads['addMcpServer']['request']): Promise<unknown>;
  deleteMcpServer(request: CommandPayloads['deleteMcpServer']['request']): Promise<unknown>;
  saveHookEntry(request: CommandPayloads['saveHookEntry']['request']): Promise<unknown>;
  deleteHookEntry(request: CommandPayloads['deleteHookEntry']['request']): Promise<unknown>;
  inspectMcpServer(name: string): Promise<unknown>;
  importExtension(request: CommandPayloads['importExtension']['request']): Promise<unknown>;
  listMarketplaceExtensions(): Promise<unknown>;
  getMarketplaceExtensionDetail(extensionId: string): Promise<unknown>;
  getMarketplaceExtensionReadme(extensionId: string): Promise<unknown>;
  installMarketplaceExtension(request: CommandPayloads['installMarketplaceExtension']['request']): Promise<unknown>;
  prepareMarketplaceExtensionInstall(
    request: CommandPayloads['prepareMarketplaceExtensionInstall']['request'],
  ): Promise<unknown>;
  deleteExtension(request: CommandPayloads['deleteExtension']['request']): Promise<unknown>;
  runExtension(request: CommandPayloads['runExtension']['request']): Promise<unknown>;
  updateExtensionSettings(request: CommandPayloads['updateExtensionSettings']['request']): Promise<unknown>;
  updateExtensionSecret(request: CommandPayloads['updateExtensionSecret']['request']): Promise<unknown>;
  createRule(request: CommandPayloads['createRule']['request']): Promise<unknown>;
  createSkill(request: CommandPayloads['createSkill']['request']): Promise<unknown>;
  deleteRule(request: CommandPayloads['deleteRule']['request']): Promise<unknown>;
  deleteSkill(request: CommandPayloads['deleteSkill']['request']): Promise<unknown>;
  submitSkillSlash(request: CommandPayloads['submitSkillSlash']['request']): Promise<unknown>;
  submitGitChip(request: CommandPayloads['submitGitChip']['request']): Promise<unknown>;
  submitStartImplementing(): Promise<unknown>;
  exportSessionLog(): Promise<unknown>;
  compactHistory(): Promise<unknown>;
  submitUserTurn(request: CommandPayloads['submitUserTurn']): Promise<unknown>;
  setLoopEnabled(enabled: boolean): Promise<unknown>;
  setApprovalLevel(approvalLevel: CommandPayloads['setApprovalLevel']['approvalLevel']): Promise<unknown>;
  setPendingGitBranch(branch: string): Promise<unknown>;
  setWorkLocation(workLocation: CommandPayloads['setWorkLocation']['workLocation']): Promise<unknown>;
  checkoutGitBranch(request: CommandPayloads['checkoutGitBranch']): Promise<unknown>;
  mergeWorktreeToMain(): Promise<unknown>;
  pushGitBranch(): Promise<unknown>;
  refreshGitSnapshot(): Promise<unknown>;
  abortConversation(): Promise<unknown>;
  abortShellCommand(toolCallId: string): Promise<unknown>;
  continueAssistantCompletion(messageId: number): Promise<unknown>;
  poll(): Promise<unknown>;
  listDreamsOverview(): Promise<unknown>;
  listAutomations(): Promise<unknown>;
  getAutomation(automationId: string): Promise<unknown>;
  createAutomation(request: CommandPayloads['createAutomation']['request']): Promise<unknown>;
  updateAutomation(automationId: string, patch: CommandPayloads['updateAutomation']['patch']): Promise<unknown>;
  deleteAutomation(automationId: string): Promise<unknown>;
  setAutomationEnabled(automationId: string, enabled: boolean): Promise<unknown>;
  replyPendingApproval(decision: CommandPayloads['replyPendingApproval']['decision']): Promise<unknown>;
  replyPendingQuestions(result: CommandPayloads['replyPendingQuestions']['result']): Promise<unknown>;
  resetSession(): Promise<unknown>;
  listSessions(): Promise<unknown>;
  openSession(path: string): Promise<unknown>;
  deleteSession(path: string): Promise<unknown>;
  listWorkspaceFileReferenceSuggestions(
    request: CommandPayloads['listWorkspaceFileReferenceSuggestions']['request'],
  ): Promise<unknown>;
  primeWorkspaceFileReferenceIndex(): Promise<unknown>;
  getWorkspaceFileReferenceIndex(): Promise<unknown>;
  listWorkspaceExplorerChildren(relativePath: string): Promise<unknown>;
  readGitWorkingTree(): Promise<unknown>;
  readGitHistory(request: NonNullable<CommandPayloads['readGitHistory']['request']>): Promise<unknown>;
  getGitHubAuthStatus(): Promise<unknown>;
  beginGitHubDeviceLogin(): Promise<unknown>;
  completeGitHubDeviceLogin(): Promise<unknown>;
  cancelGitHubDeviceLogin(): Promise<unknown>;
  disconnectGitHub(): Promise<unknown>;
  getGitHubPullRequestForCurrentBranch(): Promise<unknown>;
  getGitHubPullRequestDetail(request: CommandPayloads['getGitHubPullRequestDetail']['request']): Promise<unknown>;
  getGitHubPullRequestConversation(request: CommandPayloads['getGitHubPullRequestConversation']['request']): Promise<unknown>;
  readWorkspaceTextFile(relativePath: string): Promise<unknown>;
  writeWorkspaceTextFile(request: CommandPayloads['writeWorkspaceTextFile']['request']): Promise<unknown>;
  readHostTextFile(absolutePath: string): Promise<unknown>;
  writeHostTextFile(request: CommandPayloads['writeHostTextFile']['request']): Promise<unknown>;
  statHostTextFile(absolutePath: string): Promise<unknown>;
  rewindAndSubmitMessage(request: CommandPayloads['rewindAndSubmitMessage']['request']): Promise<unknown>;
  forkSession(request: CommandPayloads['forkSession']['request']): Promise<unknown>;
  reorderQueuedUserTurn(request: CommandPayloads['reorderQueuedUserTurn']['request']): Promise<unknown>;
  sendQueuedUserTurnNow(request: CommandPayloads['sendQueuedUserTurnNow']['request']): Promise<unknown>;
  removeQueuedUserTurn(request: CommandPayloads['removeQueuedUserTurn']['request']): Promise<unknown>;
  setSubagentViewerTarget(parentToolCallId: string | null): Promise<unknown>;
}

type HostCommandHandler<Command extends HostCommandName> = (
  host: HostCommandDelegate,
  payload: CommandPayloads[Command],
) => Promise<unknown>;

const hostCommandDispatch = {
  bootstrap: (host, payload) => host.bootstrap(payload?.request),
  rememberWorkspaceRoot: (host, payload) => host.rememberWorkspaceRoot(payload.request),
  forgetWorkspace: (host, payload) => host.forgetWorkspace(payload.request),
  commitChanges: (host, payload) => host.commitChanges(payload.request),
  updateConfig: (host, payload) => host.updateConfig(payload.request),
  installLspProvider: (host, payload) => host.installLspProvider(payload.request),
  setWebHostAuthTokenHash: (host, payload) => host.setWebHostAuthTokenHash(payload.authTokenHash),
  addModel: (host, payload) => host.addModel(payload.request),
  addProviderModels: (host, payload) => host.addProviderModels(payload.request),
  previewModels: (host, payload) => host.previewModels(payload.request),
  removeModel: (host, payload) => host.removeModel(payload.request),
  removeProviderModels: (host, payload) => host.removeProviderModels(payload.request),
  addMcpServer: (host, payload) => host.addMcpServer(payload.request),
  deleteMcpServer: (host, payload) => host.deleteMcpServer(payload.request),
  saveHookEntry: (host, payload) => host.saveHookEntry(payload.request),
  deleteHookEntry: (host, payload) => host.deleteHookEntry(payload.request),
  inspectMcpServer: (host, payload) => host.inspectMcpServer(payload.name),
  importExtension: (host, payload) => host.importExtension(payload.request),
  listMarketplaceExtensions: (host) => host.listMarketplaceExtensions(),
  getMarketplaceExtensionDetail: (host, payload) => host.getMarketplaceExtensionDetail(payload.extensionId),
  getMarketplaceExtensionReadme: (host, payload) => host.getMarketplaceExtensionReadme(payload.extensionId),
  installMarketplaceExtension: (host, payload) => host.installMarketplaceExtension(payload.request),
  prepareMarketplaceExtensionInstall: (host, payload) => host.prepareMarketplaceExtensionInstall(payload.request),
  deleteExtension: (host, payload) => host.deleteExtension(payload.request),
  runExtension: (host, payload) => host.runExtension(payload.request),
  updateExtensionSettings: (host, payload) => host.updateExtensionSettings(payload.request),
  updateExtensionSecret: (host, payload) => host.updateExtensionSecret(payload.request),
  createRule: (host, payload) => host.createRule(payload.request),
  createSkill: (host, payload) => host.createSkill(payload.request),
  deleteRule: (host, payload) => host.deleteRule(payload.request),
  deleteSkill: (host, payload) => host.deleteSkill(payload.request),
  submitSkillSlash: (host, payload) => host.submitSkillSlash(payload.request),
  submitGitChip: (host, payload) => host.submitGitChip(payload.request),
  submitStartImplementing: (host) => host.submitStartImplementing(),
  exportSessionLog: (host) => host.exportSessionLog(),
  compactHistory: (host) => host.compactHistory(),
  submitUserTurn: (host, payload) => host.submitUserTurn(payload),
  setLoopEnabled: (host, payload) => host.setLoopEnabled(payload.enabled === true),
  setApprovalLevel: (host, payload) => host.setApprovalLevel(payload.approvalLevel),
  setPendingGitBranch: (host, payload) => host.setPendingGitBranch(payload.branch),
  setWorkLocation: (host, payload) => host.setWorkLocation(payload.workLocation),
  checkoutGitBranch: (host, payload) => host.checkoutGitBranch(payload),
  mergeWorktreeToMain: (host) => host.mergeWorktreeToMain(),
  pushGitBranch: (host) => host.pushGitBranch(),
  refreshGitSnapshot: (host) => host.refreshGitSnapshot(),
  abortConversation: (host) => host.abortConversation(),
  abortShellCommand: (host, payload) => host.abortShellCommand(payload.toolCallId),
  continueAssistantCompletion: (host, payload) => host.continueAssistantCompletion(payload.messageId),
  poll: (host) => host.poll(),
  listDreamsOverview: (host) => host.listDreamsOverview(),
  listAutomations: (host) => host.listAutomations(),
  getAutomation: (host, payload) => host.getAutomation(payload.automationId),
  createAutomation: (host, payload) => host.createAutomation(payload.request),
  updateAutomation: (host, payload) => host.updateAutomation(payload.automationId, payload.patch),
  deleteAutomation: (host, payload) => host.deleteAutomation(payload.automationId),
  setAutomationEnabled: (host, payload) => host.setAutomationEnabled(payload.automationId, payload.enabled),
  replyPendingApproval: (host, payload) => host.replyPendingApproval(payload.decision),
  replyPendingQuestions: (host, payload) => host.replyPendingQuestions(payload.result),
  resetSession: (host) => host.resetSession(),
  listSessions: (host) => host.listSessions(),
  openSession: (host, payload) => host.openSession(payload.path),
  deleteSession: (host, payload) => host.deleteSession(payload.path),
  listWorkspaceFileReferenceSuggestions: (host, payload) =>
    host.listWorkspaceFileReferenceSuggestions(payload.request),
  primeWorkspaceFileReferenceIndex: (host) => host.primeWorkspaceFileReferenceIndex(),
  getWorkspaceFileReferenceIndex: (host) => host.getWorkspaceFileReferenceIndex(),
  listWorkspaceExplorerChildren: (host, payload) => host.listWorkspaceExplorerChildren(payload.relativePath),
  readGitWorkingTree: (host) => host.readGitWorkingTree(),
  readGitHistory: (host, payload) => host.readGitHistory(payload.request ?? {}),
  getGitHubAuthStatus: (host) => host.getGitHubAuthStatus(),
  beginGitHubDeviceLogin: (host) => host.beginGitHubDeviceLogin(),
  completeGitHubDeviceLogin: (host) => host.completeGitHubDeviceLogin(),
  cancelGitHubDeviceLogin: (host) => host.cancelGitHubDeviceLogin(),
  disconnectGitHub: (host) => host.disconnectGitHub(),
  getGitHubPullRequestForCurrentBranch: (host) => host.getGitHubPullRequestForCurrentBranch(),
  getGitHubPullRequestDetail: (host, payload) => host.getGitHubPullRequestDetail(payload.request),
  getGitHubPullRequestConversation: (host, payload) =>
    host.getGitHubPullRequestConversation(payload.request),
  readWorkspaceTextFile: (host, payload) => host.readWorkspaceTextFile(payload.relativePath),
  writeWorkspaceTextFile: (host, payload) => host.writeWorkspaceTextFile(payload.request),
  readHostTextFile: (host, payload) => host.readHostTextFile(payload.absolutePath),
  writeHostTextFile: (host, payload) => host.writeHostTextFile(payload.request),
  statHostTextFile: (host, payload) => host.statHostTextFile(payload.absolutePath),
  rewindAndSubmitMessage: (host, payload) => host.rewindAndSubmitMessage(payload.request),
  forkSession: (host, payload) => host.forkSession(payload.request),
  reorderQueuedUserTurn: (host, payload) => host.reorderQueuedUserTurn(payload.request),
  sendQueuedUserTurnNow: (host, payload) => host.sendQueuedUserTurnNow(payload.request),
  removeQueuedUserTurn: (host, payload) => host.removeQueuedUserTurn(payload.request),
  setSubagentViewerTarget: (host, payload) => host.setSubagentViewerTarget(payload.parentToolCallId),
} satisfies { [Command in HostCommandName]: HostCommandHandler<Command> };

export function createHostInvokeDispatch(host: HostCommandDelegate) {
  return (command: HostCommandName, payload?: unknown): Promise<unknown> => {
    const handler = hostCommandDispatch[command] as HostCommandHandler<typeof command>;
    return handler(host, payload as CommandPayloads[typeof command]);
  };
}
