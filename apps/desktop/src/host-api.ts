import type {
  AddModelRequest,
  AddMcpServerRequest,
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
  WorkspaceExplorerListResult,
  WorkspaceReadTextFileResult,
  WriteWorkspaceTextFileRequest,
  SubmitCreateSkillSlashRequest,
  SubmitSkillSlashRequest,
  UpdateConfigRequest,
} from './types';

import { createElectronHostApi } from './adapters/electron';
import { createWebHostApi } from './adapters/web';

export interface HostApi {
  kind: 'electron' | 'web';
  bootstrap(request?: BootstrapRequest): Promise<DesktopSnapshot>;
  updateConfig(request: UpdateConfigRequest): Promise<DesktopSnapshot>;
  addModel(request: AddModelRequest): Promise<DesktopSnapshot>;
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
  pairWebHost?(code: string): Promise<void>;
}

export async function createHostApi(): Promise<HostApi> {
  if (typeof window !== 'undefined' && window.spiritDesktop) {
    return createElectronHostApi();
  }

  return createWebHostApi();
}
