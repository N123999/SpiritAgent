/**
 * Maps agent-core tool names to ACP ToolCall kinds and extracts metadata.
 *
 * ACP standard kinds: read, edit, delete, move, search, execute, think, fetch, other
 */
export function mapToolNameToKind(toolName: string): string {
  switch (toolName) {
    // File reading
    case 'read_file':
    case 'list_directory_files':
      return 'read';

    // Search
    case 'glob':
    case 'grep':
      return 'search';

    // File editing
    case 'create_file':
    case 'edit_file':
    case 'apply_patch':
      return 'edit';

    // File deletion
    case 'delete_file':
      return 'delete';

    // Command execution
    case 'run_shell_command':
      return 'execute';

    // Web
    case 'web_fetch':
    case 'web_search':
      return 'fetch';

    // Planning / thinking
    case 'create_plan':
      return 'think';

    // Everything else (MCP tools, generate_image, generate_video, etc.)
    default:
      return 'other';
  }
}

/**
 * Generates a human-readable title for a tool call.
 */
export function buildToolCallTitle(toolName: string, argumentsJson: string): string {
  try {
    const args = JSON.parse(argumentsJson) as Record<string, unknown>;

    switch (toolName) {
      case 'read_file':
        return `Reading ${formatPath(args['path'])}`;
      case 'list_directory_files':
        return `Listing ${formatPath(args['path'])}`;
      case 'create_file':
        return `Creating ${formatPath(args['path'])}`;
      case 'edit_file':
        return `Editing ${formatPath(args['path'])}`;
      case 'apply_patch':
        return 'Applying patch';
      case 'delete_file':
        return `Deleting ${formatPath(args['path'])}`;
      case 'run_shell_command':
        return `Running: ${truncate(String(args['command'] ?? ''), 60)}`;
      case 'glob':
        return `Searching files: ${String(args['pattern'] ?? '')}`;
      case 'grep':
        return `Searching: ${String(args['pattern'] ?? args['regex'] ?? '')}`;
      case 'web_fetch':
        return `Fetching ${String(args['url'] ?? '')}`;
      case 'web_search':
        return `Searching web: ${String(args['query'] ?? '')}`;
      case 'create_plan':
        return 'Creating plan';
      case 'generate_image':
        return 'Generating image';
      default:
        return toolName;
    }
  } catch {
    return toolName;
  }
}

/**
 * Extracts file locations from tool call arguments.
 */
export function extractToolCallLocations(argumentsJson: string): Array<{ path: string; line?: number }> {
  try {
    const args = JSON.parse(argumentsJson) as Record<string, unknown>;
    const path = args['path'] ?? args['file_path'] ?? args['file'];
    if (typeof path === 'string' && path.length > 0) {
      return [{ path }];
    }
    return [];
  } catch {
    return [];
  }
}

function formatPath(path: unknown): string {
  if (typeof path !== 'string') return '';
  // Show just the filename for readability
  const parts = path.replace(/\\/g, '/').split('/');
  return parts[parts.length - 1] ?? path;
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 1) + '…';
}
