import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import i18n from "@/lib/i18n";
import { LoaderCircle } from "lucide-react";
import {
  Background,
  type Edge,
  Handle,
  type Node,
  type NodeProps,
  type NodeTypes,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { Badge } from "@/components/ui/badge";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import type { ThemePreference } from "@/lib/theme";
import type { DesktopDreamCollectorState, DesktopDreamOverviewItem } from "@/types";

type DreamGraphCardProps = {
  items: DesktopDreamOverviewItem[];
  workspaceRoot?: string;
  gitBranch?: string;
  theme: ThemePreference;
  collectorState: DesktopDreamCollectorState;
  dreamEnabled: boolean;
  debugMode: boolean;
  loading?: boolean;
};

type DreamNodeData = {
  label: string;
  subtitle: string;
  dream?: DesktopDreamOverviewItem;
  interactive?: boolean;
};

type DreamGraphInteractionValue = {
  selectedDreamId: string | null;
  onDreamOpenChange: (open: boolean, dreamId?: string) => void;
};

const DreamGraphInteractionContext = createContext<DreamGraphInteractionValue | null>(null);

type DreamLogoNodeData = {
  iconSrc: string;
};

type DreamFlowNode = Node<DreamNodeData | DreamLogoNodeData>;

const DREAM_GRAPH_MIN_HEIGHT_PX = 320;
const DREAM_GRAPH_ITEM_X = 555;
const DREAM_GRAPH_ITEM_BASE_Y = 18;
const DREAM_GRAPH_ITEM_VERTICAL_STEP_PX = 110;
const DREAM_GRAPH_ITEM_ESTIMATED_HEIGHT_PX = 72;
const DREAM_GRAPH_CONTEXT_Y = 130;
const DREAM_GRAPH_CONTEXT_ESTIMATED_HEIGHT_PX = 72;
const DREAM_GRAPH_LOGO_Y = 108;
const DREAM_GRAPH_LOGO_SIZE_PX = 112;
const DREAM_GRAPH_DEFAULT_ANCHOR_CENTER_Y = DREAM_GRAPH_LOGO_Y + DREAM_GRAPH_LOGO_SIZE_PX / 2;

function deriveWorkspaceLabel(workspaceRoot?: string): string {
  const trimmed = workspaceRoot?.trim();
  if (!trimmed) {
    return i18n.t('sidebar.currentWorkspace');
  }
  const normalized = trimmed.replace(/\\/g, "/").replace(/\/+$/g, "");
  const lastSlash = normalized.lastIndexOf("/");
  return lastSlash >= 0 ? normalized.slice(lastSlash + 1) || normalized : normalized;
}

function buildDreamSubtitle(workspaceRoot?: string, gitBranch?: string): string {
  const parts = [deriveWorkspaceLabel(workspaceRoot), gitBranch?.trim()].filter(Boolean);
  return parts.join(" · ");
}

function formatDreamTimestamp(updatedAtUnixMs: number): string {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(updatedAtUnixMs);
}

function fallbackDreamSummaries(input: {
  workspaceRoot?: string;
  gitBranch?: string;
  collectorState: DesktopDreamCollectorState;
  dreamEnabled: boolean;
  debugMode: boolean;
}): DesktopDreamOverviewItem[] {
  const workspaceRoot = input.workspaceRoot ?? "";
  const gitBranch = input.gitBranch?.trim() || "current";
  const primarySummary =
    input.collectorState === "running"
      ? i18n.t('dreams.collectorRunning')
      : input.collectorState === "missing-model"
        ? i18n.t('dreams.missingModel')
        : input.dreamEnabled
          ? i18n.t('dreams.continueWorking')
          : i18n.t('dreams.enableDreams');

  return [
    {
      id: "fallback-primary",
      title: i18n.t('dreams.recentTrends'),
      summary: primarySummary,
      details: input.collectorState === "running"
        ? i18n.t('dreams.collectorRunningDetail')
        : i18n.t('dreams.noDreamDetail'),
      tags: input.collectorState === "running" ? ["collecting", "active"] : ["placeholder"],
      workspaceRoot,
      gitBranch,
      updatedAtUnixMs: Date.now(),
    },
    {
      id: "fallback-debug",
      title: i18n.t('dreams.debugMode'),
      summary: input.debugMode
        ? i18n.t('dreams.debugEnabled')
        : i18n.t('dreams.debugDisabled'),
      details: input.debugMode
        ? i18n.t('dreams.debugDetailEnabled')
        : i18n.t('dreams.debugDetailDisabled'),
      tags: input.debugMode ? ["debug", "trace"] : ["summary-only"],
      workspaceRoot,
      gitBranch,
      updatedAtUnixMs: Date.now() - 1,
    },
  ];
}

function DreamInfoNode({ data }: NodeProps<Node<DreamNodeData>>) {
  const { t } = useTranslation();
  const interaction = useContext(DreamGraphInteractionContext);
  const dream = data.dream;
  const dreamId = dream?.id;
  const tags = dream?.tags ?? [];
  const visibleTags = tags.slice(0, 3);
  const overflowTags = tags.slice(3);
  const popoverOpen = Boolean(
    data.interactive
    && dreamId
    && interaction?.selectedDreamId === dreamId,
  );

  return (
    <Popover
      modal
      open={popoverOpen}
      onOpenChange={(open) => {
        if (dreamId && data.interactive) {
          interaction?.onDreamOpenChange(open, dreamId);
        }
      }}
    >
      <PopoverTrigger asChild>
        <div
          className={cn(
            "max-w-[13rem] select-none overflow-hidden rounded-md border border-border/35 bg-background/45 px-3 py-2 text-left backdrop-blur-xl transition-colors dark:border-white/10 dark:bg-background/30 supports-[backdrop-filter]:bg-background/30 dark:supports-[backdrop-filter]:bg-background/20",
            data.interactive
              ? "cursor-pointer hover:bg-background/60 dark:hover:bg-background/40"
              : "cursor-grab hover:bg-background/60 active:cursor-grabbing dark:hover:bg-background/40",
          )}
          onClick={(event) => event.stopPropagation()}
        >
          <Handle
            type="target"
            position={Position.Left}
            className="!h-2 !w-2 !border-0 !bg-transparent !opacity-0"
          />
          <Handle
            type="source"
            position={Position.Right}
            className="!h-2 !w-2 !border-0 !bg-transparent !opacity-0"
          />
          <p className="line-clamp-2 text-[13px] font-medium leading-5 text-foreground/95">{data.label}</p>
          <p className="mt-1 text-[11px] leading-4 text-muted-foreground">{data.subtitle}</p>
        </div>
      </PopoverTrigger>
      {dream ? (
        <PopoverContent
          side="bottom"
          align="start"
          collisionPadding={16}
          className="nodrag nopan flex h-[min(36rem,var(--radix-popover-content-available-height))] w-[22rem] flex-col overflow-hidden p-0"
        >
          <div className="border-b border-border/60 px-4 py-3">
            <p className="line-clamp-2 text-sm font-medium text-foreground">{dream.title}</p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              {formatDreamTimestamp(dream.updatedAtUnixMs)}
            </p>
            {tags.length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {visibleTags.map((tag) => (
                  <Badge
                    key={tag}
                    variant="secondary"
                    className="max-w-[8rem] truncate text-[10px] text-secondary-foreground"
                    title={tag}
                  >
                    {tag}
                  </Badge>
                ))}
                {overflowTags.length > 0 ? (
                  <HoverCard openDelay={150} closeDelay={100}>
                    <HoverCardTrigger asChild>
                      <Badge variant="outline" className="cursor-default text-[10px] text-muted-foreground">
                        ...
                      </Badge>
                    </HoverCardTrigger>
                    <HoverCardContent align="start" className="w-[18rem]">
                      <p className="mb-2 text-[11px] text-muted-foreground">{t('dreams.moreTags')}</p>
                      <div className="flex flex-wrap gap-1.5">
                        {tags.map((tag) => (
                          <Badge
                            key={tag}
                            variant="secondary"
                            className="max-w-[8rem] truncate text-[10px] text-secondary-foreground"
                            title={tag}
                          >
                            {tag}
                          </Badge>
                        ))}
                      </div>
                    </HoverCardContent>
                  </HoverCard>
                ) : null}
              </div>
            ) : null}
          </div>
          <ScrollArea type="always" className="min-h-0 flex-1 [&>[data-radix-scroll-area-viewport]]:h-full">
            <div className="space-y-3 px-4 py-3 text-xs">
              <section className="space-y-1.5">
                <p className="text-[11px] text-muted-foreground">{t('dreams.summary')}</p>
                <p className="whitespace-pre-wrap leading-5 text-foreground/90">{dream.summary}</p>
              </section>
              <section className="space-y-1.5">
                <p className="text-[11px] text-muted-foreground">{t('dreams.details')}</p>
                <p className="whitespace-pre-wrap leading-5 text-foreground/90">
                  {dream.details?.trim() || t('dreams.noDetails')}
                </p>
              </section>
            </div>
          </ScrollArea>
          <div className="border-t border-border/60 bg-muted/30 px-4 py-2.5 text-[11px] text-muted-foreground">
            {buildDreamSubtitle(dream.workspaceRoot, dream.gitBranch)}
          </div>
        </PopoverContent>
      ) : null}
    </Popover>
  );
}

