export class HookConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HookConfigError';
  }
}

export class HookDeniedError extends Error {
  readonly userMessage: string | undefined;
  readonly agentMessage: string | undefined;
  readonly hookEventName: string;

  constructor(options: {
    hookEventName: string;
    userMessage: string | undefined;
    agentMessage: string | undefined;
    message?: string;
  }) {
    super(options.message ?? options.userMessage ?? 'Hook denied this action.');
    this.name = 'HookDeniedError';
    this.hookEventName = options.hookEventName;
    this.userMessage = options.userMessage;
    this.agentMessage = options.agentMessage;
  }
}
