import type { ConversationMessageSnapshot, MessageAuxSnapshot, ToolBlockSnapshot } from '../types.js';
import {
  DesktopMessageTimeline,
  type DesktopTimelineRowKind,
  type DesktopTimelineRowSnapshot,
  type DesktopTimelineSegmentSnapshot,
  type DesktopTimelineTurnSnapshot,
} from './message-timeline.js';
import {
  normalizeMessageAuxSnapshot,
  normalizeToolBlockSnapshot,
} from './message-ordering.js';

export const CHAT_SCHEMA_VERSION = 2 as const;

export type ChatSchemaVersion = typeof CHAT_SCHEMA_VERSION;

export class ChatSessionSchemaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ChatSessionSchemaError';
  }
}

export type PersistedDesktopTimelineRowSnapshot = Omit<DesktopTimelineRowSnapshot, 'content'> & {
  content?: string;
};

export type PersistedDesktopTimelineSegmentSnapshot = Omit<DesktopTimelineSegmentSnapshot, 'rows'> & {
  rows: PersistedDesktopTimelineRowSnapshot[];
};

export type PersistedDesktopTimelineTurnSnapshot = Omit<DesktopTimelineTurnSnapshot, 'userRow' | 'segments'> & {
  userRow?: PersistedDesktopTimelineRowSnapshot;
  segments: PersistedDesktopTimelineSegmentSnapshot[];
};

const ROW_KINDS_WITHOUT_CONTENT: ReadonlySet<DesktopTimelineRowKind> = new Set([
  'assistant-thinking',
  'assistant-compaction',
  'tool',
]);

function rowPath(turnIndex: number, segmentIndex: number | undefined, rowIndex: number | undefined): string {
  if (segmentIndex === undefined) {
    return `desktopMessageTimeline[${turnIndex}].userRow`;
  }
  if (rowIndex === undefined) {
    return `desktopMessageTimeline[${turnIndex}].segments[${segmentIndex}]`;
  }
  return `desktopMessageTimeline[${turnIndex}].segments[${segmentIndex}].rows[${rowIndex}]`;
}

function hasPersistedContent(content: string | undefined): boolean {
  return typeof content === 'string' && content.length > 0;
}

function hasTrimmedContent(content: string | undefined): boolean {
  return typeof content === 'string' && content.trim().length > 0;
}

function cloneAux(aux: MessageAuxSnapshot | undefined): MessageAuxSnapshot | undefined {
  if (!aux) {
    return undefined;
  }
  return {
    ...(aux.thinking ? { thinking: aux.thinking } : {}),
    ...(aux.compaction ? { compaction: aux.compaction } : {}),
    ...(aux.finishTaskNotice ? { finishTaskNotice: aux.finishTaskNotice } : {}),
  };
}

function cloneRowForPersistence(row: DesktopTimelineRowSnapshot): PersistedDesktopTimelineRowSnapshot | undefined {
  const tool = normalizeToolBlockSnapshot(row.tool);
  const aux = normalizeMessageAuxSnapshot(row.aux);
  const base = {
    rowId: row.rowId,
    messageId: row.messageId,
    turnId: row.turnId,
    ...(row.segmentId !== undefined ? { segmentId: row.segmentId } : {}),
    kind: row.kind,
    ...(row.section ? { section: row.section } : {}),
    createdOrder: row.createdOrder,
    pending: false as const,
    ...(row.canContinue ? { canContinue: true as const } : {}),
  };

  if (row.kind === 'assistant-text') {
    if (!hasTrimmedContent(row.content)) {
      return undefined;
    }
    return {
      ...base,
      content: row.content,
      ...(row.localFileAttachments?.length
        ? { localFileAttachments: row.localFileAttachments.map((attachment) => ({ ...attachment })) }
        : {}),
      ...(aux ? { aux } : {}),
    };
  }

  if (row.kind === 'user') {
    if (!hasTrimmedContent(row.content)) {
      return undefined;
    }
    return {
      ...base,
      content: row.content,
      ...(row.localFileAttachments?.length
        ? { localFileAttachments: row.localFileAttachments.map((attachment) => ({ ...attachment })) }
        : {}),
    };
  }

  if (row.kind === 'assistant-thinking') {
    if (!aux?.thinking?.trim()) {
      return undefined;
    }
    return {
      ...base,
      aux: { thinking: aux.thinking },
    };
  }

  if (row.kind === 'assistant-compaction') {
    if (!aux?.compaction?.trim()) {
      return undefined;
    }
    return {
      ...base,
      aux: { compaction: aux.compaction },
    };
  }

  if (row.kind === 'tool') {
    if (!tool) {
      return undefined;
    }
    return {
      ...base,
      tool,
    };
  }

  if (row.kind === 'standalone-subagent-status') {
    const hasContent = hasTrimmedContent(row.content);
    const hasAux = Boolean(aux?.finishTaskNotice?.trim());
    if (!hasContent && !hasAux) {
      return undefined;
    }
    return {
      ...base,
      ...(hasContent ? { content: row.content } : {}),
      ...(aux ? { aux: cloneAux(aux) } : {}),
    };
  }

  return undefined;
}

