/// <reference types="vite/client" />

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
  SubmitCreateSkillSlashRequest,
  SubmitSkillSlashRequest,
  UpdateConfigRequest,
  WorkspaceExplorerListResult,
  WorkspaceFileReferenceSuggestionsResponse,
  WorkspaceReadTextFileResult,
  WriteWorkspaceTextFileRequest,
} from './types';

declare global {
  interface SpiritDesktopApi {
    platform: NodeJS.Platform;
    bootstrap(request?: BootstrapRequest): Promise<DesktopSnapshot>;
    rememberWorkspaceRoot(request: RememberWorkspaceRequest): Promise<DesktopSnapshot>;
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
    submitStartImplementing(): Promise<DesktopSnapshot>;
    exportSessionLog(): Promise<DesktopSnapshot>;
    compactHistory(): Promise<DesktopSnapshot>;
    submitUserTurn(request: SubmitUserTurnRequest): Promise<DesktopSnapshot>;
    setLoopEnabled(enabled: boolean): Promise<DesktopSnapshot>;
    setApprovalLevel(approvalLevel: import('@spirit-agent/host-internal').ApprovalLevel): Promise<DesktopSnapshot>;
    setPendingGitBranch(branch: string): Promise<DesktopSnapshot>;
    setWorkLocation(workLocation: import('@spirit-agent/host-internal').WorkLocationKind): Promise<DesktopSnapshot>;
    checkoutGitBranch(request: import('./types.js').CheckoutGitBranchRequest): Promise<DesktopSnapshot>;
    mergeWorktreeToMain(): Promise<DesktopSnapshot>;
    pushGitBranch(): Promise<DesktopSnapshot>;
    refreshGitSnapshot(): Promise<DesktopSnapshot>;
    abortConversation(): Promise<DesktopSnapshot>;
    continueAssistantCompletion(messageId: number): Promise<DesktopSnapshot>;
    rewindAndSubmitMessage(request: RewindAndSubmitMessageRequest): Promise<DesktopSnapshot>;
    poll(): Promise<DesktopSnapshot>;
    listDreamsOverview(): Promise<DesktopDreamOverviewItem[]>;
    dreamSubscribe(callback: (snapshot: DesktopSnapshot) => void): () => void;
    replyPendingApproval(decision: DesktopApprovalDecision): Promise<DesktopSnapshot>;
    replyPendingQuestions(result: AskQuestionsResult): Promise<DesktopSnapshot>;
    resetSession(): Promise<DesktopSnapshot>;
    listSessions(): Promise<SessionListItem[]>;
    openSession(path: string): Promise<DesktopSnapshot>;
    deleteSession(path: string): Promise<DesktopSnapshot>;
    listWorkspaceFileReferenceSuggestions(
      request: QueryWorkspaceFileReferenceSuggestionsRequest,
    ): Promise<WorkspaceFileReferenceSuggestionsResponse>;
    listWorkspaceExplorerChildren(relativePath: string): Promise<WorkspaceExplorerListResult>;
    readGitWorkingTree(): Promise<import('./types').GitWorkingTreeSnapshot>;
    readGitHistory(request?: import('./types').ReadGitHistoryRequest): Promise<import('./types').GitHistorySnapshot>;
    readWorkspaceTextFile(relativePath: string): Promise<WorkspaceReadTextFileResult>;
    writeWorkspaceTextFile(request: WriteWorkspaceTextFileRequest): Promise<void>;
    pickWorkspaceDirectory(): Promise<string | null>;
    pickLocalFile(): Promise<string | null>;
    ingestClipboardImage(): Promise<string | null>;
    listSystemFonts(): Promise<string[]>;
    readLocalImagePreviewDataUrl(filePath: string): Promise<string | null>;
    readManagedImagePreviewDataUrl(reference: string): Promise<string | null>;
    saveLocalImageAs(filePath: string): Promise<boolean>;
    syncWindowFrame(request: {
      dark: boolean;
      nativeTheme: 'system' | 'light' | 'dark';
    }): Promise<void>;
    syncLanguage(lang: string): Promise<void>;
    popupApplicationMenu(
      section: 'file' | 'edit' | 'view' | 'window' | 'help',
      clientX: number,
      clientY: number,
    ): Promise<void>;
    ptyCreate(request: {
      cwd: string;
      cols: number;
      rows: number;
    }): Promise<{ ok: true; id: string } | { ok: false; error: string }>;
    ptyWrite(id: string, data: string): void;
    ptyResize(id: string, cols: number, rows: number): void;
    ptyKill(id: string): Promise<void>;
    openSystemTerminal(cwd: string): Promise<void>;
    openExternalUrl(url: string): Promise<void>;
    subscribeBrowserOpenUrl(callback: (url: string) => void): () => void;
    listLocalListeningEndpoints(): Promise<
      Array<{ port: number; address?: string; processName?: string; url?: string; title?: string }>
    >;
    scanLocalListeners(): void;
    subscribeLocalListeners(callbacks: {
      onFound: (item: { port: number; address?: string; processName?: string; url?: string; title?: string }) => void;
      onDone: () => void;
    }): () => void;
    ptySubscribe(callbacks: {
      onData: (payload: { id: string; data: string }) => void;
      onExit: (payload: { id: string; exitCode: number; signal?: number }) => void;
    }): () => void;
    captureWebviewRect(
      webContentsId: number,
      rect: { x: number; y: number; width: number; height: number },
    ): Promise<string>;
    ingestBrowserElementScreenshot(base64: string): Promise<string | null>;
    readClipboardText(): string;
    writeClipboardText(text: string): void;
    showNotification(request: import('./lib/desktop-notification-types.js').DesktopShowNotificationRequest): Promise<boolean>;
    getAppAwayFromUser(): Promise<boolean>;
    reportRendererVisibility(hidden: boolean): Promise<boolean>;
    syncAttentionPending(flags: {
      needsApproval: boolean;
      needsQuestions: boolean;
      needsTaskComplete: boolean;
    }): Promise<void>;
    subscribeAppAwayChanged(callback: (away: boolean) => void): () => void;
    subscribeNotifyRefresh(callback: () => void): () => void;
    subscribeApprovalFromNotification(
      callback: (payload: { decision: 'allow' | 'deny' }) => void,
    ): () => void;
  }

  interface Window {
    spiritDesktop?: SpiritDesktopApi;
  }

  namespace JSX {
    interface IntrinsicElements {
      webview: React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & {
          src?: string;
          allowpopups?: boolean | string;
          partition?: string;
        },
        HTMLElement
      >;
    }
  }
}

export {};
