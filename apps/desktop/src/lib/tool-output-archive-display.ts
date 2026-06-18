import { isToolOutputArchivePath } from '@spirit-agent/host-internal/tool-output-archive-path';

export { isToolOutputArchivePath };

export function toolOutputArchiveHeadlineDetail(
  toolOutputLabel: string,
  lineRange = '',
): string {
  return `${toolOutputLabel}${lineRange}`.trim();
}
