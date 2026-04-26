import type { HostApi } from '../host-api';
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
} from '../types';

const DEFAULT_HOST_URL =
  import.meta.env.VITE_SPIRIT_HOST_URL?.toString().trim() || '';
const WEB_HOST_TOKEN_STORAGE_KEY = 'spirit-agent-web-host-token';

type WebHostPairingResponse = {
  token: string;
};

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
    createSkill(request: CreateSkillRequest) {
      return post<DesktopSnapshot>(baseUrl, '/api/skills', request);
    },
    deleteSkill(request: DeleteSkillRequest) {
      return post<DesktopSnapshot>(baseUrl, '/api/skills/remove', request);
    },
    submitUserTurn(text: string) {
      return post<DesktopSnapshot>(baseUrl, '/api/submit', { text });
    },
    rewindAndSubmitMessage(request: RewindAndSubmitMessageRequest) {
      return post<DesktopSnapshot>(baseUrl, '/api/rewind-submit', request);
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
    async pairWebHost(code: string) {
      const result = await post<WebHostPairingResponse>(baseUrl, '/api/pairing', { code }, {
        auth: false,
      });
      storeWebHostToken(result.token);
    },
  };
}

async function get<T>(baseUrl: string, path: string): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: authHeaders(),
  });
  if (!response.ok) {
    throw await responseError(response);
  }
  return (await response.json()) as T;
}

async function post<T>(
  baseUrl: string,
  path: string,
  body?: unknown,
  options?: { auth?: boolean },
): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(options?.auth === false ? {} : authHeaders()),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (!response.ok) {
    throw await responseError(response);
  }

  return (await response.json()) as T;
}

function authHeaders(): Record<string, string> {
  const token = readWebHostToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function readWebHostToken(): string | undefined {
  try {
    return localStorage.getItem(WEB_HOST_TOKEN_STORAGE_KEY)?.trim() || undefined;
  } catch {
    return undefined;
  }
}

function storeWebHostToken(token: string): void {
  try {
    localStorage.setItem(WEB_HOST_TOKEN_STORAGE_KEY, token);
  } catch {
    /* storage unavailable */
  }
}

async function responseError(response: Response): Promise<Error> {
  const text = await response.text();
  try {
    const parsed = JSON.parse(text) as { error?: string; code?: string };
    const error = new Error(parsed.error ?? text) as Error & {
      code?: string;
      status?: number;
    };
    error.code = parsed.code;
    error.status = response.status;
    return error;
  } catch {
    const error = new Error(text) as Error & { status?: number };
    error.status = response.status;
    return error;
  }
}
