/// <reference types="vite/client" />

import type {
  AddModelRequest,
  AskQuestionsResult,
  BootstrapRequest,
  CreateSkillRequest,
  DeleteSkillRequest,
  DesktopSnapshot,
  RewindAndSubmitMessageRequest,
  SessionListItem,
  SubmitSkillSlashRequest,
  UpdateConfigRequest,
} from './types';

declare global {
  interface SpiritDesktopApi {
    bootstrap(request?: BootstrapRequest): Promise<DesktopSnapshot>;
    updateConfig(request: UpdateConfigRequest): Promise<DesktopSnapshot>;
    addModel(request: AddModelRequest): Promise<DesktopSnapshot>;
    removeModel(name: string): Promise<DesktopSnapshot>;
    createSkill(request: CreateSkillRequest): Promise<DesktopSnapshot>;
    deleteSkill(request: DeleteSkillRequest): Promise<DesktopSnapshot>;
    submitSkillSlash(request: SubmitSkillSlashRequest): Promise<DesktopSnapshot>;
    submitUserTurn(text: string): Promise<DesktopSnapshot>;
    rewindAndSubmitMessage(request: RewindAndSubmitMessageRequest): Promise<DesktopSnapshot>;
    poll(): Promise<DesktopSnapshot>;
    replyPendingApproval(message: string): Promise<DesktopSnapshot>;
    replyPendingQuestions(result: AskQuestionsResult): Promise<DesktopSnapshot>;
    resetSession(): Promise<DesktopSnapshot>;
    listSessions(): Promise<SessionListItem[]>;
    openSession(path: string): Promise<DesktopSnapshot>;
    syncWindowFrame(request: {
      dark: boolean;
      nativeTheme: 'system' | 'light' | 'dark';
    }): Promise<void>;
    popupApplicationMenu(
      section: 'file' | 'edit' | 'view' | 'window' | 'help',
      clientX: number,
      clientY: number,
    ): Promise<void>;
  }

  interface Window {
    spiritDesktop?: SpiritDesktopApi;
  }
}

export {};