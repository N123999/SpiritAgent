import { useEffect, useMemo } from "react";

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
  onDreamSelect?: (dreamId: string) => void;
};

type DreamNodeData = {
  label: string;
  subtitle: string;
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
      workspaceRoot,
      gitBranch,
      updatedAtUnixMs: Date.now() - 1,
    },
  ];
}

function DreamInfoNode({ data }: NodeProps<Node<DreamNodeData>>) {
  return (
    <div
      className="max-w-[13rem] cursor-grab select-none overflow-hidden rounded-md border border-border/35 bg-background/45 px-3 py-2 text-left backdrop-blur-xl transition-colors hover:bg-background/60 active:cursor-grabbing dark:border-white/10 dark:bg-background/30 dark:hover:bg-background/40 supports-[backdrop-filter]:bg-background/30 dark:supports-[backdrop-filter]:bg-background/20"
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
  onDreamSelect,
}: {
  items: DesktopDreamOverviewItem[];
  theme: ThemePreference;
  workspaceRoot?: string;
  gitBranch?: string;
  onDreamSelect?: (dreamId: string) => void;
}) {
  const iconSrc = theme === "light" ? "/spirit-agent-icon-light.png" : "/spirit-agent-icon.png";
  const graph = useMemo(
    () => buildGraph(items, iconSrc, workspaceRoot, gitBranch),
    [gitBranch, iconSrc, items, workspaceRoot],
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
      onNodeClick={(_event, node) => {
        if (node.id !== "context" && node.id !== "logo") {
          onDreamSelect?.(node.id);
        }
      }}
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
  onDreamSelect,
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
            onDreamSelect={onDreamSelect}
          />
        </ReactFlowProvider>
      </div>
    </div>
  );
}