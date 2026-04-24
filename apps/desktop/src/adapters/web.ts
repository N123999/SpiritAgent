import type { HostApi } from '../host-api';
import type {
  AddModelRequest,
  AskQuestionsResult,
  BootstrapRequest,
  DesktopSnapshot,
  SessionListItem,
  UpdateConfigRequest,
} from '../types';

const DEFAULT_HOST_URL =
  import.meta.env.VITE_SPIRIT_HOST_URL?.toString().trim() || '';

export function createWebHostApi(): HostApi {
  const baseUrl = DEFAULT_HOST_URL || '';

  return {
    kind: 'web',
    bootstrap(request?: BootstrapRequest) {
      return post<DesktopSnapshot>(baseUrl, '/api/bootstrap', request ?? {});
    },
    updateConfig(request: UpdateConfigRequest) {
      return post<DesktopSnapshot>(baseUrl, '/api/config', request);
    },
    addModel(request: AddModelRequest) {
      return post<DesktopSnapshot>(baseUrl, '/api/models', request);
    },
    removeModel(name: string) {
      return post<DesktopSnapshot>(baseUrl, '/api/models/remove', { name });
    },
    submitUserTurn(text: string) {
      return post<DesktopSnapshot>(baseUrl, '/api/submit', { text });
    },
    poll() {
      return post<DesktopSnapshot>(baseUrl, '/api/poll');
    },
    replyPendingApproval(message: string) {
      return post<DesktopSnapshot>(baseUrl, '/api/approval', { message });
    },
    replyPendingQuestions(result: AskQuestionsResult) {
      return post<DesktopSnapshot>(baseUrl, '/api/questions', { result });
    },
    resetSession() {
      return post<DesktopSnapshot>(baseUrl, '/api/reset');
    },
    listSessions() {
      return get<SessionListItem[]>(baseUrl, '/api/sessions');
    },
    openSession(path: string) {
      return post<DesktopSnapshot>(baseUrl, '/api/sessions/open', { path });
    },
  };
}

async function get<T>(baseUrl: string, path: string): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`);
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return (await response.json()) as T;
}

async function post<T>(
  baseUrl: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return (await response.json()) as T;
}