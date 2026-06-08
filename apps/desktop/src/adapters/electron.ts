import type { HostApi } from '../host-api';

export async function createElectronHostApi(): Promise<HostApi> {
  if (typeof window === 'undefined' || !window.spiritDesktop) {
    throw new Error('Electron host bridge is unavailable.');
  }

  const bridge = window.spiritDesktop;

  return {
    kind: 'electron',
    bootstrap(request) {
      return bridge.bootstrap(request);
    },
    rememberWorkspaceRoot(request) {
      return bridge.rememberWorkspaceRoot(request);
    },
    commitChanges(request) {
      return bridge.commitChanges(request);
    },
    updateConfig(request) {
      return bridge.updateConfig(request);
    },
    installLspProvider(request) {
      return bridge.installLspProvider(request);
    },
    addModel(request) {
      return bridge.addModel(request);
    },
    addProviderModels(request) {
      return bridge.addProviderModels(request);
    },
    previewModels(request) {
      return bridge.previewModels(request);
    },
    removeModel(name) {
      return bridge.removeModel(name);
    },
    removeProviderModels(provider) {
      return bridge.removeProviderModels(provider);
    },
    addMcpServer(request) {
      return bridge.addMcpServer(request);
    },
    deleteMcpServer(request) {
      return bridge.deleteMcpServer(request);
    },
    inspectMcpServer(name) {
      return bridge.inspectMcpServer(name);
    },
    importExtension(request) {
      return bridge.importExtension(request);
    },
    listMarketplaceExtensions() {
      return bridge.listMarketplaceExtensions();
    },
    getMarketplaceExtensionDetail(extensionId) {
      return bridge.getMarketplaceExtensionDetail(extensionId);
    },
    getMarketplaceExtensionReadme(extensionId) {
      return bridge.getMarketplaceExtensionReadme(extensionId);
    },
    prepareMarketplaceExtensionInstall(request) {
      return bridge.prepareMarketplaceExtensionInstall(request);
    },
    installMarketplaceExtension(request) {
      return bridge.installMarketplaceExtension(request);
    },
    deleteExtension(request) {
      return bridge.deleteExtension(request);
    },
    runExtension(request) {
      return bridge.runExtension(request);
    },
    updateExtensionSettings(request) {
      return bridge.updateExtensionSettings(request);
    },
    updateExtensionSecret(request) {
      return bridge.updateExtensionSecret(request);
    },
    createRule(request) {
      return bridge.createRule(request);
    },
    createSkill(request) {
      return bridge.createSkill(request);
    },
    deleteRule(request) {
      return bridge.deleteRule(request);
    },
    deleteSkill(request) {
      return bridge.deleteSkill(request);
    },
    submitCreateRuleSlash(request) {
      return bridge.submitCreateRuleSlash(request);
    },
    submitCreateSkillSlash(request) {
      return bridge.submitCreateSkillSlash(request);
    },
    submitSkillSlash(request) {
      return bridge.submitSkillSlash(request);
    },
    submitGitChip(request) {
      return bridge.submitGitChip(request);
    },
    submitStartImplementing() {
      return bridge.submitStartImplementing();
    },
    exportSessionLog() {
      return bridge.exportSessionLog();
    },
    compactHistory() {
      return bridge.compactHistory();
    },
    submitUserTurn(request) {
      return bridge.submitUserTurn(request);
    },
    setLoopEnabled(enabled) {
      return bridge.setLoopEnabled(enabled);
    },
    setApprovalLevel(approvalLevel) {
      return bridge.setApprovalLevel(approvalLevel);
    },
    setPendingGitBranch(branch) {
      return bridge.setPendingGitBranch(branch);
    },
    setWorkLocation(workLocation) {
      return bridge.setWorkLocation(workLocation);
    },
    checkoutGitBranch(request) {
      return bridge.checkoutGitBranch(request);
    },
    mergeWorktreeToMain() {
      return bridge.mergeWorktreeToMain();
    },
    pushGitBranch() {
      return bridge.pushGitBranch();
    },
    refreshGitSnapshot() {
      return bridge.refreshGitSnapshot();
    },
    abortConversation() {
      return bridge.abortConversation();
    },
    continueAssistantCompletion(messageId) {
      return bridge.continueAssistantCompletion(messageId);
    },
    rewindAndSubmitMessage(request) {
      return bridge.rewindAndSubmitMessage(request);
    },
    poll() {
      return bridge.poll();
    },
    setSubagentViewerTarget(parentToolCallId) {
      return bridge.setSubagentViewerTarget(parentToolCallId);
    },
    listDreamsOverview() {
      return bridge.listDreamsOverview();
    },
    subscribeDreamUpdates(callback) {
      return bridge.dreamSubscribe(callback);
    },
    subscribeSessionListUpdates(callback) {
      return bridge.sessionListSubscribe(callback);
    },
    replyPendingApproval(decision) {
      return bridge.replyPendingApproval(decision);
    },
    replyPendingQuestions(result) {
      return bridge.replyPendingQuestions(result);
    },
    resetSession() {
      return bridge.resetSession();
    },
    listSessions() {
      return bridge.listSessions();
    },
    openSession(path) {
      return bridge.openSession(path);
    },
    deleteSession(path) {
      return bridge.deleteSession(path);
    },
    listWorkspaceFileReferenceSuggestions(request) {
      return bridge.listWorkspaceFileReferenceSuggestions(request);
    },
    primeWorkspaceFileReferenceIndex() {
      return bridge.primeWorkspaceFileReferenceIndex();
    },
    getWorkspaceFileReferenceIndex() {
      return bridge.getWorkspaceFileReferenceIndex();
    },
    listWorkspaceExplorerChildren(relativePath) {
      return bridge.listWorkspaceExplorerChildren(relativePath);
    },
    readGitWorkingTree() {
      return bridge.readGitWorkingTree();
    },
    readGitHistory(request) {
      return bridge.readGitHistory(request);
    },
    readWorkspaceTextFile(relativePath) {
      return bridge.readWorkspaceTextFile(relativePath);
    },
    writeWorkspaceTextFile(request) {
      return bridge.writeWorkspaceTextFile(request);
    },
    readHostTextFile(absolutePath) {
      return bridge.readHostTextFile(absolutePath);
    },
    writeHostTextFile(request) {
      return bridge.writeHostTextFile(request);
    },
    statHostTextFile(absolutePath) {
      return bridge.statHostTextFile(absolutePath);
    },
    pickWorkspaceDirectory() {
      return bridge.pickWorkspaceDirectory();
    },
    pickLocalFile() {
      return bridge.pickLocalFile();
    },
    ingestClipboardImage() {
      return bridge.ingestClipboardImage();
    },
    readLocalImagePreviewDataUrl(filePath) {
      return bridge.readLocalImagePreviewDataUrl(filePath);
    },
    readManagedImagePreviewDataUrl(reference) {
      return bridge.readManagedImagePreviewDataUrl(reference);
    },
    readLocalVideoPreviewUrl(filePath) {
      return bridge.readLocalVideoPreviewUrl(filePath);
    },
    readManagedVideoPreviewUrl(reference) {
      return bridge.readManagedVideoPreviewUrl(reference);
    },
    saveLocalImageAs(filePath) {
      return bridge.saveLocalImageAs(filePath);
    },
  };
}