function normalizeSegmentForPersistence(
  segment: DesktopTimelineSegmentSnapshot,
): PersistedDesktopTimelineSegmentSnapshot | undefined {
  const rows = segment.rows
    .map((row) => cloneRowForPersistence(row))
    .filter((row): row is PersistedDesktopTimelineRowSnapshot => row !== undefined);
  if (rows.length === 0) {
    return undefined;
  }
  return {
    segmentId: segment.segmentId,
    turnId: segment.turnId,
    kind: segment.kind,
    status: segment.status === 'streaming' ? 'completed' : segment.status,
    createdOrder: segment.createdOrder,
    rows,
  };
}

export function normalizeTimelineSnapshotForPersistence(
  snapshot: DesktopTimelineTurnSnapshot[],
): PersistedDesktopTimelineTurnSnapshot[] {
  return snapshot.flatMap((turn) => {
    const userRow = turn.userRow ? cloneRowForPersistence(turn.userRow) : undefined;
    const segments = turn.segments
      .map((segment) => normalizeSegmentForPersistence(segment))
      .filter((segment): segment is PersistedDesktopTimelineSegmentSnapshot => segment !== undefined);
    if (!userRow && segments.length === 0) {
      return [];
    }
    return [{
      turnId: turn.turnId,
      createdOrder: turn.createdOrder,
      ...(userRow ? { userRow } : {}),
      segments,
    }];
  });
}

function validatePersistedTimelineRowV2(
  row: PersistedDesktopTimelineRowSnapshot,
  path: string,
): void {
  if (row.pending) {
    throw new ChatSessionSchemaError(`${path}: pending rows are not allowed in chat schema v2`);
  }

  if (ROW_KINDS_WITHOUT_CONTENT.has(row.kind) && row.content !== undefined) {
    throw new ChatSessionSchemaError(`${path}: ${row.kind} rows must not include content in chat schema v2`);
  }

  const tool = normalizeToolBlockSnapshot(row.tool);
  const aux = normalizeMessageAuxSnapshot(row.aux);

  switch (row.kind) {
    case 'user':
      if (!hasTrimmedContent(row.content)) {
        throw new ChatSessionSchemaError(`${path}: user rows require non-empty content`);
      }
      return;
    case 'assistant-text':
      if (!hasTrimmedContent(row.content)) {
        throw new ChatSessionSchemaError(`${path}: assistant-text rows require non-empty content`);
      }
      if (tool) {
        throw new ChatSessionSchemaError(`${path}: assistant-text rows must not include tool`);
      }
      return;
    case 'assistant-thinking':
      if (!aux?.thinking?.trim()) {
        throw new ChatSessionSchemaError(`${path}: assistant-thinking rows require aux.thinking`);
      }
      return;
    case 'assistant-compaction':
      if (!aux?.compaction?.trim()) {
        throw new ChatSessionSchemaError(`${path}: assistant-compaction rows require aux.compaction`);
      }
      return;
    case 'tool':
      if (!tool) {
        throw new ChatSessionSchemaError(`${path}: tool rows require tool`);
      }
      return;
    case 'standalone-subagent-status':
      if (!hasTrimmedContent(row.content) && !aux?.finishTaskNotice?.trim()) {
        throw new ChatSessionSchemaError(
          `${path}: standalone-subagent-status rows require content or aux.finishTaskNotice`,
        );
      }
      return;
    default:
      throw new ChatSessionSchemaError(`${path}: unknown row kind`);
  }
}

