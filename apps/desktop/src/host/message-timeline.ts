import type {
  ConversationMessageSnapshot,
  MessageAuxSnapshot,
  ToolBlockSnapshot,
} from '../types.js';
import {
  messageOrderDebugLevel,
  normalizeMessageAuxSnapshot,
  normalizeToolBlockSnapshot,
  truncateOneLineForDebug,
} from './message-ordering.js';

export type DesktopTimelineRowKind =
  | 'user'
  | 'assistant-text'
  | 'assistant-thinking'
  | 'assistant-compaction'
  | 'tool'
  | 'standalone-subagent-status';

export type DesktopTimelineSegmentKind = 'initial' | 'continuation' | 'hydrated';
export type DesktopTimelineSegmentStatus = 'streaming' | 'completed' | 'aborted';
export type DesktopTimelineRowSection = 'before-tools' | 'tools' | 'after-tools';

export interface DesktopTimelineRowSnapshot {
  rowId: string;
  messageId: number;
  turnId: number;
  segmentId?: number;
  kind: DesktopTimelineRowKind;
  section?: DesktopTimelineRowSection;
  createdOrder: number;
  content: string;
  pending: boolean;
  canContinue?: boolean;
  tool?: ToolBlockSnapshot;
  aux?: MessageAuxSnapshot;
}

export interface DesktopTimelineSegmentSnapshot {
  segmentId: number;
  turnId: number;
  kind: DesktopTimelineSegmentKind;
  status: DesktopTimelineSegmentStatus;
  createdOrder: number;
  rows: DesktopTimelineRowSnapshot[];
}

export interface DesktopTimelineTurnSnapshot {
  turnId: number;
  createdOrder: number;
  userRow?: DesktopTimelineRowSnapshot;
  segments: DesktopTimelineSegmentSnapshot[];
}

export interface DesktopMessageTimelineOptions {
  allocateMessageId: () => number;
  reserveMessageId?: (messageId: number) => void;
}

interface DesktopTimelineRow extends DesktopTimelineRowSnapshot {}

interface DesktopTimelineSegment {
  segmentId: number;
  turnId: number;
  kind: DesktopTimelineSegmentKind;
  status: DesktopTimelineSegmentStatus;
  createdOrder: number;
  rows: DesktopTimelineRow[];
  activeAssistantTextRowId?: string;
}

interface DesktopTimelineTurn {
  turnId: number;
  createdOrder: number;
  userRow?: DesktopTimelineRow;
  segments: DesktopTimelineSegment[];
}

const ROW_SECTION_ORDER: Record<DesktopTimelineRowSection, number> = {
  'before-tools': 0,
  tools: 1,
  'after-tools': 2,
};

const ROW_KIND_ORDER: Record<DesktopTimelineRowKind, number> = {
  user: 0,
  'assistant-thinking': 1,
  'assistant-compaction': 2,
  'standalone-subagent-status': 3,
  'assistant-text': 4,
  tool: 5,
};

export class DesktopMessageTimeline {
  private turns: DesktopTimelineTurn[] = [];
  private nextTurnId = 1;
  private nextSegmentId = 1;
  private nextRowId = 1;
  private nextCreatedOrder = 1;
  private activeTurnId: number | undefined;
  private activeSegmentId: number | undefined;
  private lastSegmentRowsLogSignature: string | undefined;
  private pendingSegmentRowsLogMsByKey = new Map<string, number>();

  constructor(private readonly options: DesktopMessageTimelineOptions) {}

  static fromMessages(
    messages: ConversationMessageSnapshot[],
    options: DesktopMessageTimelineOptions,
  ): DesktopMessageTimeline {
    const timeline = new DesktopMessageTimeline(options);
    for (const message of messages) {
      timeline.hydrateMessage(message);
    }
    timeline.finalizeHydratedSegments();
    return timeline;
  }

  static fromSnapshot(
    snapshot: DesktopTimelineTurnSnapshot[],
    options: DesktopMessageTimelineOptions,
  ): DesktopMessageTimeline {
    const timeline = new DesktopMessageTimeline(options);
    timeline.hydrateSnapshot(snapshot);
    return timeline;
  }

  snapshot(): DesktopTimelineTurnSnapshot[] {
    return this.turns.map((turn) => ({
      turnId: turn.turnId,
      createdOrder: turn.createdOrder,
      ...(turn.userRow ? { userRow: cloneRow(turn.userRow) } : {}),
      segments: this.orderedSegments(turn).map((segment) => ({
        segmentId: segment.segmentId,
        turnId: segment.turnId,
        kind: segment.kind,
        status: segment.status,
        createdOrder: segment.createdOrder,
        rows: this.orderedSegmentRows(segment).map(cloneRow),
      })),
    }));
  }

