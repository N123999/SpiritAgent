import { pathToFileURL } from 'node:url';

import { languageIdForExtension, relativePathFromWorkspace } from './paths.js';

export interface OpenDocumentRecord {
  uri: string;
  relativePath: string;
  languageId: string;
  version: number;
  text: string;
}

export class LspDocumentStore {
  private readonly documents = new Map<string, OpenDocumentRecord>();

  get(uri: string): OpenDocumentRecord | undefined {
    return this.documents.get(uri);
  }

  has(uri: string): boolean {
    return this.documents.has(uri);
  }

  open(input: {
    workspaceRoot: string;
    resolvedPath: string;
    text: string;
  }): OpenDocumentRecord {
    const uri = pathToFileURL(input.resolvedPath).href;
    const existing = this.documents.get(uri);
    const relativePath = relativePathFromWorkspace(input.workspaceRoot, input.resolvedPath);
    const languageId = languageIdForExtension(relativePath);
    const record: OpenDocumentRecord = {
      uri,
      relativePath,
      languageId,
      version: (existing?.version ?? 0) + 1,
      text: input.text,
    };
    this.documents.set(uri, record);
    return record;
  }

  replaceText(uri: string, text: string): OpenDocumentRecord | undefined {
    const existing = this.documents.get(uri);
    if (!existing) {
      return undefined;
    }
    const updated: OpenDocumentRecord = {
      ...existing,
      version: existing.version + 1,
      text,
    };
    this.documents.set(uri, updated);
    return updated;
  }

  close(uri: string): void {
    this.documents.delete(uri);
  }
}
