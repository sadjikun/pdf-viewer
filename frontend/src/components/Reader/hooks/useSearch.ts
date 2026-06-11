import { useState, useRef, useEffect, type RefObject } from "react";

/**
 * Hook for in-reader search functionality.
 * Handles search state, DOM <mark> injection/removal, sidebar search sync,
 * and scroll-to-active-result navigation.
 */
export function useSearch(
  contentRef: RefObject<HTMLDivElement | null>,
  propSearchQuery: string | undefined,
  visibleHtml: string | null,
) {
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchCount, setSearchCount] = useState(0);
  const [searchIdx, setSearchIdx] = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Synchronise la recherche globale de la sidebar avec le Reader
  useEffect(() => {
    if (propSearchQuery !== undefined) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSearchQuery(propSearchQuery);
      if (propSearchQuery.trim()) {
        setShowSearch(true);
      } else {
        setShowSearch(false);
        setSearchCount(0);
      }
    }
  }, [propSearchQuery]);

  // In-reader search: inject/remove <mark> elements
  useEffect(() => {
    const doc = contentRef.current?.querySelector<HTMLElement>(".reader-doc");
    if (!doc) return;

    const timer = setTimeout(() => {
      doc.querySelectorAll(".reader-sm").forEach((m) => {
        const parent = m.parentNode;
        if (!parent) return;
        parent.replaceChild(document.createTextNode(m.textContent ?? ""), m);
        parent.normalize();
      });

      const query = searchQuery.trim().toLowerCase();
      if (!query) { setSearchCount(0); return; }

      const SKIP = new Set(["SCRIPT", "STYLE", "MARK", "NOSCRIPT"]);
      const walker = document.createTreeWalker(doc, NodeFilter.SHOW_TEXT, {
        acceptNode: (node) => {
          const p = node.parentElement;
          return p && SKIP.has(p.tagName) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
        },
      });

      const textNodes: Text[] = [];
      let node: Node | null;
      while ((node = walker.nextNode())) {
        if ((node as Text).textContent?.toLowerCase().includes(query)) {
          textNodes.push(node as Text);
        }
      }

      let count = 0;
      textNodes.forEach((tn) => {
        const text = tn.textContent ?? "";
        const lower = text.toLowerCase();
        const frag = document.createDocumentFragment();
        let pos = 0;
        let idx = lower.indexOf(query, pos);
        while (idx !== -1) {
          if (idx > pos) frag.appendChild(document.createTextNode(text.slice(pos, idx)));
          const mark = document.createElement("mark");
          mark.className = "reader-sm";
          mark.dataset.mid = String(count++);
          mark.textContent = text.slice(idx, idx + query.length);
          frag.appendChild(mark);
          pos = idx + query.length;
          idx = lower.indexOf(query, pos);
        }
        if (pos < text.length) frag.appendChild(document.createTextNode(text.slice(pos)));
        tn.parentNode?.replaceChild(frag, tn);
      });

      setSearchCount(count);
      setSearchIdx(0);
    }, 160);

    return () => clearTimeout(timer);
  }, [searchQuery, visibleHtml, contentRef]);

  // Scroll to active search result
  useEffect(() => {
    if (!searchCount) return;
    const mark = contentRef.current?.querySelector<HTMLElement>(`.reader-sm[data-mid="${searchIdx}"]`);
    contentRef.current?.querySelectorAll(".reader-sm").forEach((m) => m.classList.remove("is-active"));
    if (mark) {
      mark.classList.add("is-active");
      mark.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [searchIdx, searchCount, contentRef]);

  return {
    showSearch,
    setShowSearch,
    searchQuery,
    setSearchQuery,
    searchCount,
    setSearchCount,
    searchIdx,
    setSearchIdx,
    searchInputRef,
  };
}
