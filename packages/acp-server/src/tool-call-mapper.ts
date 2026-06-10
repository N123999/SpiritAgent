/**
 * Maps agent-core tool names to ACP ToolCall kinds.
 *
 * ACP standard kinds: read, edit, delete, move, search, execute, think, fetch, other
 *
 * Stub: to be enhanced in Phase 4 with title and locations extraction.
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
