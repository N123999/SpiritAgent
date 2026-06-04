export class LspDisabledError extends Error {
  constructor(message = 'Language server diagnostics are not available in this environment.') {
    super(message);
    this.name = 'LspDisabledError';
  }
}

export class LspTimeoutError extends Error {
  constructor(message = 'Timed out waiting for language server diagnostics.') {
    super(message);
    this.name = 'LspTimeoutError';
  }
}

export class LspPathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LspPathError';
  }
}
