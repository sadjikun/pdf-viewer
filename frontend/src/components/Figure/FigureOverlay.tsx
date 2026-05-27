import { useEffect, useState } from "react";
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

export function FigureOverlay(props: Props) {
  return <FigureOverlayContent key={`${props.figure.id}:${props.index}`} {...props} />;
}

function FigureOverlayContent({
  docId,
  figure,
  index,
  total,
  onClose,
  onPrev,
  onNext,
  onGotoPage,
}: Props) {
  const [scale, setScale] = useState(1);
  const [rotation, setRotation] = useState(0);

  const imgUrl = (
    figure.id.startsWith("http://") ||
    figure.id.startsWith("https://") ||
    figure.id.startsWith("/") ||
    figure.id.startsWith("data:")
  )
    ? figure.id
    : figureUrl(docId, figure.id);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft" && onPrev) onPrev();
      else if (e.key === "ArrowRight" && onNext) onNext();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, onPrev, onNext]);

  const handleZoomIn = () => setScale((prev) => Math.min(4.0, prev + 0.25));
  const handleZoomOut = () => setScale((prev) => Math.max(0.25, prev - 0.25));
  const handleRotateLeft = () => setRotation((prev) => prev - 90);
  const handleRotateRight = () => setRotation((prev) => prev + 90);
  const handleReset = () => {
    setScale(1);
    setRotation(0);
  };

  const handlePrint = () => {
    const printWindow = window.open("", "_blank");
    if (printWindow) {
      printWindow.document.write(`
        <html>
          <head>
            <title>Imprimer la figure</title>
            <style>
              body {
                margin: 0;
                display: flex;
                align-items: center;
                justify-content: center;
                height: 100vh;
                background: white;
              }
              img {
                max-width: 100%;
                max-height: 100%;
                object-fit: contain;
              }
              @media print {
                body {
                  background: white;
                }
                img {
                  max-width: 100%;
                  max-height: 100%;
                }
              }
            </style>
          </head>
          <body>
            <img src="${imgUrl}" onload="window.print(); window.close();" />
          </body>
        </html>
      `);
      printWindow.document.close();
    }
  };

  return (
    <div className="figovl-backdrop" onClick={onClose} role="presentation">
      <div className="figovl" onClick={(e) => e.stopPropagation()}>
        <header className="figovl-head">
          <span className="figovl-counter">
            Figure {index + 1} / {total}
          </span>
          <div className="figovl-controls">
            <button
              type="button"
              className="figovl-ctrl-btn"
              onClick={handleRotateLeft}
              title="Rotation gauche"
            >
              ↶
            </button>
            <button
              type="button"
              className="figovl-ctrl-btn"
              onClick={handleRotateRight}
              title="Rotation droite"
            >
              ↷
            </button>
            <button
              type="button"
              className="figovl-ctrl-btn"
              onClick={onPrev}
              disabled={!onPrev}
              title="Précédent"
            >
              ◀
            </button>
            <button
              type="button"
              className="figovl-ctrl-btn"
              onClick={onNext}
              disabled={!onNext}
              title="Suivant"
            >
              ▶
            </button>
            <button
              type="button"
              className="figovl-ctrl-btn"
              onClick={handleZoomIn}
              title="Zoom +"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="11" cy="11" r="7" />
                <path d="m16 16 4 4" />
                <path d="M11 8v6" />
                <path d="M8 11h6" />
              </svg>
            </button>
            <button
              type="button"
              className="figovl-ctrl-btn"
              onClick={handleZoomOut}
              title="Zoom -"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="11" cy="11" r="7" />
                <path d="m16 16 4 4" />
                <path d="M8 11h6" />
              </svg>
            </button>
            <button
              type="button"
              className="figovl-ctrl-btn"
              onClick={handleReset}
              title="Réinitialiser"
            >
              ⟳
            </button>
            <button
              type="button"
              className="figovl-ctrl-btn"
              onClick={handlePrint}
              title="Imprimer"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M7 8V4h10v4" />
                <path d="M7 17H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2" />
                <path d="M7 14h10v6H7z" />
              </svg>
            </button>
            <span className="figovl-divider" />
            <button
              type="button"
              className="figovl-close"
              onClick={onClose}
              title="Fermer"
              aria-label="Fermer"
            >
              ✕
            </button>
          </div>
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
            src={imgUrl}
            alt={figure.caption || `Figure ${figure.id}`}
            style={{
              transform: `rotate(${rotation}deg) scale(${scale})`,
              transition: "transform 0.2s cubic-bezier(0.4, 0, 0.2, 1)",
            }}
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
