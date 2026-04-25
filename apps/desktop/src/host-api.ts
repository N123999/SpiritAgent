import type {
  AddModelRequest,
  AskQuestionsResult,
  BootstrapRequest,
  CreateSkillRequest,
  DeleteSkillRequest,
  DesktopSnapshot,
  RewindAndSubmitMessageRequest,
  SessionListItem,
  UpdateConfigRequest,
} from './types';

import { createElectronHostApi } from './adapters/electron';
import { createWebHostApi } from './adapters/web';

export interface HostApi {
  kind: 'electron' | 'web';
  bootstrap(request?: BootstrapRequest): Promise<DesktopSnapshot>;
  updateConfig(request: UpdateConfigRequest): Promise<DesktopSnapshot>;
  addModel(request: AddModelRequest): Promise<DesktopSnapshot>;
  removeModel(name: string): Promise<DesktopSnapshot>;
  createSkill(request: CreateSkillRequest): Promise<DesktopSnapshot>;
  deleteSkill(request: DeleteSkillRequest): Promise<DesktopSnapshot>;
  submitUserTurn(text: string): Promise<DesktopSnapshot>;
  rewindAndSubmitMessage(request: RewindAndSubmitMessageRequest): Promise<DesktopSnapshot>;
  poll(): Promise<DesktopSnapshot>;
  replyPendingApproval(message: string): Promise<DesktopSnapshot>;
  replyPendingQuestions(result: AskQuestionsResult): Promise<DesktopSnapshot>;
  resetSession(): Promise<DesktopSnapshot>;
  listSessions(): Promise<SessionListItem[]>;
  openSession(path: string): Promise<DesktopSnapshot>;
  pairWebHost?(code: string): Promise<void>;
}

export async function createHostApi(): Promise<HostApi> {
  if (typeof window !== 'undefined' && window.spiritDesktop) {
    return createElectronHostApi();
  }

  return createWebHostApi();
}
