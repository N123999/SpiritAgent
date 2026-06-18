import {
  readFileHeadlineDetailForPath,
  readFileVerbKey,
} from './read-file-skill-display.js';
import {
  isToolOutputArchivePath,
  toolOutputArchiveHeadlineDetail,
} from './tool-output-archive-display.js';

export function readFileToolHeadlineDetail(
  rawPath: string,
  options: {
    emptyFileLabel: string;
    toolOutputLabel: string;
    lineRange?: string;
  },
): string {
  const lineRange = options.lineRange ?? '';
  if (isToolOutputArchivePath(rawPath)) {
    return toolOutputArchiveHeadlineDetail(options.toolOutputLabel, lineRange);
  }
  return readFileHeadlineDetailForPath(rawPath, {
    emptyFileLabel: options.emptyFileLabel,
    lineRange,
  });
}

export { readFileVerbKey };
