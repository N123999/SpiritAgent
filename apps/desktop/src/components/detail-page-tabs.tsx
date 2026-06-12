import type { ReactNode } from "react";

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
  default: "space-y-4",
  compact: "space-y-4",
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
}: DetailPageTabsProps<T>) {
  const tabPanelId = `detail-page-tabpanel-${activeTab}`;

  return (
    <div className={cn(containerClassBySize[size], className)}>
      <div
        className={cn("flex flex-wrap", tabListClassBySize[size])}
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