function DreamLogoNode({ data }: NodeProps<Node<DreamLogoNodeData>>) {
  return (
    <div className="pointer-events-none flex h-28 w-28 items-center justify-center rounded-full">
      <Handle
        type="target"
        position={Position.Left}
        className="!h-2 !w-2 !border-0 !bg-transparent !opacity-0"
      />
      <Handle
        type="source"
        position={Position.Right}
        className="!h-2 !w-2 !border-0 !bg-transparent !opacity-0"
      />
      <img
        src={data.iconSrc}
        alt="Spirit Agent"
        className="h-16 w-16 object-contain"
        draggable={false}
      />
    </div>
  );
}

const nodeTypes: NodeTypes = {
  dreamInfo: DreamInfoNode,
  dreamLogo: DreamLogoNode,
};

function buildGraph(
  items: DesktopDreamOverviewItem[],
  iconSrc: string,
  workspaceRoot?: string,
  gitBranch?: string,
) {
  const visibleItems = items;
  const slots = buildDreamItemSlots(visibleItems.length);
  const anchorCenterY = dreamGraphAnchorCenterY(slots);
  const nodes: DreamFlowNode[] = [
    {
      id: "context",
      type: "dreamInfo",
      position: { x: 28, y: anchorCenterY - DREAM_GRAPH_CONTEXT_ESTIMATED_HEIGHT_PX / 2 },
      draggable: true,
      data: {
        label: i18n.t('dreams.scopeCollecting'),
        subtitle: buildDreamSubtitle(workspaceRoot, gitBranch),
      },
    },
    {
      id: "logo",
      type: "dreamLogo",
      position: { x: 300, y: anchorCenterY - DREAM_GRAPH_LOGO_SIZE_PX / 2 },
      draggable: true,
      selectable: false,
      data: { iconSrc },
    },
  ];

  for (const [index, item] of visibleItems.entries()) {
    nodes.push({
      id: item.id,
      type: "dreamInfo",
      position: slots[index] ?? slots[slots.length - 1],
      draggable: true,
      data: {
        label: item.summary,
        subtitle: buildDreamSubtitle(item.workspaceRoot, item.gitBranch),
        dream: item,
        interactive: true,
      },
    });
  }

  const baseEdgeStyle = {
    stroke: "rgba(161, 161, 170, 0.5)",
    strokeDasharray: "4 4",
    strokeWidth: 1.2,
  };
  const edges: Edge[] = [
    {
      id: "edge-context",
      source: "context",
      target: "logo",
      type: "smoothstep",
      style: baseEdgeStyle,
    },
    ...visibleItems.map((item) => ({
      id: `edge-${item.id}`,
      source: "logo",
      target: item.id,
      type: "smoothstep",
      style: baseEdgeStyle,
    })),
  ];

  return { nodes, edges };
}

