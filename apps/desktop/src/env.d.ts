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
  DesktopDreamOverviewItem,
  DesktopMarketplaceCatalogItem,
  DesktopMarketplaceDetail,
  DesktopMarketplacePreparedInstall,
  DeleteSkillRequest,
  DesktopMcpServerInspection,
  DesktopSnapshot,
  ImportExtensionRequest,
  InstallMarketplaceExtensionRequest,
  PrepareMarketplaceExtensionInstallRequest,
  RunExtensionRequest,
  UpdateExtensionSecretRequest,
  UpdateExtensionSettingsRequest,
  PreviewModelsRequest,
  PreviewModelsResponse,
  RememberWorkspaceRequest,
  RewindAndSubmitMessageRequest,
  SessionListItem,
  SubmitCreateSkillSlashRequest,
  SubmitSkillSlashRequest,
  UpdateConfigRequest,
  WorkspaceExplorerListResult,
  WorkspaceReadTextFileResult,
  WriteWorkspaceTextFileRequest,
} from './types';

declare global {
  interface SpiritDesktopApi {
    bootstrap(request?: BootstrapRequest): Promise<DesktopSnapshot>;
    rememberWorkspaceRoot(request: RememberWorkspaceRequest): Promise<DesktopSnapshot>;
    commitChanges(request: CommitChangesRequest): Promise<DesktopSnapshot>;
    updateConfig(request: UpdateConfigRequest): Promise<DesktopSnapshot>;
    addModel(request: AddModelRequest): Promise<DesktopSnapshot>;
    addProviderModels(request: AddProviderModelsRequest): Promise<DesktopSnapshot>;
    previewModels(request: PreviewModelsRequest): Promise<PreviewModelsResponse>;
    removeModel(name: string): Promise<DesktopSnapshot>;
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
    submitUserTurn(text: string): Promise<DesktopSnapshot>;
    abortConversation(): Promise<DesktopSnapshot>;
    rewindAndSubmitMessage(request: RewindAndSubmitMessageRequest): Promise<DesktopSnapshot>;
    poll(): Promise<DesktopSnapshot>;
    listDreamsOverview(): Promise<DesktopDreamOverviewItem[]>;
    dreamSubscribe(callback: (snapshot: DesktopSnapshot) => void): () => void;
    replyPendingApproval(message: string): Promise<DesktopSnapshot>;
    replyPendingQuestions(result: AskQuestionsResult): Promise<DesktopSnapshot>;
    resetSession(): Promise<DesktopSnapshot>;
    listSessions(): Promise<SessionListItem[]>;
    openSession(path: string): Promise<DesktopSnapshot>;
    listWorkspaceExplorerChildren(relativePath: string): Promise<WorkspaceExplorerListResult>;
    readWorkspaceTextFile(relativePath: string): Promise<WorkspaceReadTextFileResult>;
    writeWorkspaceTextFile(request: WriteWorkspaceTextFileRequest): Promise<void>;
    pickWorkspaceDirectory(): Promise<string | null>;
    syncWindowFrame(request: {
      dark: boolean;
      nativeTheme: 'system' | 'light' | 'dark';
    }): Promise<void>;
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
    ptySubscribe(callbacks: {
      onData: (payload: { id: string; data: string }) => void;
      onExit: (payload: { id: string; exitCode: number; signal?: number }) => void;
    }): () => void;
    readClipboardText(): string;
    writeClipboardText(text: string): void;
  }

  interface Window {
    spiritDesktop?: SpiritDesktopApi;
  }
}

export {};
