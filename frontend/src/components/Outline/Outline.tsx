import { useEffect, useRef, useState } from "react";
import type { OutlineNode } from "../../types";
import "./Outline.css";

interface Props {
  nodes: OutlineNode[];
  onSelect: (node: OutlineNode) => void;
  activeId?: string | null;
}

export function Outline({ nodes, onSelect, activeId }: Props) {
  const rootRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    if (!activeId || !rootRef.current) return;
    const el = rootRef.current.querySelector<HTMLElement>(
      `[data-section-id="${CSS.escape(activeId)}"]`,
    );
    el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [activeId]);

  // Navigation clavier ↑/↓ entre les titres focusés
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      if (!(e.target instanceof HTMLElement) || !root.contains(e.target)) return;
      const titles = Array.from(
        root.querySelectorAll<HTMLButtonElement>(".outline-title"),
      );
      const idx = titles.indexOf(e.target as HTMLButtonElement);
      if (idx === -1) return;
      e.preventDefault();
      const next = e.key === "ArrowDown" ? idx + 1 : idx - 1;
      titles[Math.max(0, Math.min(titles.length - 1, next))]?.focus();
    };
    root.addEventListener("keydown", onKey);
    return () => root.removeEventListener("keydown", onKey);
  }, []);

  if (nodes.length === 0) {
    return <p className="outline-empty">Aucune structure détectée dans ce document.</p>;
  }
  return (
    <ul className="outline" ref={rootRef}>
      {nodes.map((n) => (
        <OutlineItem key={n.id} node={n} onSelect={onSelect} activeId={activeId} />
      ))}
    </ul>
  );
}

interface ItemProps {
  node: OutlineNode;
  onSelect: (node: OutlineNode) => void;
  activeId?: string | null;
}

function OutlineItem({ node, onSelect, activeId }: ItemProps) {
  const [expanded, setExpanded] = useState(true);
  const hasChildren = node.children.length > 0;
  const isActive = activeId === node.id;

  return (
    <li className="outline-item">
      <div
        className={`outline-row${isActive ? " is-active" : ""}`}
        data-section-id={node.id}
      >
        {hasChildren ? (
          <button
            type="button"
            className="outline-toggle"
            aria-label={expanded ? "Réduire" : "Développer"}
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? "▾" : "▸"}
          </button>
        ) : (
          <span className="outline-toggle outline-toggle-empty" />
        )}
        <button
          type="button"
          className="outline-title"
          onClick={() => onSelect(node)}
          title={node.title}
        >
          {node.title}
          {node.page != null && <span className="outline-page">p.{node.page}</span>}
        </button>
      </div>
      {hasChildren && expanded && (
        <ul className="outline-children">
          {node.children.map((c) => (
            <OutlineItem key={c.id} node={c} onSelect={onSelect} activeId={activeId} />
          ))}
        </ul>
      )}
    </li>
  );
}
