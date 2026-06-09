export const SKILL_CHIP_CLASS =
  "inline-flex items-center bg-yellow-50 px-0.5 py-0.5 text-xs font-medium leading-none text-yellow-900 select-none align-middle mx-0.5 dark:bg-yellow-950 dark:text-yellow-300";

export function makeSkillChipNode(alias: string, doc: Document): HTMLElement {
  const span = doc.createElement("span");
  span.contentEditable = "false";
  span.setAttribute("data-skill-chip", "true");
  span.dataset.skillChip = "true";
  span.dataset.skillAlias = alias;
  span.setAttribute("data-skill-alias", alias);
  span.className = SKILL_CHIP_CLASS;
  span.setAttribute("aria-label", alias);

  span.appendChild(doc.createTextNode(alias));
  return span;
}
