const DEFAULT_SUGGESTION_LIMIT = 128;

/** Trailing slash marks directory entries in suggestion lists. */
export const WORKSPACE_REFERENCE_DIRECTORY_SUFFIX = '/';

export interface ActiveWorkspaceFileReferenceQuery {
  start: number;
  end: number;
  raw: string;
}

export interface WorkspaceFileReferenceSuggestionsResult {
  query: ActiveWorkspaceFileReferenceQuery;
  suggestions: string[];
  indexReady?: boolean;
}

export function currentWorkspaceFileReferenceQuery(
  input: string,
  cursorChars: number,
): ActiveWorkspaceFileReferenceQuery | undefined {
  const cursor = charCountToCodeUnitIndex(input, cursorChars);
  const start = tokenStart(input, cursor);
  const end = tokenEnd(input, cursor);
  if (start >= end) {
    return undefined;
  }

  const token = input.slice(start, end);
  if (!token.startsWith('@') || token.includes('\n')) {
    return undefined;
  }

  return {
    start: codeUnitIndexToCharCount(input, start),
    end: codeUnitIndexToCharCount(input, end),
    raw: token,
  };
}

export function replaceWorkspaceFileReferenceQuery(
  input: string,
  query: ActiveWorkspaceFileReferenceQuery,
  path: string,
  finalize: boolean,
): { text: string; cursorChars: number } {
  let replacement = `@${path}`;
  const queryEndCodeUnits = charCountToCodeUnitIndex(input, query.end);
  const nextChar = input.slice(queryEndCodeUnits).charAt(0);
  const needsSpace = nextChar.length === 0 || !/\s/u.test(nextChar);
  if (finalize && needsSpace) {
    replacement += ' ';
  }

  const queryStartCodeUnits = charCountToCodeUnitIndex(input, query.start);
  const text = `${input.slice(0, queryStartCodeUnits)}${replacement}${input.slice(queryEndCodeUnits)}`;

  return {
    text,
    cursorChars: query.start + Array.from(replacement).length,
  };
}

export function referencedWorkspaceFilePathsFromInput(input: string): string[] {
  const seen = new Set<string>();
  const paths: string[] = [];

  for (const token of input.split(/\s+/u)) {
    const path = token.startsWith('@') ? token.slice(1) : undefined;
    if (!path) {
      continue;
    }

    const normalized = path.replace(/\\/gu, '/');
    if (seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    paths.push(normalized);
  }

  return paths;
}

export function isWorkspaceReferenceDirectoryPath(path: string): boolean {
  return path.endsWith(WORKSPACE_REFERENCE_DIRECTORY_SUFFIX) && path.length > 1;
}

export function normalizeWorkspaceReferenceDirectoryPath(path: string): string {
  return path.replace(/\/+$/u, '');
}

export function deriveWorkspaceDirectoryPathsFromFiles(files: readonly string[]): string[] {
  const directories = new Set<string>();

  for (const file of files) {
    const segments = file.split('/').filter((segment) => segment.length > 0);
    for (let index = 1; index < segments.length; index += 1) {
      directories.add(`${segments.slice(0, index).join('/')}${WORKSPACE_REFERENCE_DIRECTORY_SUFFIX}`);
    }
  }

  return Array.from(directories);
}

export function computeWorkspaceFileReferenceSuggestions(
  query: string,
  files: readonly string[],
  options?: { includeDirectories?: boolean },
): string[] {
  const needle = query
    .replace(/^@/u, '')
    .trim()
    .toLowerCase();

  const includeDirectories = options?.includeDirectories !== false;
  const directories = includeDirectories ? deriveWorkspaceDirectoryPathsFromFiles(files) : [];
  const candidates = [...directories, ...files];

  const scored = candidates
    .map((path) => {
      const isDirectory = isWorkspaceReferenceDirectoryPath(path);
      const score = scoreWorkspaceFileReferenceCandidate(needle, path);
      if (!score) {
        return undefined;
      }

      return {
        score: score.score,
        isDirectory,
        basenameLength: score.basenameLength,
        pathLength: score.pathLength,
        path,
      };
    })
    .filter(
      (
        item,
      ): item is {
        score: number;
        isDirectory: boolean;
        basenameLength: number;
        pathLength: number;
        path: string;
      } => item !== undefined,
    );

  scored.sort((left, right) => {
    return (
      right.score - left.score ||
      Number(right.isDirectory) - Number(left.isDirectory) ||
      left.basenameLength - right.basenameLength ||
      left.pathLength - right.pathLength ||
      left.path.localeCompare(right.path)
    );
  });

  return scored.slice(0, DEFAULT_SUGGESTION_LIMIT).map((item) => item.path);
}

export function charCountToCodeUnitIndex(input: string, cursorChars: number): number {
  if (cursorChars <= 0) {
    return 0;
  }

  let chars = 0;
  for (let index = 0; index < input.length; ) {
    if (chars === cursorChars) {
      return index;
    }
    const codePoint = input.codePointAt(index);
    if (codePoint === undefined) {
      break;
    }
    index += codePoint > 0xffff ? 2 : 1;
    chars += 1;
  }

  return input.length;
}

export function codeUnitIndexToCharCount(input: string, codeUnitIndex: number): number {
  let chars = 0;
  for (let index = 0; index < codeUnitIndex; ) {
    const codePoint = input.codePointAt(index);
    if (codePoint === undefined) {
      break;
    }
    index += codePoint > 0xffff ? 2 : 1;
    chars += 1;
  }
  return chars;
}

function tokenStart(input: string, cursor: number): number {
  for (let index = cursor; index > 0; ) {
    const previousIndex = previousCodePointIndex(input, index);
    const codePoint = input.codePointAt(previousIndex);
    if (codePoint === undefined) {
      break;
    }

    const char = String.fromCodePoint(codePoint);
    if (/\s/u.test(char)) {
      return index;
    }
    index = previousIndex;
  }

  return 0;
}

function tokenEnd(input: string, cursor: number): number {
  for (let index = cursor; index < input.length; ) {
    const codePoint = input.codePointAt(index);
    if (codePoint === undefined) {
      break;
    }

    const char = String.fromCodePoint(codePoint);
    if (/\s/u.test(char)) {
      return index;
    }
    index += codePoint > 0xffff ? 2 : 1;
  }

  return input.length;
}

function previousCodePointIndex(input: string, fromIndex: number): number {
  const previousIndex = fromIndex - 1;
  if (previousIndex <= 0) {
    return 0;
  }

  const codeUnit = input.charCodeAt(previousIndex);
  if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
    return previousIndex - 1;
  }
  return previousIndex;
}