  toMessages(): ConversationMessageSnapshot[] {
    const messages: ConversationMessageSnapshot[] = [];
    for (const turn of this.orderedTurns()) {
      if (turn.userRow) {
        messages.push(rowToMessage(turn.userRow));
      }
      for (const segment of this.orderedSegments(turn)) {
        for (const row of this.orderedSegmentRows(segment)) {
          messages.push(rowToMessage(row));
        }
      }
    }
    return messages;
  }

  beginUserTurn(content: string, input: { messageId?: number; pending?: boolean } = {}): ConversationMessageSnapshot {
    this.clearContinuationMarkers();
    const turn: DesktopTimelineTurn = {
      turnId: this.nextTurnId++,
      createdOrder: this.nextCreatedOrder++,
      segments: [],
    };
    const row = this.createRow({
      messageId: input.messageId,
      turnId: turn.turnId,
      kind: 'user',
      content,
      pending: input.pending ?? false,
    });
    turn.userRow = row;
    this.turns.push(turn);
    this.activeTurnId = turn.turnId;
    this.activeSegmentId = undefined;
    return rowToMessage(row);
  }

  beginAssistantSegment(kind: DesktopTimelineSegmentKind = 'initial'): ConversationMessageSnapshot {
    const turn = this.ensureActiveTurn();
    const segment = this.createSegment(turn, kind);
    const row = this.createAssistantTextRow(segment, 'before-tools', true);
    segment.activeAssistantTextRowId = row.rowId;
    this.activeSegmentId = segment.segmentId;
    return rowToMessage(row);
  }

  appendAssistantTextChunk(chunk: string): ConversationMessageSnapshot {
    const row = this.ensureActiveAssistantTextRow('text');
    row.content += chunk;
    row.pending = true;
    return rowToMessage(row);
  }

  replaceAssistantText(text: string): ConversationMessageSnapshot {
    const row = this.ensureActiveAssistantTextRow('text');
    row.content = text;
    row.pending = true;
    return rowToMessage(row);
  }

  updatePendingAssistantAux(kind: 'thinking' | 'compressing', text: string): ConversationMessageSnapshot {
    const segment = this.ensureActiveSegment();
    const row = this.ensureActiveAssistantTextRow('aux');
    const normalized = text.trim();
    const aux = {
      ...(row.aux?.thinking ? { thinking: row.aux.thinking } : {}),
      ...(row.aux?.compaction ? { compaction: row.aux.compaction } : {}),
      ...(kind === 'thinking' && normalized ? { thinking: text } : {}),
      ...(kind === 'compressing' && normalized ? { compaction: text } : {}),
    } satisfies MessageAuxSnapshot;
    if (!normalized) {
      if (kind === 'thinking') {
        delete aux.thinking;
      } else {
        delete aux.compaction;
      }
    }
    const nextAux = normalizeMessageAuxSnapshot(aux);
    if (nextAux) {
      row.aux = nextAux;
    } else {
      delete row.aux;
    }
    this.logSegmentRows(`update-pending-${kind}`, segment);
    return rowToMessage(row);
  }

  hasFinalizedAuxInActiveSegment(kind: 'thinking' | 'compressing', text: string): boolean {
    const segment = this.activeSegment();
    const normalized = text.trim();
    if (!segment || !normalized) {
      return false;
    }
    return segment.rows.some((row) => {
      if (kind === 'thinking') {
        return row.kind === 'assistant-thinking' && row.content.trim() === normalized;
      }
      return row.kind === 'assistant-compaction' && row.content.trim() === normalized;
    });
  }

  finalizeThinkingSegment(text: string): ConversationMessageSnapshot | undefined {
    if (!text.trim()) {
      return undefined;
    }
    const segment = this.ensureActiveSegment();
    this.stripSegmentAuxKind(segment, 'thinking', text);
    const row = this.createRow({
      turnId: segment.turnId,
      segmentId: segment.segmentId,
      kind: 'assistant-thinking',
      section: 'before-tools',
      content: text,
      pending: false,
      aux: { thinking: text },
    });
    segment.rows.push(row);
    this.logSegmentRows('finalize-thinking', segment);
    return rowToMessage(row);
  }

  finalizeCompactionSegment(text: string): ConversationMessageSnapshot | undefined {
    if (!text.trim()) {
      return undefined;
    }
    const segment = this.ensureActiveSegment();
    this.stripSegmentAuxKind(segment, 'compaction', text);
    const row = this.createRow({
      turnId: segment.turnId,
      segmentId: segment.segmentId,
      kind: 'assistant-compaction',
      section: 'before-tools',
      content: text,
      pending: false,
      aux: { compaction: text },
    });
    segment.rows.push(row);
    return rowToMessage(row);
  }

