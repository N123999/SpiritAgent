import { useEffect, useMemo, useState } from "react";

import { Check, ChevronDown, LoaderCircle } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  DEFAULT_FONT_ID,
  DEFAULT_FONT_LABEL,
  toFontFamilyStack,
  type FontPreference,
} from "@/lib/font";
import { cn } from "@/lib/utils";

/** 与 [`SelectTrigger`](./ui/select.tsx) 保持一致，便于设置页视觉对齐。 */
const fontSelectTriggerClassName = cn(
  "flex h-9 w-full min-w-0 cursor-pointer items-center justify-between gap-2 rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs outline-none",
  "focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50",
  "disabled:cursor-not-allowed disabled:opacity-50",
  "[&>span]:line-clamp-1",
);

type BrowserFontData = {
  family?: string;
};

type FontSelectProps = {
  id?: string;
  value: FontPreference;
  onValueChange(value: FontPreference): void;
  fonts?: string[];
  loading?: boolean;
  disabled?: boolean;
};

type FontOption = {
  id: FontPreference;
  label: string;
  fontFamily?: string;
};

export function FontSelect({
  id,
  value,
  onValueChange,
  fonts,
  loading,
  disabled,
}: FontSelectProps) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const [loadedFonts, setLoadedFonts] = useState<string[]>([]);
  const [internalLoading, setInternalLoading] = useState(fonts === undefined);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    if (fonts !== undefined) {
      setInternalLoading(false);
      return;
    }

    let cancelled = false;

    const load = async () => {
      setInternalLoading(true);
      setLoadFailed(false);
      try {
        const nextFonts = await listAvailableFonts();
        if (!cancelled) {
          setLoadedFonts(nextFonts);
        }
      } catch {
        if (!cancelled) {
          setLoadedFonts([]);
          setLoadFailed(true);
        }
      } finally {
        if (!cancelled) {
          setInternalLoading(false);
        }
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [fonts]);

  const effectiveLoading = loading ?? internalLoading;
  const fontOptions = useMemo(() => {
    const sourceFonts = fonts ?? loadedFonts;
    const values = new Set<string>();
    for (const font of sourceFonts) {
      const trimmed = font.trim();
      if (trimmed && trimmed !== DEFAULT_FONT_ID) {
        values.add(trimmed);
      }
    }
    if (value !== DEFAULT_FONT_ID && value.trim()) {
      values.add(value.trim());
    }
    return Array.from(values).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  }, [fonts, loadedFonts, value]);

  const allOptions = useMemo<FontOption[]>(
    () => [
      { id: DEFAULT_FONT_ID, label: DEFAULT_FONT_LABEL },
      ...fontOptions.map((font) => ({
        id: font,
        label: font,
        fontFamily: toFontFamilyStack(font),
      })),
    ],
    [fontOptions],
  );

  const normalizedFilter = filter.trim().toLowerCase();
  const filteredOptions = useMemo(() => {
    if (!normalizedFilter) {
      return allOptions;
    }
    return allOptions.filter((option) => option.label.toLowerCase().includes(normalizedFilter));
  }, [allOptions, normalizedFilter]);

  const currentLabel = value === DEFAULT_FONT_ID ? DEFAULT_FONT_LABEL : value;

  const selectValue = (next: FontPreference) => {
    onValueChange(next);
    setFilter("");
    setOpen(false);
  };

  return (
    <div className="w-full space-y-1.5">
      <DropdownMenu
        open={open}
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen);
          if (!nextOpen) {
            setFilter("");
          }
        }}
      >
        <DropdownMenuTrigger asChild>
          <button
            id={id}
            type="button"
            role="combobox"
            aria-expanded={open}
            disabled={disabled || effectiveLoading}
            className={fontSelectTriggerClassName}
          >
            <span
              className="min-w-0 truncate text-left"
              style={value === DEFAULT_FONT_ID ? undefined : { fontFamily: toFontFamilyStack(value) }}
            >
              {currentLabel}
            </span>
            {effectiveLoading ? (
              <LoaderCircle className="size-4 shrink-0 animate-spin opacity-60" aria-hidden />
            ) : (
              <ChevronDown className="size-4 shrink-0 opacity-60" aria-hidden />
            )}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="w-max min-w-[var(--radix-dropdown-menu-trigger-width)] max-w-[min(22rem,calc(100vw-1.25rem))] p-0"
        >
          <div className="border-b border-border/40 p-1.5">
            <Input
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder="搜索字体..."
              className="h-8 w-full min-w-0 text-sm"
              onKeyDown={(event) => event.stopPropagation()}
              autoComplete="off"
            />
          </div>
          <ScrollArea
            type="always"
            className="[&>[data-radix-scroll-area-viewport]]:max-h-[min(20rem,var(--radix-dropdown-menu-content-available-height))] [&>[data-radix-scroll-area-viewport]]:overscroll-contain"
            onWheel={(event) => {
              event.stopPropagation();
            }}
            onTouchMove={(event) => {
              event.stopPropagation();
            }}
          >
            <div className="p-1 pr-2">
              {effectiveLoading ? (
                <p className="px-2 py-4 text-center text-xs text-muted-foreground">正在加载字体...</p>
              ) : filteredOptions.length === 0 ? (
                <p className="px-2 py-4 text-center text-xs text-muted-foreground">没有匹配的字体</p>
              ) : (
                filteredOptions.map((option) => {
                  const selected = option.id === value;
                  return (
                    <DropdownMenuItem
                      key={option.id}
                      className={cn("gap-2", selected && "bg-accent/40")}
                      style={option.fontFamily ? { fontFamily: option.fontFamily } : undefined}
                      onSelect={() => selectValue(option.id)}
                    >
                      <span className="min-w-0 flex-1 truncate">{option.label}</span>
                      <Check
                        className={cn("size-4 shrink-0", selected ? "opacity-100" : "opacity-0")}
                        aria-hidden
                      />
                    </DropdownMenuItem>
                  );
                })
              )}
            </div>
          </ScrollArea>
        </DropdownMenuContent>
      </DropdownMenu>
      {loadFailed ? (
        <p className="text-xs text-muted-foreground">无法枚举本机字体；请在桌面客户端中重试。</p>
      ) : null}
    </div>
  );
}

async function listAvailableFonts(): Promise<string[]> {
  if (window.spiritDesktop) {
    return window.spiritDesktop.listSystemFonts();
  }

  const localFonts = await queryBrowserLocalFonts();
  return normalizeFonts(localFonts.map((font) => font.family).filter((family): family is string => Boolean(family)));
}

async function queryBrowserLocalFonts(): Promise<BrowserFontData[]> {
  const queryLocalFonts =
    (window as Window & { queryLocalFonts?: () => Promise<BrowserFontData[]> }).queryLocalFonts ??
    (document as Document & { queryLocalFonts?: () => Promise<BrowserFontData[]> }).queryLocalFonts;

  if (!queryLocalFonts) {
    throw new Error("Local font access is not available.");
  }
  return queryLocalFonts();
}

function normalizeFonts(fonts: string[]): string[] {
  return Array.from(
    new Set(
      fonts
        .map((font) => font.trim())
        .filter(Boolean),
    ),
  ).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}
