import { useState, useMemo, useEffect } from "react";
import type { RefObject } from "react";
import type { Section, PaperMeta } from "../readerHtml";
import type { OutlineNode } from "../../../types";
import { matchSection } from "../readerHtml";

interface UseFocusModeParams {
  focusSectionTitle?: string | null;
  onFocusClear?: () => void;
  sections: Section[];
  renderMode: "html" | "md";
  htmlContent: string | null;
  outline?: OutlineNode[];
  paperMeta: PaperMeta | null;
  contentRef: RefObject<HTMLDivElement | null>;
  setBreadcrumb: (b: string) => void;
}

export function useFocusMode(params: UseFocusModeParams) {
  const {
    focusSectionTitle,
    onFocusClear,
    sections,
    renderMode,
    htmlContent,
    outline,
    paperMeta,
    contentRef,
    setBreadcrumb,
  } = params;

  const [focusSid, setFocusSid] = useState<string | null>(null);
  const [focusIdx, setFocusIdx] = useState(0);

  // Focus mode visible HTML filter
  const visibleHtml = useMemo(() => {
    if (!htmlContent) return null;
    const styles: string[] = [];
    if (paperMeta?.title) {
      styles.push(`section[data-sid="rs_pre"]{display:none!important}`);
    }
    if (focusSid) {
      const n = (s: string) => s.toLowerCase().replace(/\W+/g, "");
      const visibleSids: string[] = [focusSid];
      const focusedTitle = sections[focusIdx]?.title ?? "";

      let descendantTitles: Set<string> | null = null;
      if (outline && outline.length > 0) {
        const collectDescendantTitles = (node: OutlineNode, set: Set<string>) => {
          set.add(n(node.title));
          const stripped = n(node.title.replace(/^\s*\d+(?:\.\d+)*\.?\s+/, ""));
          if (stripped) set.add(stripped);
          if (node.children) {
            for (const child of node.children) {
              collectDescendantTitles(child, set);
            }
          }
        };

        const searchOutline = (nodes: OutlineNode[]): Set<string> | null => {
          for (const node of nodes) {
            const nodeNorm = n(node.title);
            const focusNorm = n(focusedTitle);
            const strippedNode = n(node.title.replace(/^\s*\d+(?:\.\d+)*\.?\s+/, ""));
            const strippedFocus = n(focusedTitle.replace(/^\s*\d+(?:\.\d+)*\.?\s+/, ""));
            if (
              nodeNorm === focusNorm || 
              (strippedNode && strippedNode === focusNorm) ||
              (strippedFocus && nodeNorm === strippedFocus)
            ) {
              const set = new Set<string>();
              collectDescendantTitles(node, set);
              return set;
            }
            if (node.children && node.children.length > 0) {
              const res = searchOutline(node.children);
              if (res) return res;
            }
          }
          return null;
        };

        descendantTitles = searchOutline(outline);
      }

      if (descendantTitles && descendantTitles.size > 0) {
        for (let i = focusIdx + 1; i < sections.length; i++) {
          const titleNorm = n(sections[i].title);
          const strippedTitle = n(sections[i].title.replace(/^\s*\d+(?:\.\d+)*\.?\s+/, ""));
          if (descendantTitles.has(titleNorm) || (strippedTitle && descendantTitles.has(strippedTitle))) {
            visibleSids.push(sections[i].id);
          }
        }
      } else {
        for (let i = focusIdx + 1; i < sections.length; i++) {
          if (sections[i].level <= (sections[focusIdx]?.level ?? 1)) break;
          visibleSids.push(sections[i].id);
        }
      }

      styles.push(`section[data-sid]{display:none!important}`);
      const showList = visibleSids.map((sid) => `section[data-sid="${sid}"]`).join(",");
      styles.push(`${showList}{display:block!important}`);
    }
    return styles.length
      ? htmlContent + `<style>${styles.join("")}</style>`
      : htmlContent;
  }, [htmlContent, focusSid, focusIdx, sections, paperMeta, outline]);

  // Sidebar navigation scroll effect
  useEffect(() => {
    if (!focusSectionTitle) return;

    const t = setTimeout(() => {
      if (!contentRef.current) return;

      if (renderMode === "html" && sections.length) {
        const match = matchSection(sections, focusSectionTitle);
        if (match) {
          const idx = sections.indexOf(match);
          setBreadcrumb(match.title);
          setFocusIdx(idx);
          setFocusSid(match.id);
          contentRef.current.scrollTo({ top: 0, behavior: "smooth" });
          return;
        }
      }

      const normalize = (s: string) => s.toLowerCase().replace(/\W+/g, "");
      const target = normalize(focusSectionTitle);
      const headings = contentRef.current.querySelectorAll<HTMLElement>("h1,h2,h3,h4");
      for (const h of headings) {
        const ht = normalize(h.textContent ?? "");
        if (ht === target || ht.includes(target) || target.includes(ht)) {
          h.scrollIntoView({ behavior: "smooth", block: "start" });
          break;
        }
      }
      onFocusClear?.();
    }, 80);

    return () => clearTimeout(t);
  }, [focusSectionTitle, renderMode, sections, contentRef, onFocusClear, setBreadcrumb]);

  const goFocus = (idx: number) => {
    if (idx < 0 || idx >= sections.length) return;
    setFocusSid(sections[idx].id);
    setFocusIdx(idx);
    setBreadcrumb(sections[idx].title);
    contentRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  };

  const exitFocus = () => {
    const sid = sections[focusIdx]?.id;
    setFocusSid(null);
    onFocusClear?.();
    setTimeout(() => {
      const el = contentRef.current?.querySelector(`[data-sid="${sid}"]`);
      el?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 50);
  };

  return {
    focusSid,
    setFocusSid,
    focusIdx,
    setFocusIdx,
    visibleHtml,
    goFocus,
    exitFocus,
  };
}
