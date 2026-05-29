import { useEffect } from "react";
import type { Figure } from "../../types";
import { figureUrl } from "../../api";
import "./FigureOverlay.css";

interface Props {
  docId: string;
  figure: Figure;
  index: number;
  total: number;
  onClose: () => void;
  onPrev?: () => void;
  onNext?: () => void;
  onGotoPage?: (page: number) => void;
}

export function FigureOverlay({
  docId,
  figure,
  index,
  total,
  onClose,
  onPrev,
  onNext,
  onGotoPage,
}: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft" && onPrev) onPrev();
      else if (e.key === "ArrowRight" && onNext) onNext();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, onPrev, onNext]);

  return (
    <div className="figovl-backdrop" onClick={onClose} role="presentation">
      <div className="figovl" onClick={(e) => e.stopPropagation()}>
        <header className="figovl-head">
          <span className="figovl-counter">
            Figure {index + 1} / {total}
          </span>
          <button
            type="button"
            className="figovl-close"
            onClick={onClose}
            aria-label="Fermer"
          >
            ✕
          </button>
        </header>
        <div className="figovl-imgwrap">
          {onPrev && (
            <button
              type="button"
              className="figovl-nav figovl-nav-prev"
              onClick={onPrev}
              aria-label="Figure précédente"
            >
              ‹
            </button>
          )}
          <img
            className="figovl-img"
            src={figureUrl(docId, figure.id)}
            alt={figure.caption || `Figure ${figure.id}`}
          />
          {onNext && (
            <button
              type="button"
              className="figovl-nav figovl-nav-next"
              onClick={onNext}
              aria-label="Figure suivante"
            >
              ›
            </button>
          )}
        </div>
        <footer className="figovl-foot">
          {figure.caption && <p className="figovl-caption">{figure.caption}</p>}
          {figure.caption_ai && (
            <p className="figovl-caption figovl-caption-ai">
              <span className="figovl-ai-badge">IA</span>
              {figure.caption_ai}
            </p>
          )}
          <div className="figovl-actions">
            {figure.page != null && (
              <span className="figovl-page">page {figure.page}</span>
            )}
            {figure.page != null && onGotoPage && (
              <button
                type="button"
                className="figovl-goto"
                onClick={() => figure.page != null && onGotoPage(figure.page)}
              >
                Aller à la page
              </button>
            )}
          </div>
        </footer>
      </div>
    </div>
  );
}
