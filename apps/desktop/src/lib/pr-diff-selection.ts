export type PrDiffLineRange = {
  lineStart: number;
  lineEnd: number;
};

function parseGutterLineNumber(gutter: Element): number | null {
  const text = gutter.textContent?.trim() ?? "";
  if (!text || !/^\d+$/u.test(text)) {
    return null;
  }
  return Number(text);
}

function diffLineFromNode(node: Node | null): HTMLTableRowElement | null {
  let current: Node | null = node;
  while (current) {
    if (current instanceof HTMLTableRowElement && current.classList.contains("diff-line")) {
      return current;
    }
    current = current.parentNode;
  }
  return null;
}

function lineNumberFromDiffRow(row: HTMLTableRowElement): number | null {
  const gutter = row.querySelector(".diff-gutter");
  if (!gutter) {
    return null;
  }
  return parseGutterLineNumber(gutter);
}

function collectDiffLinesInRange(range: Range, root: HTMLElement): HTMLTableRowElement[] {
  const rows = Array.from(root.querySelectorAll("tr.diff-line")).filter(
    (row): row is HTMLTableRowElement => row instanceof HTMLTableRowElement,
  );
  return rows.filter((row) => {
    try {
      return range.intersectsNode(row);
    } catch {
      return false;
    }
  });
}

/** Resolve unified diff gutter line numbers for the current DOM selection. */
export function resolveDiffSelectionLineRange(root: HTMLElement, selection: Selection | null): PrDiffLineRange | null {
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return null;
  }
  const range = selection.getRangeAt(0);
  if (!root.contains(range.commonAncestorContainer)) {
    return null;
  }

  const rows = collectDiffLinesInRange(range, root);
  const lineNumbers = rows
    .map((row) => lineNumberFromDiffRow(row))
    .filter((value): value is number => value != null);

  if (lineNumbers.length > 0) {
    return {
      lineStart: Math.min(...lineNumbers),
      lineEnd: Math.max(...lineNumbers),
    };
  }

  const startRow = diffLineFromNode(range.startContainer);
  const endRow = diffLineFromNode(range.endContainer);
  const fallback = [startRow, endRow]
    .filter((row): row is HTMLTableRowElement => row != null)
    .map((row) => lineNumberFromDiffRow(row))
    .filter((value): value is number => value != null);

  if (fallback.length === 0) {
    return null;
  }

  return {
    lineStart: Math.min(...fallback),
    lineEnd: Math.max(...fallback),
  };
}

export function readDiffSelectionText(selection: Selection | null): string {
  return selection?.toString().trim() ?? "";
}