  upsertToolMessage(toolCallId: string, tool: ToolBlockSnapshot): ConversationMessageSnapshot {
    const normalizedTool = cloneTool(tool);
    const existing = this.findToolRow(toolCallId);
    if (existing) {
      existing.tool = normalizedTool;
      existing.content = '';
      existing.pending = false;
      const segment = existing.segmentId !== undefined
        ? this.activeTurn()?.segments.find((candidate) => candidate.segmentId === existing.segmentId)
        : undefined;
      if (segment) {
        this.logSegmentRows(`upsert-tool-${normalizedTool.phase}`, segment);
      }
      return rowToMessage(existing);
    }

    const segment = this.ensureActiveSegment();
    const activeText = this.activeAssistantTextRow(segment);
    if (activeText?.content.trim()) {
      activeText.pending = false;
      segment.activeAssistantTextRowId = undefined;
    }
    const row = this.createRow({
      turnId: segment.turnId,
      segmentId: segment.segmentId,
      kind: 'tool',
      section: 'tools',
      content: '',
      pending: false,
      tool: normalizedTool,
    });
    segment.rows.push(row);
    this.logSegmentRows(`upsert-tool-${normalizedTool.phase}`, segment);
    return rowToMessage(row);
  }

  removeToolMessage(toolCallId: string): boolean {
    for (const segment of this.orderedTurns().flatMap((turn) => this.orderedSegments(turn))) {
      const index = segment.rows.findIndex(
        (row) => row.kind === 'tool' && row.tool?.toolCallId === toolCallId,
      );
      if (index >= 0) {
        segment.rows.splice(index, 1);
        return true;
      }
    }
    return false;
  }

  insertAssistantPrefix(content: string): ConversationMessageSnapshot | undefined {
    if (!content.trim()) {
      return undefined;
    }
    const segment = this.ensureActiveSegment();
    const existing = segment.rows.find(
      (row) =>
        row.kind === 'assistant-text' &&
        row.section === 'before-tools' &&
        row.content.trim() === content.trim(),
    );
    if (existing) {
      existing.pending = false;
      return rowToMessage(existing);
    }

    const activeText = this.activeAssistantTextRow(segment);
    if (
      activeText &&
      activeText.section === 'before-tools' &&
      !activeText.content.trim() &&
      !normalizeMessageAuxSnapshot(activeText.aux)
    ) {
      activeText.content = content;
      activeText.pending = false;
      segment.activeAssistantTextRowId = undefined;
      return rowToMessage(activeText);
    }

    const row = this.createAssistantTextRow(segment, 'before-tools', false);
    row.content = content;
    return rowToMessage(row);
  }

  materializeCompletedAssistantText(
    content: string,
    aux?: MessageAuxSnapshot,
  ): ConversationMessageSnapshot | undefined {
    if (!content.trim() && !normalizeMessageAuxSnapshot(aux)) {
      return undefined;
    }
    const segment = this.ensureActiveSegment();
    let row = this.activeAssistantTextRow(segment);
    const normalizedContent = content.trim();
    if (!row) {
      row = this.findReusableCompletedAssistantTextRow(segment, normalizedContent);
    }
    if (
      row &&
      row.content.trim() &&
      row.content.trim() !== normalizedContent &&
      row.section === 'before-tools' &&
      segmentHasToolRows(segment)
    ) {
      row.pending = false;
      row = undefined;
    }
    const reused = row !== undefined;
    if (!row) {
      row = this.createAssistantTextRow(
        segment,
        segmentHasToolRows(segment) ? 'after-tools' : 'before-tools',
        false,
      );
    }

    row.content = content;
    row.pending = false;
    const nextAux = normalizeMessageAuxSnapshot(aux);
    if (nextAux) {
      row.aux = nextAux;
    } else {
      delete row.aux;
    }
    segment.status = 'completed';
    segment.activeAssistantTextRowId = undefined;
    this.logCompletedAssistantMaterialization(segment, row, reused, content);
    this.logSegmentRows('complete-text', segment);
    return rowToMessage(row);
  }

  completeActiveAssistantSegment(): void {
    const segment = this.activeSegment();
    if (!segment) {
      return;
    }
    const row = this.activeAssistantTextRow(segment);
    if (row) {
      row.pending = false;
    }
    segment.status = 'completed';
    segment.activeAssistantTextRowId = undefined;
  }

  abortActiveAssistantSegment(): void {
    const segment = this.activeSegment();
    if (!segment) {
      return;
    }
    const row = this.activeAssistantTextRow(segment);
    if (row) {
      row.pending = false;
    }
    segment.status = 'aborted';
    segment.activeAssistantTextRowId = undefined;
  }

  removePendingAssistantText(): void {
    const segment = this.activeSegment();
    if (!segment) {
      return;
    }
    const row = this.activeAssistantTextRow(segment);
    if (!row) {
      return;
    }
    if (!row.content.trim() && !normalizeMessageAuxSnapshot(row.aux)) {
      segment.rows = segment.rows.filter((candidate) => candidate.rowId !== row.rowId);
    } else {
      row.pending = false;
    }
    segment.activeAssistantTextRowId = undefined;
  }

