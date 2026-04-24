export interface HostStoragePaths {
  workspaceRoot?: string;
  appDataDir: string;
  configFile: string;
  chatsDir: string;
  planFile: string;
}

export interface HostSessionIndexEntry {
  path: string;
  updatedAt: number;
}

export interface HostStateStorage<Config, Session> {
  readonly paths: HostStoragePaths;
  loadConfig(): Promise<Config>;
  saveConfig(config: Config): Promise<void>;
  loadSession(path: string): Promise<Session | undefined>;
  saveSession(path: string, session: Session): Promise<void>;
  listSessions(): Promise<readonly HostSessionIndexEntry[]>;
}