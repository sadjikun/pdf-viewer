import { useState } from "react";
import type { Figure } from "../../types";
import { figureUrl } from "../../api";
import "./Gallery.css";

interface Props {
  docId: string;
  figures: Figure[];
  onSelect: (index: number) => void;
  /** Déclenche le légendage IA (Florence-2) de toutes les figures. */
  onCaption?: () => Promise<void> | void;
}

export function Gallery({ docId, figures, onSelect, onCaption }: Props) {
  const [busy, setBusy] = useState(false);

  if (figures.length === 0) {
    return <p className="gallery-empty">Aucune figure détectée dans ce document.</p>;
  }

  const handleCaption = async () => {
    if (!onCaption || busy) return;
    setBusy(true);
    try {
      await onCaption();
    } finally {
      setBusy(false);
    }
  };

  const hasAi = figures.some((f) => f.caption_ai);

  return (
    <div className="gallery-wrap">
      {onCaption && (
        <button
          type="button"
          className="gallery-caption-btn"
          onClick={handleCaption}
          disabled={busy}
        >
          {busy ? "Légendage en cours…" : hasAi ? "Re-légender (IA)" : "Légender les figures (IA)"}
        </button>
      )}
      <ul className="gallery">
        {figures.map((f, i) => (
          <li key={f.id} className="gallery-item">
            <button
              type="button"
              className="gallery-tile"
              onClick={() => onSelect(i)}
              title={f.caption || `Figure ${i + 1}`}
            >
              <img
                className="gallery-thumb"
                src={figureUrl(docId, f.id)}
                alt={f.caption || `Figure ${i + 1}`}
                loading="lazy"
              />
              <div className="gallery-meta">
                <span className="gallery-idx">#{i + 1}</span>
                {f.page != null && <span className="gallery-page">p.{f.page}</span>}
              </div>
              {f.caption && <p className="gallery-caption">{f.caption}</p>}
              {f.caption_ai && (
                <p className="gallery-caption gallery-caption-ai">{f.caption_ai}</p>
              )}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