  clearContinuationMarkers(): void {
    for (const row of this.allRows()) {
      delete row.canContinue;
    }
  }

  markRowContinuable(messageId: number): boolean {
    this.clearContinuationMarkers();
    const row = this.allRows().find((candidate) => candidate.messageId === messageId);
    if (!row || !isRenderableAssistantRow(row)) {
      return false;
    }
    row.canContinue = true;
    return true;
  }

  markLatestRenderableAssistantRowContinuableInActiveTurn(): ConversationMessageSnapshot | undefined {
    const turn = this.activeTurn();
    if (!turn) {
      return undefined;
    }
    return this.markLatestRenderableAssistantRowContinuableFromRows(this.rowsForTurn(turn));
  }

  markLatestRenderableAssistantRowContinuable(input: { content?: string } = {}): ConversationMessageSnapshot | undefined {
    return this.markLatestRenderableAssistantRowContinuableFromRows(this.allRows(), input);
  }

  private markLatestRenderableAssistantRowContinuableFromRows(
    rows: DesktopTimelineRow[],
    input: { content?: string } = {},
  ): ConversationMessageSnapshot | undefined {
    this.clearContinuationMarkers();
    const normalized = input.content?.trim() ?? '';
    const candidates = rows.filter((row) => {
      if (!isRenderableAssistantRow(row)) {
        return false;
      }
      if (!normalized) {
        return true;
      }
      return row.kind === 'assistant-text' && row.content.trim() === normalized;
    });
    const row = candidates[candidates.length - 1];
    if (!row) {
      return undefined;
    }
    row.canContinue = true;
    return rowToMessage(row);
  }

  latestContinuableAssistantMessage(): ConversationMessageSnapshot | undefined {
    const rows = this.allRows().filter((row) => row.canContinue && isRenderableAssistantRow(row));
    const row = rows[rows.length - 1];
    return row ? rowToMessage(row) : undefined;
  }

  private hydrateMessage(message: ConversationMessageSnapshot): void {
    if (message.role === 'user') {
      this.beginUserTurn(message.content, {
        messageId: message.id,
        pending: message.pending,
      });
      return;
    }

    const aux = normalizeMessageAuxSnapshot(message.aux);
    let segment = this.activeSegment() ?? this.createSegment(this.ensureActiveTurn(), 'hydrated');
    let target = this.resolveHydratedMessageTarget(message, aux, segment);
    if (this.shouldStartNewHydratedSegment(segment, target.section, target.kind)) {
      segment = this.createSegment(this.ensureActiveTurn(), 'hydrated');
      target = this.resolveHydratedMessageTarget(message, aux, segment);
    }

    if (target.kind === 'tool' && target.tool) {
      segment.rows.push(this.createRow({
        messageId: message.id,
        turnId: segment.turnId,
        segmentId: segment.segmentId,
        kind: target.kind,
        section: target.section,
        content: '',
        pending: message.pending,
        canContinue: message.canContinue,
        tool: target.tool,
      }));
      return;
    }

    if (target.kind === 'assistant-thinking' && aux?.thinking) {
      segment.rows.push(this.createRow({
        messageId: message.id,
        turnId: segment.turnId,
        segmentId: segment.segmentId,
        kind: target.kind,
        section: target.section,
        content: aux.thinking,
        pending: false,
        canContinue: message.canContinue,
        aux: { thinking: aux.thinking },
      }));
      return;
    }

    if (target.kind === 'assistant-compaction' && aux?.compaction) {
      segment.rows.push(this.createRow({
        messageId: message.id,
        turnId: segment.turnId,
        segmentId: segment.segmentId,
        kind: target.kind,
        section: target.section,
        content: aux.compaction,
        pending: false,
        canContinue: message.canContinue,
        aux: { compaction: aux.compaction },
      }));
      return;
    }

    const row = this.createRow({
      messageId: message.id,
      turnId: segment.turnId,
      segmentId: segment.segmentId,
      kind: target.kind,
      section: target.section,
      content: message.content,
      pending: message.pending,
      canContinue: message.canContinue,
      aux,
    });
    segment.rows.push(row);
    if (message.pending) {
      segment.activeAssistantTextRowId = row.rowId;
    }
  }