function referencePathBasename(path: string): string {
  const normalized = normalizeWorkspaceReferenceDirectoryPath(path);
  return normalized.split('/').at(-1) ?? normalized;
}

function scoreWorkspaceFileReferenceCandidate(
  needle: string,
  path: string,
): { score: number; basenameLength: number; pathLength: number } | undefined {
  const normalizedPath = normalizeWorkspaceReferenceDirectoryPath(path);
  const pathLower = normalizedPath.toLowerCase();
  const basename = referencePathBasename(path);
  const basenameLower = basename.toLowerCase();
  const basenameLength = Array.from(basename).length;
  const pathLength = Array.from(normalizedPath).length;
  const isDirectory = isWorkspaceReferenceDirectoryPath(path);

  if (!needle) {
    return { score: isDirectory ? 1 : 0, basenameLength, pathLength };
  }
  if (basenameLower === needle) {
    return { score: isDirectory ? 10_100 : 10_000, basenameLength, pathLength };
  }
  if (pathLower === needle) {
    return { score: 9_700, basenameLength, pathLength };
  }
  if (basenameLower.startsWith(needle)) {
    return { score: 9_400 - basenameLength, basenameLength, pathLength };
  }
  if (pathLower.endsWith(needle)) {
    return { score: 9_100 - pathLength, basenameLength, pathLength };
  }

  const basenamePosition = basenameLower.indexOf(needle);
  if (basenamePosition >= 0) {
    return { score: 8_600 - basenamePosition * 10, basenameLength, pathLength };
  }

  const pathPosition = pathLower.indexOf(needle);
  if (pathPosition >= 0) {
    return { score: 8_100 - pathPosition, basenameLength, pathLength };
  }

  const basenameSubsequenceScore = subsequenceScore(needle, basenameLower);
  if (basenameSubsequenceScore !== undefined) {
    return { score: 7_000 + basenameSubsequenceScore, basenameLength, pathLength };
  }

  const pathSubsequenceScore = subsequenceScore(needle, pathLower);
  if (pathSubsequenceScore !== undefined) {
    return { score: 6_000 + pathSubsequenceScore, basenameLength, pathLength };
  }

  return undefined;
}

function subsequenceScore(needle: string, haystack: string): number | undefined {
  const needleChars = Array.from(needle);
  const haystackChars = Array.from(haystack);
  let haystackIndex = 0;
  let firstMatch: number | undefined;
  let lastMatch = 0;
  let consecutiveBonus = 0;
  let previousMatch: number | undefined;

  for (const needleChar of needleChars) {
    let found: number | undefined;
    while (haystackIndex < haystackChars.length) {
      if (haystackChars[haystackIndex] === needleChar) {
        found = haystackIndex;
        haystackIndex += 1;
        break;
      }
      haystackIndex += 1;
    }

    if (found === undefined) {
      return undefined;
    }

    firstMatch ??= found;
    if (previousMatch !== undefined && found === previousMatch + 1) {
      consecutiveBonus += 12;
    }
    previousMatch = found;
    lastMatch = found;
  }

  if (firstMatch === undefined) {
    return undefined;
  }

  const span = lastMatch - firstMatch;
  return 1_000 - span - firstMatch + consecutiveBonus;
}