function mergeGraphNodes(
  currentNodes: DreamFlowNode[],
  nextNodes: DreamFlowNode[],
  pinnedNodeIds: ReadonlySet<string>,
): DreamFlowNode[] {
  const currentById = new Map(currentNodes.map((node) => [node.id, node]));

  return nextNodes.map((nextNode) => {
    const currentNode = currentById.get(nextNode.id);
    if (!currentNode) {
      return nextNode;
    }

    return {
      ...nextNode,
      position: pinnedNodeIds.has(nextNode.id) ? currentNode.position : nextNode.position,
      ...(currentNode.measured !== undefined ? { measured: currentNode.measured } : {}),
      ...(currentNode.width !== undefined ? { width: currentNode.width } : {}),
      ...(currentNode.height !== undefined ? { height: currentNode.height } : {}),
      ...(currentNode.selected !== undefined ? { selected: currentNode.selected } : {}),
      ...(currentNode.dragging !== undefined ? { dragging: currentNode.dragging } : {}),
    };
  });
}

function buildDreamItemSlots(count: number): Array<{ x: number; y: number }> {
  if (count <= 0) {
    return [];
  }

  const centerIndex = (count - 1) / 2;
  const defaultTopY =
    DREAM_GRAPH_DEFAULT_ANCHOR_CENTER_Y
    - DREAM_GRAPH_ITEM_ESTIMATED_HEIGHT_PX / 2
    - centerIndex * DREAM_GRAPH_ITEM_VERTICAL_STEP_PX;
  const offsetY = Math.max(0, DREAM_GRAPH_ITEM_BASE_Y - defaultTopY);

  return Array.from({ length: count }, (_value, index) => ({
    x: DREAM_GRAPH_ITEM_X,
    y:
      DREAM_GRAPH_DEFAULT_ANCHOR_CENTER_Y
      - DREAM_GRAPH_ITEM_ESTIMATED_HEIGHT_PX / 2
      + (index - centerIndex) * DREAM_GRAPH_ITEM_VERTICAL_STEP_PX
      + offsetY,
  }));
}