  private hydrateSnapshot(snapshot: DesktopTimelineTurnSnapshot[]): void {
    let maxTurnId = 0;
    let maxSegmentId = 0;
    let maxCreatedOrder = 0;
    let maxRowCounter = 0;

    for (const turnSnapshot of snapshot) {
      const turn: DesktopTimelineTurn = {
        turnId: turnSnapshot.turnId,
        createdOrder: turnSnapshot.createdOrder,
        segments: [],
      };
      maxTurnId = Math.max(maxTurnId, turn.turnId);
      maxCreatedOrder = Math.max(maxCreatedOrder, turn.createdOrder);

      if (turnSnapshot.userRow) {
        const userRow = this.restoreRowSnapshot(turnSnapshot.userRow);
        turn.userRow = userRow;
        maxCreatedOrder = Math.max(maxCreatedOrder, userRow.createdOrder);
        maxRowCounter = Math.max(maxRowCounter, rowCounterFromRowId(userRow.rowId));
      }

      for (const segmentSnapshot of turnSnapshot.segments) {
        const segment: DesktopTimelineSegment = {
          segmentId: segmentSnapshot.segmentId,
          turnId: turn.turnId,
          kind: segmentSnapshot.kind,
          status: segmentSnapshot.status,
          createdOrder: segmentSnapshot.createdOrder,
          rows: [],
        };
        maxSegmentId = Math.max(maxSegmentId, segment.segmentId);
        maxCreatedOrder = Math.max(maxCreatedOrder, segment.createdOrder);

        for (const rowSnapshot of segmentSnapshot.rows) {
          const row = this.restoreRowSnapshot(rowSnapshot);
          segment.rows.push(row);
          if (row.kind === 'assistant-text' && row.pending) {
            segment.activeAssistantTextRowId = row.rowId;
          }
          maxCreatedOrder = Math.max(maxCreatedOrder, row.createdOrder);
          maxRowCounter = Math.max(maxRowCounter, rowCounterFromRowId(row.rowId));
        }

        turn.segments.push(segment);
      }

      this.turns.push(turn);
    }

    this.nextTurnId = maxTurnId + 1;
    this.nextSegmentId = maxSegmentId + 1;
    this.nextCreatedOrder = maxCreatedOrder + 1;
    this.nextRowId = maxRowCounter + 1;

    const lastTurn = this.turns[this.turns.length - 1];
    this.activeTurnId = lastTurn?.turnId;
    this.activeSegmentId = this.lastRestorableActiveSegmentId(lastTurn);
  }

  private restoreRowSnapshot(snapshot: DesktopTimelineRowSnapshot): DesktopTimelineRow {
    this.options.reserveMessageId?.(snapshot.messageId);
    return {
      rowId: snapshot.rowId,
      messageId: snapshot.messageId,
      turnId: snapshot.turnId,
      ...(snapshot.segmentId !== undefined ? { segmentId: snapshot.segmentId } : {}),
      kind: snapshot.kind,
      ...(snapshot.section ? { section: snapshot.section } : {}),
      createdOrder: snapshot.createdOrder,
      content: snapshot.content,
      pending: snapshot.pending,
      ...(snapshot.canContinue ? { canContinue: true } : {}),
      ...(snapshot.tool ? { tool: cloneTool(snapshot.tool) } : {}),
      ...(snapshot.aux ? { aux: cloneAux(snapshot.aux) } : {}),
    };
  }

  private lastRestorableActiveSegmentId(turn: DesktopTimelineTurn | undefined): number | undefined {
    if (!turn) {
      return undefined;
    }
    for (let index = turn.segments.length - 1; index >= 0; index -= 1) {
      const segment = turn.segments[index];
      if (segment.activeAssistantTextRowId || segment.status === 'streaming') {
        return segment.segmentId;
      }
    }
    return turn.segments[turn.segments.length - 1]?.segmentId;
  }

  private resolveHydratedMessageTarget(
    message: ConversationMessageSnapshot,
    aux: MessageAuxSnapshot | undefined,
    segment: DesktopTimelineSegment,
  ): {
    kind: DesktopTimelineRowKind;
    section: DesktopTimelineRowSection;
    tool?: ToolBlockSnapshot;
  } {
    if (message.tool) {
      return {
        kind: 'tool',
        section: 'tools',
        tool: cloneTool(message.tool),
      };
    }
    if (!message.content.trim() && aux?.thinking) {
      return {
        kind: 'assistant-thinking',
        section: 'before-tools',
      };
    }
    if (!message.content.trim() && aux?.compaction) {
      return {
        kind: 'assistant-compaction',
        section: 'before-tools',
      };
    }
    return {
      kind: 'assistant-text',
      section: segmentHasToolRows(segment) ? 'after-tools' : 'before-tools',
    };
  }

  private shouldStartNewHydratedSegment(
    segment: DesktopTimelineSegment,
    section: DesktopTimelineRowSection,
    kind: DesktopTimelineRowKind,
  ): boolean {
    const lastRow = segment.rows[segment.rows.length - 1];
    if (!lastRow) {
      return false;
    }
    const lastSectionOrder = lastRow.section ? ROW_SECTION_ORDER[lastRow.section] : 0;
    const nextSectionOrder = ROW_SECTION_ORDER[section];
    if (nextSectionOrder < lastSectionOrder) {
      return true;
    }
    if (nextSectionOrder > lastSectionOrder) {
      return false;
    }
    const lastKindOrder = ROW_KIND_ORDER[lastRow.kind] ?? 99;
    const nextKindOrder = ROW_KIND_ORDER[kind] ?? 99;
    return nextKindOrder < lastKindOrder;
  }

