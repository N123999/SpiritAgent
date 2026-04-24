export interface HostAuthorizationDecision {
  outcome: 'allow' | 'deny' | 'ask-user';
  reason?: string;
}

export interface HostBuiltinToolService<
  ToolRequest,
  QuestionsRequest,
  QuestionsResult,
  McpStatus,
> {
  createRequest(name: string, argumentsJson: string): ToolRequest;
  authorize(request: ToolRequest): Promise<HostAuthorizationDecision>;
  execute(request: ToolRequest): Promise<string>;
  askQuestions(request: QuestionsRequest): Promise<QuestionsResult>;
  mcpStatus(): McpStatus;
}