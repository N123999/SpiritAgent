import { useRef, type ReactNode, type RefObject } from "react";

import {
  PR_SUBTAB_SHELL_DIVIDER_ATTR,
} from "@/lib/workspace-tools-panel-edge";
import { useWorkspaceToolsShellHorizontalDivider } from "@/lib/use-workspace-tools-shell-horizontal-divider";
import { cn } from "@/lib/utils";

export type DetailPageTabItem<T extends string> = {
  id: T;
  label: string;
};

export type DetailPageTabsProps<T extends string> = {
  tabs: readonly DetailPageTabItem<T>[];
  activeTab: T;
  onTabChange: (tab: T) => void;
  ariaLabel: string;
  size?: "default" | "compact";
  children: ReactNode;
  className?: string;
  contentClassName?: string;
  /** Extra classes on the tab list row (e.g. symmetric vertical padding). */
  tabListClassName?: string;
  /** Draw tab divider on workspace tools shell (spans resize column + panel). */
  edgeToPanelDivider?: boolean;
  /** Shell divider data attribute; defaults to PR sub-tab attr. */
  shellDividerAttr?: string;
  /** Re-sync shell divider when sibling layout changes (e.g. resizable overview pane). */
  shellDividerWatchRefs?: RefObject<HTMLElement | null>[];
  shellDividerLayoutDeps?: readonly unknown[];
};

const tabListClassBySize = {
  default: "gap-1 pt-0.5",
  compact: "gap-3 pt-0.5",
} as const;

const tabButtonClassBySize = {
  default: "rounded-md px-3 py-2 text-sm underline-offset-[10px]",
  compact: "rounded-sm px-0 py-1 text-xs underline-offset-[6px]",
} as const;

const containerClassBySize = {
  default: "flex flex-col gap-4",
  compact: "flex flex-col gap-0",
} as const;

export function DetailPageTabs<T extends string>({
  tabs,
  activeTab,
  onTabChange,
  ariaLabel,
  size = "default",
  children,
  className,
  contentClassName,
  tabListClassName,
  edgeToPanelDivider = false,
  shellDividerAttr = PR_SUBTAB_SHELL_DIVIDER_ATTR,
  shellDividerWatchRefs,
  shellDividerLayoutDeps = [],
}: DetailPageTabsProps<T>) {
  const tabPanelId = `detail-page-tabpanel-${activeTab}`;
  const tabBarRef = useRef<HTMLDivElement>(null);

  useWorkspaceToolsShellHorizontalDivider(
    tabBarRef,
    {
      enabled: edgeToPanelDivider,
      edge: "bottom",
      dividerAttr: shellDividerAttr,
      watchRefs: shellDividerWatchRefs,
    },
    [activeTab, ...shellDividerLayoutDeps],
  );

  return (
    <div className={cn(containerClassBySize[size], className)}>
      <div
        ref={tabBarRef}
        className={cn("shrink-0 w-full", !edgeToPanelDivider && "border-b border-border/40")}
      >
        <div
          className={cn("flex flex-wrap px-3 pb-3", tabListClassBySize[size], tabListClassName)}
          role="tablist"
          aria-label={ariaLabel}
        >
          {tabs.map(({ id, label }) => {
            const selected = activeTab === id;
            const tabId = `detail-page-tab-${id}`;

            return (
              <button
                key={id}
                id={tabId}
                type="button"
                role="tab"
                aria-selected={selected}
                aria-controls={selected ? tabPanelId : undefined}
                className={cn(
                  tabButtonClassBySize[size],
                  selected
                    ? "font-medium text-foreground underline decoration-foreground/80"
                    : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                )}
                onClick={() => onTabChange(id)}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>
      <div
        id={tabPanelId}
        role="tabpanel"
        aria-labelledby={`detail-page-tab-${activeTab}`}
        className={contentClassName}
      >
        {children}
      </div>
    </div>
  );
}
