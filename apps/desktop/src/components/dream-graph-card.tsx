import { useEffect, useMemo, useState } from "react";

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
  open?: boolean;
  onOpenChange?: (open: boolean, dreamId?: string) => void;
  interactive?: boolean;
};

type DreamLogoNodeData = {
  iconSrc: string;
};

function deriveWorkspaceLabel(workspaceRoot?: string): string {
  const trimmed = workspaceRoot?.trim();
  if (!trimmed) {
    return "当前工作区";
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
      ? "梦境正在收集中，新的近期动向会很快出现在这里"
      : input.collectorState === "missing-model"
        ? "选择收集者模型后，梦境会开始归纳近期工作动向"
        : input.dreamEnabled
          ? "继续在当前工作区工作后，这里会出现新的梦境摘要"
          : "启用梦境后，这里会开始沉淀当前工作区的近期动向";

  return [
    {
      id: "fallback-primary",
      title: "近期动向",
      summary: primarySummary,
      details: input.collectorState === "running"
        ? "收集者已在后台运行，完成后这里会显示更完整的梦境细节。"
        : "当前还没有可展示的梦境详情，继续工作后会逐步沉淀。",
      tags: input.collectorState === "running" ? ["collecting", "active"] : ["placeholder"],
      workspaceRoot,
      gitBranch,
      updatedAtUnixMs: Date.now(),
    },
    {
      id: "fallback-debug",
      title: "调试模式",
      summary: input.debugMode
        ? "调试模式已开启，后续收集会话会保留为可追踪记录"
        : "调试模式已关闭，当前仅保留梦境摘要本身",
      details: input.debugMode
        ? "梦境调试日志会保留更多可追踪信息，便于检查收集链路。"
        : "未开启调试模式时，这里只显示收集产物本身。",
      tags: input.debugMode ? ["debug", "trace"] : ["summary-only"],
      workspaceRoot,
      gitBranch,
      updatedAtUnixMs: Date.now() - 1,
    },
  ];
}

function DreamInfoNode({ data }: NodeProps<Node<DreamNodeData>>) {
  const dream = data.dream;
  const tags = dream?.tags ?? [];
  const visibleTags = tags.slice(0, 3);
  const overflowTags = tags.slice(3);

  return (
    <Popover
      modal
      open={Boolean(data.interactive && data.open && dream)}
      onOpenChange={(open) => data.onOpenChange?.(open, dream?.id)}
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
                      <p className="mb-2 text-[11px] text-muted-foreground">更多标签</p>
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
                <p className="text-[11px] text-muted-foreground">摘要</p>
                <p className="whitespace-pre-wrap leading-5 text-foreground/90">{dream.summary}</p>
              </section>
              <section className="space-y-1.5">
                <p className="text-[11px] text-muted-foreground">详情</p>
                <p className="whitespace-pre-wrap leading-5 text-foreground/90">
                  {dream.details?.trim() || "暂无更详细的梦境记录。"}
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
  selectedDreamId: string | null,
  onDreamOpenChange: (open: boolean, dreamId?: string) => void,
  workspaceRoot?: string,
  gitBranch?: string,
) {
  const visibleItems = items.slice(0, 3);
  const nodes: Array<Node<DreamNodeData | DreamLogoNodeData>> = [
    {
      id: "context",
      type: "dreamInfo",
      position: { x: 28, y: 130 },
      draggable: true,
      data: {
        label: "当前作用域正在沉淀近期工作动向",
        subtitle: buildDreamSubtitle(workspaceRoot, gitBranch),
      },
    },
    {
      id: "logo",
      type: "dreamLogo",
      position: { x: 300, y: 108 },
      draggable: true,
      selectable: false,
      data: { iconSrc },
    },
  ];

  const slots = [
    { x: 555, y: 18 },
    { x: 555, y: 128 },
    { x: 555, y: 238 },
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
        open: item.id === selectedDreamId,
        onOpenChange: onDreamOpenChange,
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
  const [selectedDreamId, setSelectedDreamId] = useState<string | null>(null);
  const iconSrc = theme === "light" ? "/spirit-agent-icon-light.png" : "/spirit-agent-icon.png";
  const itemIds = useMemo(() => new Set(items.map((item) => item.id)), [items]);

  useEffect(() => {
    if (selectedDreamId && !itemIds.has(selectedDreamId)) {
      setSelectedDreamId(null);
    }
  }, [itemIds, selectedDreamId]);

  const graph = useMemo(
    () =>
      buildGraph(
        items,
        iconSrc,
        selectedDreamId,
        (open, dreamId) => {
          setSelectedDreamId(open ? dreamId ?? null : null);
        },
        workspaceRoot,
        gitBranch,
      ),
    [gitBranch, iconSrc, items, selectedDreamId, workspaceRoot],
  );
  const [nodes, setNodes, onNodesChange] = useNodesState(graph.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(graph.edges);

  useEffect(() => {
    setNodes(graph.nodes);
    setEdges(graph.edges);
  }, [graph, setEdges, setNodes]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
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

  return (
    <div className="overflow-hidden rounded-lg border border-border/40 bg-background/80">
      <div className="relative h-[20rem] w-full">
        {loading ? (
          <div className="absolute right-3 top-3 z-10 flex items-center gap-2 rounded-full border border-border/50 bg-background/75 px-3 py-1 text-xs text-muted-foreground backdrop-blur-sm">
            <LoaderCircle className="size-3.5 animate-spin" aria-hidden />
            加载梦境
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