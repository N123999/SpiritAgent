import type { JsonObject } from '../ports.js';

export type LspDiagnosticSeverity = 1 | 2 | 3 | 4;

export interface LspPosition {
  line: number;
  character: number;
}

export interface LspRange {
  start: LspPosition;
  end: LspPosition;
}

export interface LspDiagnostic {
  range: LspRange;
  message: string;
  severity?: LspDiagnosticSeverity;
  code?: string | number;
  source?: string;
}

export type LspFileChangeKind = 'create_file' | 'edit_file' | 'delete_file';

export interface LspFileSnapshot {
  exists: boolean;
  content?: string;
}

export interface LspFileChangeNotification {
  kind: LspFileChangeKind;
  path: string;
  resolvedPath: string;
  before: LspFileSnapshot;
  after: LspFileSnapshot;
}

export interface LspDiagnosticsToolRequest extends JsonObject {
  name: 'get_diagnostics';
  path: string;
}

export interface LspDiagnosticUiItem {
  severity: 'error' | 'warning';
  line: number;
  column: number;
  message: string;
  code?: string | number;
  source?: string;
}

export interface LspWriteDiagnosticsUi {
  relativePath: string;
  items: LspDiagnosticUiItem[];
}
