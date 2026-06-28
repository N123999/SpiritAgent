import type { CSSProperties } from "react";
import type { TokensResult } from "shiki";

import { cn } from "@/lib/utils";

type HighlightResult = TokensResult;
type HighlightToken = TokensResult["tokens"][number][number];

/** 与 Streamdown 默认 CodeBlock 一致：去掉末尾换行，避免多出一行空白 token */
export function trimTrailingNewlines(code: string): string {
  let end = code.length;
  while (end > 0 && code[end - 1] === "\n") {
    end -= 1;
  }
  return code.slice(0, end);
}

export function isEmptyTokenLine(line: HighlightResult["tokens"][number]): boolean {
  return line.length === 0 || (line.length === 1 && line[0]?.content === "");
}

function dropTrailingEmptyTokenLines(tokens: HighlightResult["tokens"]): HighlightResult["tokens"] {
  let end = tokens.length;
  while (end > 0 && isEmptyTokenLine(tokens[end - 1]!)) {
    end -= 1;
  }
  return tokens.slice(0, end);
}

export function plainHighlightResult(code: string): HighlightResult {
  const normalized = trimTrailingNewlines(code);
  return {
    tokens: normalized.split("\n").map((line) => [
      {
        content: line,
        color: "inherit",
        htmlStyle: {},
        offset: 0,
      },
    ]),
  };
}

function tokenStyle(token: HighlightToken): { style: CSSProperties; hasBg: boolean } {
  const style: Record<string, string> = {};
  let hasBg = Boolean(token.bgColor);

  if (token.color) {
    style["--sdm-c"] = token.color;
  }
  if (token.bgColor) {
    style["--sdm-tbg"] = token.bgColor;
  }
  if (token.htmlStyle) {
    for (const [key, value] of Object.entries(token.htmlStyle)) {
      if (typeof value !== "string") {
        continue;
      }
      if (key === "color") {
        style["--sdm-c"] = value;
      } else if (key === "background-color") {
        style["--sdm-tbg"] = value;
        hasBg = true;
      } else {
        style[key] = value;
      }
    }
  }

  return { style: style as CSSProperties, hasBg };
}

export function renderHighlightToken(token: HighlightToken, key: string | number) {
  const { style, hasBg } = tokenStyle(token);

  return (
    <span
      key={key}
      className={cn(
        "text-[var(--sdm-c,inherit)] dark:text-[var(--shiki-dark,var(--sdm-c,inherit))]",
        hasBg && "bg-[var(--sdm-tbg)] dark:bg-[var(--shiki-dark-bg,var(--sdm-tbg))]",
      )}
      style={style}
      {...token.htmlAttrs}
    >
      {token.content}
    </span>
  );
}

export function renderHighlightedCodeBody(result: HighlightResult) {
  const preStyle =
    typeof result.rootStyle === "string"
      ? (Object.fromEntries(
          result.rootStyle
            .split(";")
            .filter(Boolean)
            .map((rule) => {
              const colon = rule.indexOf(":");
              if (colon === -1) {
                return null;
              }
              return [rule.slice(0, colon).trim(), rule.slice(colon + 1).trim()] as const;
            })
            .filter((entry): entry is readonly [string, string] => entry !== null),
        ) as CSSProperties)
      : undefined;

  const lines = dropTrailingEmptyTokenLines(result.tokens);

  return (
    <div data-language="" data-streamdown="code-block-body">
      <pre
        className="bg-[var(--sdm-bg,inherit)] dark:bg-[var(--shiki-dark-bg,var(--sdm-bg,inherit))]"
        style={preStyle}
      >
        <code>
          {lines.map((line, lineIndex) => (
            <span key={lineIndex} className="block">
              {isEmptyTokenLine(line)
                ? null
                : line.map((token, tokenIndex) => renderHighlightToken(token, tokenIndex))}
            </span>
          ))}
        </code>
      </pre>
    </div>
  );
}