  private finalizeHydratedSegments(): void {
    for (const turn of this.turns) {
      for (const segment of turn.segments) {
        if (segment.kind !== 'hydrated') {
          continue;
        }
        const hasPendingRow = segment.rows.some((row) => row.pending);
        segment.status = hasPendingRow ? 'streaming' : 'completed';
        if (!hasPendingRow) {
          segment.activeAssistantTextRowId = undefined;
        }
      }
    }
  }

  private ensureActiveTurn(): DesktopTimelineTurn {
    const existing = this.activeTurn();
    if (existing) {
      return existing;
    }
    const turn: DesktopTimelineTurn = {
      turnId: this.nextTurnId++,
      createdOrder: this.nextCreatedOrder++,
      segments: [],
    };
    this.turns.push(turn);
    this.activeTurnId = turn.turnId;
    return turn;
  }

  private activeTurn(): DesktopTimelineTurn | undefined {
    return this.turns.find((turn) => turn.turnId === this.activeTurnId);
  }

  private ensureActiveSegment(): DesktopTimelineSegment {
    const existing = this.activeSegment();
    if (existing) {
      return existing;
    }
    return this.createSegment(this.ensureActiveTurn(), 'initial');
  }

  private activeSegment(): DesktopTimelineSegment | undefined {
    const turn = this.activeTurn();
    return turn?.segments.find((segment) => segment.segmentId === this.activeSegmentId);
  }

  private createSegment(
    turn: DesktopTimelineTurn,
    kind: DesktopTimelineSegmentKind,
  ): DesktopTimelineSegment {
    const segment: DesktopTimelineSegment = {
      segmentId: this.nextSegmentId++,
      turnId: turn.turnId,
      kind,
      status: 'streaming',
      createdOrder: this.nextCreatedOrder++,
      rows: [],
    };
    turn.segments.push(segment);
    this.activeTurnId = turn.turnId;
    this.activeSegmentId = segment.segmentId;
    return segment;
  }

  private ensureActiveAssistantTextRow(mode: 'text' | 'aux'): DesktopTimelineRow {
    const segment = this.ensureActiveSegment();
    const existing = this.activeAssistantTextRow(segment);
    if (existing) {
      if (segmentHasToolRows(segment) && existing.section === 'before-tools') {
        if (mode === 'text') {
          if (existing.content.trim() || hasRowAux(existing)) {
            const row = this.createAssistantTextRow(segment, 'after-tools', true);
            segment.activeAssistantTextRowId = row.rowId;
            return row;
          }
          existing.section = 'after-tools';
        }
        return existing;
      }
      return existing;
    }
    const row = this.createAssistantTextRow(
      segment,
      mode === 'aux'
        ? 'before-tools'
        : segmentHasToolRows(segment)
          ? 'after-tools'
          : 'before-tools',
      true,
    );
    segment.activeAssistantTextRowId = row.rowId;
    return row;
  }

  private activeAssistantTextRow(segment: DesktopTimelineSegment): DesktopTimelineRow | undefined {
    if (!segment.activeAssistantTextRowId) {
      return undefined;
    }
    return segment.rows.find(
      (row) => row.rowId === segment.activeAssistantTextRowId && row.kind === 'assistant-text',
    );
  }

  private findReusableCompletedAssistantTextRow(
    segment: DesktopTimelineSegment,
    normalizedContent: string,
  ): DesktopTimelineRow | undefined {
    let emptyRow: DesktopTimelineRow | undefined;
    for (let index = segment.rows.length - 1; index >= 0; index -= 1) {
      const row = segment.rows[index];
      if (row?.kind !== 'assistant-text') {
        continue;
      }
      if (normalizedContent && row.content.trim() === normalizedContent) {
        return row;
      }
      if (!row.content.trim() && !emptyRow) {
        emptyRow = row;
      }
    }
    return emptyRow;
  }

  private createAssistantTextRow(
    segment: DesktopTimelineSegment,
    section: DesktopTimelineRowSection,
    pending: boolean,
  ): DesktopTimelineRow {
    const row = this.createRow({
      turnId: segment.turnId,
      segmentId: segment.segmentId,
      kind: 'assistant-text',
      section,
      content: '',
      pending,
    });
    segment.rows.push(row);
    return row;
  }

