import type { TFunction } from "i18next";

export const EMPTY_SESSION_GREETING_PLAIN_VARIANTS = ["startSomething", "letsBuild"] as const;

export const EMPTY_SESSION_GREETING_WORKSPACE_VARIANT = "doSomethingIn" as const;

export type EmptySessionGreetingPlainVariantId =
  (typeof EMPTY_SESSION_GREETING_PLAIN_VARIANTS)[number];

export type EmptySessionGreetingVariantId =
  | EmptySessionGreetingPlainVariantId
  | typeof EMPTY_SESSION_GREETING_WORKSPACE_VARIANT;

export function emptySessionGreetingPool(
  includeWorkspaceVariants: boolean,
): readonly EmptySessionGreetingVariantId[] {
  if (includeWorkspaceVariants) {
    return [...EMPTY_SESSION_GREETING_PLAIN_VARIANTS, EMPTY_SESSION_GREETING_WORKSPACE_VARIANT];
  }
  return EMPTY_SESSION_GREETING_PLAIN_VARIANTS;
}

export function pickEmptySessionGreetingVariant(options: {
  includeWorkspaceVariants: boolean;
  random?: () => number;
}): EmptySessionGreetingVariantId {
  const pool = emptySessionGreetingPool(options.includeWorkspaceVariants);
  const random = options.random ?? Math.random;
  const index = Math.floor(random() * pool.length);
  return pool[Math.min(index, pool.length - 1)]!;
}

export function resolveEmptySessionGreeting(
  t: TFunction,
  variantId: EmptySessionGreetingVariantId,
  workspaceLabel: string | null,
): string {
  return t(`app.emptySessionGreeting.${variantId}`, {
    workspace: workspaceLabel ?? "",
  });
}

export function isWorkspaceGreetingVariant(variantId: string): boolean {
  return variantId === EMPTY_SESSION_GREETING_WORKSPACE_VARIANT;
}
