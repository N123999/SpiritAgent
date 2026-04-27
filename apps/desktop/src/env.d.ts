/// <reference types="vite/client" />

import type {
  AddModelRequest,
  AddMcpServerRequest,
  AddProviderModelsRequest,
  AskQuestionsResult,
  BootstrapRequest,
  CreateSkillRequest,
  DeleteMcpServerRequest,
  DeleteSkillRequest,
  DesktopMcpServerInspection,
  DesktopSnapshot,
  PreviewModelsRequest,
  PreviewModelsResponse,
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
    updateConfig(request: UpdateConfigRequest): Promise<DesktopSnapshot>;
    addModel(request: AddModelRequest): Promise<DesktopSnapshot>;
    addProviderModels(request: AddProviderModelsRequest): Promise<DesktopSnapshot>;
    previewModels(request: PreviewModelsRequest): Promise<PreviewModelsResponse>;
    removeModel(name: string): Promise<DesktopSnapshot>;
    addMcpServer(request: AddMcpServerRequest): Promise<DesktopSnapshot>;
    deleteMcpServer(request: DeleteMcpServerRequest): Promise<DesktopSnapshot>;
    inspectMcpServer(name: string): Promise<DesktopMcpServerInspection>;
    createSkill(request: CreateSkillRequest): Promise<DesktopSnapshot>;
    deleteSkill(request: DeleteSkillRequest): Promise<DesktopSnapshot>;
    submitCreateSkillSlash(request: SubmitCreateSkillSlashRequest): Promise<DesktopSnapshot>;
    submitSkillSlash(request: SubmitSkillSlashRequest): Promise<DesktopSnapshot>;
    submitUserTurn(text: string): Promise<DesktopSnapshot>;
    rewindAndSubmitMessage(request: RewindAndSubmitMessageRequest): Promise<DesktopSnapshot>;
    poll(): Promise<DesktopSnapshot>;
    replyPendingApproval(message: string): Promise<DesktopSnapshot>;
    replyPendingQuestions(result: AskQuestionsResult): Promise<DesktopSnapshot>;
    resetSession(): Promise<DesktopSnapshot>;
    listSessions(): Promise<SessionListItem[]>;
    openSession(path: string): Promise<DesktopSnapshot>;
    listWorkspaceExplorerChildren(relativePath: string): Promise<WorkspaceExplorerListResult>;
    readWorkspaceTextFile(relativePath: string): Promise<WorkspaceReadTextFileResult>;
    writeWorkspaceTextFile(request: WriteWorkspaceTextFileRequest): Promise<void>;
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