  private createRow(input: {
    messageId?: number;
    turnId: number;
    segmentId?: number;
    kind: DesktopTimelineRowKind;
    section?: DesktopTimelineRowSection;
    content: string;
    pending: boolean;
    canContinue?: boolean;
    tool?: ToolBlockSnapshot;
    aux?: MessageAuxSnapshot;
  }): DesktopTimelineRow {
    const messageId = input.messageId ?? this.options.allocateMessageId();
    if (input.messageId !== undefined) {
      this.options.reserveMessageId?.(input.messageId);
    }
    return {
      rowId: `row-${this.nextRowId++}`,
      messageId,
      turnId: input.turnId,
      ...(input.segmentId !== undefined ? { segmentId: input.segmentId } : {}),
      kind: input.kind,
      ...(input.section ? { section: input.section } : {}),
      createdOrder: this.nextCreatedOrder++,
      content: input.content,
      pending: input.pending,
      ...(input.canContinue ? { canContinue: true } : {}),
      ...(input.tool ? { tool: cloneTool(input.tool) } : {}),
      ...(input.aux ? { aux: cloneAux(input.aux) } : {}),
    };
  }

  private findToolRow(toolCallId: string): DesktopTimelineRow | undefined {
    const stable = isStableTimelineToolCallId(toolCallId);
    const candidates = stable
      ? this.allRows()
      : this.activeSegment()?.rows ?? [];
    for (let index = candidates.length - 1; index >= 0; index -= 1) {
      const row = candidates[index];
      if (row?.kind === 'tool' && row.tool?.toolCallId === toolCallId) {
        return row;
      }
    }
    return undefined;
  }

  private stripSegmentAuxKind(
    segment: DesktopTimelineSegment,
    kind: 'thinking' | 'compaction',
    text: string,
  ): void {
    const cleared: number[] = [];
    for (const row of segment.rows) {
      if (row.kind !== 'assistant-text' || !row.aux) {
        continue;
      }
      const current = kind === 'thinking' ? row.aux.thinking : row.aux.compaction;
      if (!current?.trim()) {
        continue;
      }
      if (kind === 'thinking') {
        delete row.aux.thinking;
      } else {
        delete row.aux.compaction;
      }
      const normalized = normalizeMessageAuxSnapshot(row.aux);
      if (normalized) {
        row.aux = normalized;
      } else {
        delete row.aux;
      }
      cleared.push(row.messageId);
    }
    this.logStripSegmentAux(kind, segment, text, cleared);
  }

  private orderedTurns(): DesktopTimelineTurn[] {
    return [...this.turns].sort((left, right) => left.createdOrder - right.createdOrder);
  }

  private orderedSegments(turn: DesktopTimelineTurn): DesktopTimelineSegment[] {
    return [...turn.segments].sort((left, right) => left.createdOrder - right.createdOrder);
  }

  private orderedSegmentRows(segment: DesktopTimelineSegment): DesktopTimelineRow[] {
    return [...segment.rows].sort((left, right) => {
      const leftSection = left.section ? ROW_SECTION_ORDER[left.section] : 0;
      const rightSection = right.section ? ROW_SECTION_ORDER[right.section] : 0;
      const leftKind = ROW_KIND_ORDER[left.kind] ?? 99;
      const rightKind = ROW_KIND_ORDER[right.kind] ?? 99;
      return (
        leftSection - rightSection ||
        leftKind - rightKind ||
        left.createdOrder - right.createdOrder
      );
    });
  }

  private rowsForTurn(turn: DesktopTimelineTurn): DesktopTimelineRow[] {
    const rows: DesktopTimelineRow[] = [];
    if (turn.userRow) {
      rows.push(turn.userRow);
    }
    for (const segment of this.orderedSegments(turn)) {
      rows.push(...this.orderedSegmentRows(segment));
    }
    return rows;
  }

  private allRows(): DesktopTimelineRow[] {
    return this.orderedTurns().flatMap((turn) => this.rowsForTurn(turn));
  }

  private logCompletedAssistantMaterialization(
    segment: DesktopTimelineSegment,
    row: DesktopTimelineRow,
    reused: boolean,
    content: string,
  ): void {
    if (messageOrderDebugLevel() === 'off') {
      return;
    }
    console.log(
      `[desktop-host][timeline] complete-text ${reused ? 'reuse' : 'create'} turn=${segment.turnId} segment=${segment.segmentId} msg=${row.messageId} text≈${truncateOneLineForDebug(content, 48)}`,
    );
  }

  private logStripSegmentAux(
    kind: 'thinking' | 'compaction',
    segment: DesktopTimelineSegment,
    text: string,
    cleared: number[],
  ): void {
    if (messageOrderDebugLevel() === 'off') {
      return;
    }
    console.log(
      `[desktop-host][timeline] strip-segment-aux kind=${kind} turn=${segment.turnId} segment=${segment.segmentId} cleared=${cleared.join(',') || '∅'} final≈${truncateOneLineForDebug(text, 48)}`,
    );
  }

