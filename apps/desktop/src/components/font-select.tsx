import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { ChevronDown, LoaderCircle } from "lucide-react";

import {
  FilteredOverlayMenu,
  FilteredOverlayMenuTrigger,
} from "@/components/ui/filtered-overlay-menu";
import {
  DESKTOP_OVERLAY_LIST_ITEM_PRIMARY,
  DESKTOP_OVERLAY_LIST_SUB_TRIGGER,
  DESKTOP_SELECT_TRIGGER,
} from "@/lib/desktop-chrome";
import {
  DEFAULT_FONT_ID,
  DEFAULT_FONT_LABEL,
  toFontFamilyStack,
  type FontPreference,
} from "@/lib/font";
import { cn } from "@/lib/utils";

/** 与 [`SelectTrigger`](./ui/select.tsx) / `DESKTOP_SELECT_TRIGGER` 保持一致，便于设置页视觉对齐。 */
const fontSelectTriggerClassName = DESKTOP_SELECT_TRIGGER;

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
  triggerClassName?: string;
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
  triggerClassName,
}: FontSelectProps) {
  const { t } = useTranslation();
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
    <div className="w-full space-y-1.5 sm:w-auto">
      <FilteredOverlayMenu
        open={open}
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen);
          if (!nextOpen) {
            setFilter("");
          }
        }}
        align="end"
        filterValue={filter}
        onFilterChange={setFilter}
        filterPlaceholder={t("settings.searchFont")}
        trigger={
          <FilteredOverlayMenuTrigger asChild>
            <button
              id={id}
              type="button"
              role="combobox"
              aria-expanded={open}
              disabled={disabled || effectiveLoading}
              className={cn(fontSelectTriggerClassName, triggerClassName)}
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
          </FilteredOverlayMenuTrigger>
        }
      >
        {effectiveLoading ? (
          <p className="px-2 py-4 text-center text-xs text-muted-foreground">{t("settings.loadingFonts")}</p>
        ) : filteredOptions.length === 0 ? (
          <p className="px-2 py-4 text-center text-xs text-muted-foreground">{t("settings.noMatchingFonts")}</p>
        ) : (
          filteredOptions.map((option) => {
            const selected = option.id === value;
            return (
              <div
                key={option.id}
                role="menuitem"
                tabIndex={-1}
                className={cn(
                  DESKTOP_OVERLAY_LIST_SUB_TRIGGER,
                  "cursor-pointer outline-none focus:bg-accent focus:text-accent-foreground",
                  selected && "bg-accent/40",
                )}
                style={option.fontFamily ? { fontFamily: option.fontFamily } : undefined}
                onClick={() => selectValue(option.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    selectValue(option.id);
                  }
                }}
              >
                <span className={cn(DESKTOP_OVERLAY_LIST_ITEM_PRIMARY, "min-w-0 truncate")}>
                  {option.label}
                </span>
              </div>
            );
          })
        )}
      </FilteredOverlayMenu>
      {loadFailed ? (
        <p className="text-xs text-muted-foreground">{t("settings.fontEnumerationFailed")}</p>
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