function dreamGraphAnchorCenterY(slots: Array<{ x: number; y: number }>): number {
  if (slots.length === 0) {
    return DREAM_GRAPH_DEFAULT_ANCHOR_CENTER_Y;
  }

  const firstCenterY = slots[0]!.y + DREAM_GRAPH_ITEM_ESTIMATED_HEIGHT_PX / 2;
  const lastCenterY = slots[slots.length - 1]!.y + DREAM_GRAPH_ITEM_ESTIMATED_HEIGHT_PX / 2;
  return Math.max(DREAM_GRAPH_DEFAULT_ANCHOR_CENTER_Y, (firstCenterY + lastCenterY) / 2);
}

function dreamGraphHeightPx(count: number): number {
  if (count <= 0) {
    return DREAM_GRAPH_MIN_HEIGHT_PX;
  }

  return Math.max(
    DREAM_GRAPH_MIN_HEIGHT_PX,
    DREAM_GRAPH_ITEM_BASE_Y
      + (count - 1) * DREAM_GRAPH_ITEM_VERTICAL_STEP_PX
      + DREAM_GRAPH_ITEM_ESTIMATED_HEIGHT_PX,
  );
}

function DreamGraphCanvas({
  items,
  theme,
  workspaceRoot,
  gitBranch,
}: {
  items: DesktopDreamOverviewItem[];
  theme: ThemePreference;
  workspaceRoot?: string;
  gitBranch?: string;
}) {
  const { i18n } = useTranslation();
  const [selectedDreamId, setSelectedDreamId] = useState<string | null>(null);
  const [pinnedNodeIds, setPinnedNodeIds] = useState<string[]>([]);
  const iconSrc = theme === "light" ? "./spirit-agent-icon-light.png" : "./spirit-agent-icon.png";
  const itemIds = useMemo(() => new Set(items.map((item) => item.id)), [items]);
  const graphNodeIds = useMemo(() => new Set(["context", "logo", ...items.map((item) => item.id)]), [items]);
  const pinnedNodeIdSet = useMemo(() => new Set(pinnedNodeIds), [pinnedNodeIds]);
  const handleDreamOpenChange = useCallback((open: boolean, dreamId?: string) => {
    setSelectedDreamId(open ? dreamId ?? null : null);
  }, []);

  const dreamGraphInteraction = useMemo(
    (): DreamGraphInteractionValue => ({
      selectedDreamId,
      onDreamOpenChange: handleDreamOpenChange,
    }),
    [handleDreamOpenChange, selectedDreamId],
  );

  const handleNodeDragStop = (_event: unknown, node: DreamFlowNode) => {
    setPinnedNodeIds((current) => {
      if (current.includes(node.id)) {
        return current;
      }
      return [...current, node.id];
    });
  };

  useEffect(() => {
    if (selectedDreamId && !itemIds.has(selectedDreamId)) {
      setSelectedDreamId(null);
    }
  }, [itemIds, selectedDreamId]);

  useEffect(() => {
    setPinnedNodeIds((current) => current.filter((id) => graphNodeIds.has(id)));
  }, [graphNodeIds]);

  const graph = useMemo(
    () =>
      buildGraph(
        items,
        iconSrc,
        workspaceRoot,
        gitBranch,
      ),
    [gitBranch, iconSrc, items, workspaceRoot, i18n.language],
  );
  const [nodes, setNodes, onNodesChange] = useNodesState(graph.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(graph.edges);

  useEffect(() => {
    setNodes((currentNodes) => {
      return mergeGraphNodes(
        currentNodes as DreamFlowNode[],
        graph.nodes,
        pinnedNodeIdSet,
      );
    });
    setEdges(graph.edges);
  }, [graph, pinnedNodeIdSet, setEdges, setNodes]);

  return (
    <DreamGraphInteractionContext.Provider value={dreamGraphInteraction}>
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onNodeDragStop={handleNodeDragStop}
      onPaneClick={() => setSelectedDreamId(null)}
      fitView={false}
      defaultViewport={{ x: 0, y: 0, zoom: 1 }}
      minZoom={0.65}
      maxZoom={1.6}
      zoomOnScroll
      zoomActivationKeyCode={null}
      zoomOnPinch={false}
      zoomOnDoubleClick={false}
      panOnDrag
      nodesConnectable={false}
      elementsSelectable
      proOptions={{ hideAttribution: true }}
      className="!bg-transparent"
    >
      <Background gap={24} size={1} color="rgba(255,255,255,0.03)" />
    </ReactFlow>
    </DreamGraphInteractionContext.Provider>
  );
}

export function DreamGraphCard({
  items,
  workspaceRoot,
  gitBranch,
  theme,
  collectorState,
  dreamEnabled,
  debugMode,
  loading,
}: DreamGraphCardProps) {
  const { t } = useTranslation();
  const graphItems =
    items.length > 0
      ? items
      : fallbackDreamSummaries({
          workspaceRoot,
          gitBranch,
          collectorState,
          dreamEnabled,
          debugMode,
        });
  const graphHeight = dreamGraphHeightPx(graphItems.length);

  return (
    <div className="overflow-hidden rounded-lg border border-border/40 bg-background/80">
      <div className="relative w-full" style={{ height: `${String(graphHeight)}px` }}>
        {loading ? (
          <div className="absolute right-3 top-3 z-10 flex items-center gap-2 rounded-full border border-border/50 bg-background/75 px-3 py-1 text-xs text-muted-foreground backdrop-blur-sm">
            <LoaderCircle className="size-3.5 animate-spin" aria-hidden />
            {t('dreams.loading')}
          </div>
        ) : null}
        <ReactFlowProvider>
          <DreamGraphCanvas
            items={graphItems}
            theme={theme}
            workspaceRoot={workspaceRoot}
            gitBranch={gitBranch}
          />
        </ReactFlowProvider>
      </div>
    </div>
  );
}