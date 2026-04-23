/// <reference types="vite/client" />

import type {
  AskQuestionsResult,
  BootstrapRequest,
  DesktopSnapshot,
  SessionListItem,
  UpdateConfigRequest,
} from './types';

declare global {
  interface SpiritDesktopApi {
    bootstrap(request?: BootstrapRequest): Promise<DesktopSnapshot>;
    updateConfig(request: UpdateConfigRequest): Promise<DesktopSnapshot>;
    submitUserTurn(text: string): Promise<DesktopSnapshot>;
    poll(): Promise<DesktopSnapshot>;
    replyPendingApproval(message: string): Promise<DesktopSnapshot>;
    replyPendingQuestions(result: AskQuestionsResult): Promise<DesktopSnapshot>;
    resetSession(): Promise<DesktopSnapshot>;
    listSessions(): Promise<SessionListItem[]>;
    openSession(path: string): Promise<DesktopSnapshot>;
    setNativeTheme(theme: 'system' | 'light' | 'dark'): Promise<void>;
    syncWindowFrame(request: { dark: boolean }): Promise<void>;
  }

  interface Window {
    spiritDesktop?: SpiritDesktopApi;
  }
}

export {};