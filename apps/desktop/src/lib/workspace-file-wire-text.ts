export const WORKSPACE_FILE_WIRE_PREFIX = "Referenced workspace file ";

export type ParsedWorkspaceFileWireBlock = {
  index: number;
  length: number;
  path: string;
};

/** Wire-format workspace file chip (inline, explicit composer insertion only). */
export function workspaceFileContextText(path: string): string {
  const normalized = path.replace(/\\/gu, "/");
  return `${WORKSPACE_FILE_WIRE_PREFIX}\`${normalized}\``;
}

function parseWorkspaceFileWireValue(value: string): string | null {
  const parsedPath = value.trim();
  return parsedPath ? parsedPath.replace(/\\/gu, "/") : null;
}

function scanBacktickDelimitedWireBlocks(
  content: string,
  prefix: string,
  parseValue: (value: string) => string | null,
): Array<{ index: number; length: number; value: string }> {
  const blocks: Array<{ index: number; length: number; value: string }> = [];
  let searchFrom = 0;

  while (searchFrom < content.length) {
    const headerIndex = content.indexOf(prefix, searchFrom);
    if (headerIndex === -1) {
      break;
    }

    const valueStart = headerIndex + prefix.length;
    if (content[valueStart] !== "`") {
      searchFrom = headerIndex + 1;
      continue;
    }

    const valueEnd = content.indexOf("`", valueStart + 1);
    if (valueEnd === -1) {
      break;
    }

    const rawValue = content.slice(valueStart + 1, valueEnd);
    const parsed = parseValue(rawValue);
    if (!parsed) {
      searchFrom = headerIndex + 1;
      continue;
    }

    const length = valueEnd + 1 - headerIndex;
    blocks.push({ index: headerIndex, length, value: parsed });
    searchFrom = headerIndex + length;
  }

  return blocks;
}

/** Scan wire text for explicit workspace file chip blocks. */
export function scanWorkspaceFileWireBlocks(content: string): ParsedWorkspaceFileWireBlock[] {
  return scanBacktickDelimitedWireBlocks(
    content,
    WORKSPACE_FILE_WIRE_PREFIX,
    parseWorkspaceFileWireValue,
  ).map((block) => ({
    index: block.index,
    length: block.length,
    path: block.value,
  }));
}
