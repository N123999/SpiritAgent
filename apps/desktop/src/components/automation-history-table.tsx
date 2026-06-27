import { useMemo } from "react";
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { useTranslation } from "react-i18next";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { DESKTOP_INSTANT_HOVER_OVERLAY } from "@/lib/desktop-chrome";
import { formatRelativeTime } from "@/lib/format-relative-time";
import { cn } from "@/lib/utils";
import type { DesktopAutomationRun, DesktopAutomationRunStatus } from "@/types";

type AutomationHistoryTableProps = {
  runs: DesktopAutomationRun[];
  onOpenSession(sessionPath: string): void;
};

const columnHelper = createColumnHelper<DesktopAutomationRun>();

function runStatusLabelKey(status: DesktopAutomationRunStatus) {
  return `automations.runStatus.${status}` as const;
}

export function AutomationHistoryTable({ runs, onOpenSession }: AutomationHistoryTableProps) {
  const { t, i18n } = useTranslation();

  const sortedRuns = useMemo(
    () => [...runs].sort((left, right) => right.startedAtUnixMs - left.startedAtUnixMs),
    [runs],
  );

  const columns = useMemo(
    () => [
      columnHelper.accessor("startedAtUnixMs", {
        id: "time",
        header: () => t("automations.historyColumnTime"),
        cell: ({ getValue }) => {
          const startedAtIso = new Date(getValue()).toISOString();
          return (
            <time dateTime={startedAtIso}>
              {formatRelativeTime(startedAtIso, i18n.language)}
            </time>
          );
        },
      }),
      columnHelper.accessor("status", {
        id: "status",
        header: () => t("automations.historyColumnStatus"),
        cell: ({ getValue }) => t(runStatusLabelKey(getValue())),
      }),
    ],
    [i18n.language, t],
  );

  const table = useReactTable({
    data: sortedRuns,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (row) => row.id,
  });

  if (sortedRuns.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">{t("automations.noRuns")}</p>
    );
  }

  return (
    <div
      className={cn(
        "overflow-hidden rounded-lg border border-border/40",
        "[&_[data-slot=table-row]]:border-border/40",
      )}
    >
      <Table>
        <TableHeader>
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id} className="hover:bg-transparent">
              {headerGroup.headers.map((header) => (
                <TableHead
                  key={header.id}
                  className={cn(
                    "text-foreground/80",
                    header.column.id === "status" && "text-right",
                  )}
                >
                  {header.isPlaceholder
                    ? null
                    : flexRender(header.column.columnDef.header, header.getContext())}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows.map((row) => (
            <TableRow
              key={row.id}
              className={cn(
                "cursor-pointer transition-none hover:bg-transparent",
                DESKTOP_INSTANT_HOVER_OVERLAY,
              )}
              onClick={() => onOpenSession(row.original.sessionPath)}
              title={t("automations.openSession")}
            >
              {row.getVisibleCells().map((cell) => (
                <TableCell
                  key={cell.id}
                  className={cn(
                    "text-foreground/80",
                    cell.column.id === "status" && "text-right",
                  )}
                >
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
