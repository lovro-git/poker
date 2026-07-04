// Tiny DOM builder. Strings become text nodes (safe against injection — player
// names arrive from untrusted peers and must never be set via innerHTML).

type Attrs = Record<string, string | number | boolean | ((e: Event) => void) | undefined>;
type Child = Node | string | number | null | false | undefined;

export function h(tag: string, attrs: Attrs = {}, ...kids: Child[]): HTMLElement {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (k === "class") e.className = String(v);
    else if (k.startsWith("on") && typeof v === "function") {
      e.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    } else if (v === true) e.setAttribute(k, "");
    else e.setAttribute(k, String(v));
  }
  for (const kid of kids) {
    if (kid === null || kid === undefined || kid === false) continue;
    e.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return e;
}

export function clear(node: HTMLElement): HTMLElement {
  node.replaceChildren();
  return node;
}

/** Format a chip count compactly: 1500 -> "1.5k", 20 -> "20". */
export function chips(n: number): string {
  if (n >= 10000) return `${Math.round(n / 1000)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(n);
}
