export const SKILL_WIRE_PREFIX = "Referenced skill ";

export type ParsedSkillWireBlock = {
  index: number;
  length: number;
  alias: string;
};

/** Wire-format skill chip (inline, explicit composer insertion only). */
export function skillContextText(alias: string): string {
  return `${SKILL_WIRE_PREFIX}\`${alias}\``;
}

function parseSkillWireValue(value: string): string | null {
  const parsedAlias = value.trim();
  if (!parsedAlias.startsWith("/")) {
    return null;
  }
  return parsedAlias;
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

/** Scan wire text for explicit skill chip blocks. */
export function scanSkillWireBlocks(content: string): ParsedSkillWireBlock[] {
  return scanBacktickDelimitedWireBlocks(
    content,
    SKILL_WIRE_PREFIX,
    parseSkillWireValue,
  ).map((block) => ({
    index: block.index,
    length: block.length,
    alias: block.value,
  }));
}