  private logSegmentRows(stage: string, segment: DesktopTimelineSegment): void {
    if (messageOrderDebugLevel() !== 'verbose') {
      return;
    }
    const rows = this.orderedSegmentRows(segment)
      .map((row) => {
        const section = row.section ?? 'none';
        const text = row.tool
          ? row.tool.headline
          : row.aux?.thinking ?? row.aux?.compaction ?? row.content;
        const clipped = text.trim() ? truncateOneLineForDebug(text, 42) : '∅';
        return `${section}:${row.kind}#${row.messageId}≈${clipped}`;
      })
      .join('«');
    const signature = `${stage}|${segment.turnId}|${segment.segmentId}|${rows || '∅'}`;
    if (signature === this.lastSegmentRowsLogSignature) {
      return;
    }

    const pendingStageKey = isPendingSegmentRowsLogStage(stage)
      ? `${stage}:${segment.turnId}:${segment.segmentId}`
      : undefined;
    const now = Date.now();
    if (pendingStageKey) {
      const lastLoggedAt = this.pendingSegmentRowsLogMsByKey.get(pendingStageKey) ?? 0;
      if (now - lastLoggedAt < 1200) {
        return;
      }
    }

    console.log(
      `[desktop-host][timeline] segment-rows stage=${stage} turn=${segment.turnId} segment=${segment.segmentId} rows=${rows || '∅'}`,
    );
    this.lastSegmentRowsLogSignature = signature;
    if (pendingStageKey) {
      this.pendingSegmentRowsLogMsByKey.set(pendingStageKey, now);
      trimPendingSegmentRowsLogMsByKey(this.pendingSegmentRowsLogMsByKey, 32);
    }
  }
}

export function isStableTimelineToolCallId(toolCallId: string): boolean {
  return !toolCallId.startsWith('pending:') && !toolCallId.startsWith('tool:');
}

function segmentHasToolRows(segment: DesktopTimelineSegment): boolean {
  return segment.rows.some((row) => row.kind === 'tool');
}

function hasRowAux(row: DesktopTimelineRow): boolean {
  return Boolean(normalizeMessageAuxSnapshot(row.aux));
}

function isPendingSegmentRowsLogStage(stage: string): boolean {
  return stage === 'update-pending-thinking' || stage === 'update-pending-compressing';
}

function trimPendingSegmentRowsLogMsByKey(map: Map<string, number>, maxEntries: number): void {
  while (map.size > maxEntries) {
    const oldestKey = map.keys().next().value;
    if (oldestKey === undefined) {
      return;
    }
    map.delete(oldestKey);
  }
}

function isRenderableAssistantRow(row: DesktopTimelineRow): boolean {
  if (row.kind === 'user' || row.pending) {
    return false;
  }
  return Boolean(
    row.kind === 'tool' ||
      row.content.trim() ||
      row.aux?.thinking?.trim() ||
      row.aux?.compaction?.trim(),
  );
}

function rowToMessage(row: DesktopTimelineRow): ConversationMessageSnapshot {
  if (row.kind === 'user') {
    return {
      id: row.messageId,
      role: 'user',
      content: row.content,
      pending: row.pending,
      ...(row.canContinue ? { canContinue: true } : {}),
    };
  }

  const tool = row.tool ? cloneTool(row.tool) : undefined;
  const aux = normalizeMessageAuxSnapshot(row.aux);
  return {
    id: row.messageId,
    role: 'assistant',
    content: row.kind === 'assistant-thinking' || row.kind === 'assistant-compaction' ? '' : row.content,
    ...(tool ? { tool } : {}),
    ...(aux ? { aux } : {}),
    pending: row.pending,
    ...(row.canContinue ? { canContinue: true } : {}),
  };
}

function cloneRow(row: DesktopTimelineRow): DesktopTimelineRowSnapshot {
  return {
    ...row,
    ...(row.tool ? { tool: cloneTool(row.tool) } : {}),
    ...(row.aux ? { aux: cloneAux(row.aux) } : {}),
  };
}

function cloneTool(tool: ToolBlockSnapshot): ToolBlockSnapshot {
  const normalized = normalizeToolBlockSnapshot(tool) ?? tool;
  return {
    ...normalized,
    detailLines: [...normalized.detailLines],
    ...(normalized.imagePaths ? { imagePaths: [...normalized.imagePaths] } : {}),
  };
}

function cloneAux(aux: MessageAuxSnapshot): MessageAuxSnapshot {
  return {
    ...(aux.thinking ? { thinking: aux.thinking } : {}),
    ...(aux.compaction ? { compaction: aux.compaction } : {}),
  };
}

function rowCounterFromRowId(rowId: string): number {
  const match = /^row-(\d+)$/.exec(rowId);
  return match ? Number.parseInt(match[1], 10) : 0;
}