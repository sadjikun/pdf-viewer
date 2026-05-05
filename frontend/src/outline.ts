import type { OutlineNode } from "./types";

export function flattenOutline(nodes: OutlineNode[]): OutlineNode[] {
  const out: OutlineNode[] = [];
  const walk = (ns: OutlineNode[]) => {
    for (const n of ns) {
      out.push(n);
      walk(n.children);
    }
  };
  walk(nodes);
  return out;
}

/** Section active = la dernière section dont .page <= currentPage (ordre du document). */
export function findActiveSection(
  flat: OutlineNode[],
  page: number,
): OutlineNode | null {
  let best: OutlineNode | null = null;
  for (const n of flat) {
    if (n.page == null) continue;
    if (n.page <= page) best = n;
    else break;
  }
  return best;
}