export function validateTimelineSnapshotV2(snapshot: PersistedDesktopTimelineTurnSnapshot[]): void {
  if (!Array.isArray(snapshot) || snapshot.length === 0) {
    throw new ChatSessionSchemaError('desktopMessageTimeline must be a non-empty array in chat schema v2');
  }

  snapshot.forEach((turn, turnIndex) => {
    if (turn.userRow) {
      validatePersistedTimelineRowV2(turn.userRow, rowPath(turnIndex, undefined, undefined));
    }
    turn.segments.forEach((segment, segmentIndex) => {
      segment.rows.forEach((row, rowIndex) => {
        validatePersistedTimelineRowV2(row, rowPath(turnIndex, segmentIndex, rowIndex));
      });
    });
    if (!turn.userRow && turn.segments.every((segment) => segment.rows.length === 0)) {
      throw new ChatSessionSchemaError(`desktopMessageTimeline[${turnIndex}] has no persistable rows`);
    }
  });
}

export function assertChatSchemaVersionV2(version: unknown): asserts version is ChatSchemaVersion {
  if (version !== CHAT_SCHEMA_VERSION) {
    throw new ChatSessionSchemaError(
      `chat schema v2 required (chatSchemaVersion=${CHAT_SCHEMA_VERSION}), got ${String(version)}`,
    );
  }
}

export function assertNoLegacyConversationFields(parsed: Record<string, unknown>): void {
  if ('messages' in parsed) {
    throw new ChatSessionSchemaError('chat schema v2 must not include messages');
  }
  if ('assistantAux' in parsed) {
    throw new ChatSessionSchemaError('chat schema v2 must not include assistantAux');
  }
  if ('desktopMessages' in parsed) {
    throw new ChatSessionSchemaError('chat schema v2 must not include desktopMessages');
  }
}

function hydratePersistedRow(row: PersistedDesktopTimelineRowSnapshot): DesktopTimelineRowSnapshot {
  const tool = row.tool ? cloneTool(row.tool) : undefined;
  const aux = row.aux ? cloneAux(row.aux) : undefined;
  return {
    rowId: row.rowId,
    messageId: row.messageId,
    turnId: row.turnId,
    ...(row.segmentId !== undefined ? { segmentId: row.segmentId } : {}),
    kind: row.kind,
    ...(row.section ? { section: row.section } : {}),
    createdOrder: row.createdOrder,
    content: row.content ?? '',
    pending: false,
    ...(row.canContinue ? { canContinue: true } : {}),
    ...(row.localFileAttachments?.length
      ? { localFileAttachments: row.localFileAttachments.map((attachment) => ({ ...attachment })) }
      : {}),
    ...(tool ? { tool } : {}),
    ...(aux ? { aux } : {}),
  };
}

function cloneTool(tool: ToolBlockSnapshot): ToolBlockSnapshot {
  const normalized = normalizeToolBlockSnapshot(tool) ?? tool;
  return {
    ...normalized,
    detailLines: [...normalized.detailLines],
    ...(normalized.imagePaths ? { imagePaths: [...normalized.imagePaths] } : {}),
    ...(normalized.videoPaths ? { videoPaths: [...normalized.videoPaths] } : {}),
  };
}

export function hydrateTimelineSnapshotFromPersistence(
  snapshot: PersistedDesktopTimelineTurnSnapshot[],
): DesktopTimelineTurnSnapshot[] {
  return snapshot.map((turn) => ({
    turnId: turn.turnId,
    createdOrder: turn.createdOrder,
    ...(turn.userRow ? { userRow: hydratePersistedRow(turn.userRow) } : {}),
    segments: turn.segments.map((segment) => ({
      segmentId: segment.segmentId,
      turnId: segment.turnId,
      kind: segment.kind,
      status: segment.status,
      createdOrder: segment.createdOrder,
      rows: segment.rows.map(hydratePersistedRow),
    })),
  }));
}

export function timelinePersistedSnapshotToMessages(
  snapshot: PersistedDesktopTimelineTurnSnapshot[],
): ConversationMessageSnapshot[] {
  const runtimeSnapshot = hydrateTimelineSnapshotFromPersistence(snapshot);
  let nextMessageId = 1;
  const timeline = DesktopMessageTimeline.fromSnapshot(runtimeSnapshot, {
    allocateMessageId: () => nextMessageId++,
    reserveMessageId: (messageId) => {
      if (messageId >= nextMessageId) {
        nextMessageId = messageId + 1;
      }
    },
  });
  return timeline.toMessages();
}

export function timelineRuntimeSnapshotToMessages(
  snapshot: DesktopTimelineTurnSnapshot[],
): ConversationMessageSnapshot[] {
  let nextMessageId = 1;
  const timeline = DesktopMessageTimeline.fromSnapshot(snapshot, {
    allocateMessageId: () => nextMessageId++,
    reserveMessageId: (messageId) => {
      if (messageId >= nextMessageId) {
        nextMessageId = messageId + 1;
      }
    },
  });
  return timeline.toMessages();
}
