import { useEffect, useState } from "react";
import type { Figure } from "../../types";
import { captionFigures, figureUrl, getResult } from "../../api";
import "./Gallery.css";

interface Props {
  docId: string;
  figures: Figure[];
  onSelect: (index: number) => void;
}

export function Gallery({ docId, figures, onSelect }: Props) {
  const [running, setRunning] = useState(false);
  const [localFigures, setLocalFigures] = useState<Figure[]>(figures);

  // Sync from parent when a new document is loaded
  useEffect(() => { setLocalFigures(figures); }, [figures]);

  const hasAiCaptions = localFigures.some((f) => f.caption_ai);

  const handleCaptionAll = async () => {
    setRunning(true);
    try {
      await captionFigures(docId);
      const updated = await getResult(docId).catch(() => null);
      if (updated?.figures) setLocalFigures(updated.figures);
    } catch {
      // silently ignore — user can retry
    } finally {
      setRunning(false);
    }
  };

  if (localFigures.length === 0) {
    return <p className="gallery-empty">Aucune figure détectée dans ce document.</p>;
  }

  return (
    <div>
      {!hasAiCaptions && (
        <div className="gallery-ai-bar">
          <button
            type="button"
            className="gallery-ai-btn"
            onClick={handleCaptionAll}
            disabled={running}
            title="Génère une description textuelle pour chaque figure via Florence-2"
          >
            {running ? "Génération en cours…" : "Décrire les figures (IA)"}
          </button>
        </div>
      )}
      <ul className="gallery">
        {localFigures.map((f, i) => (
          <li key={f.id} className="gallery-item">
            <button
              type="button"
              className="gallery-tile"
              onClick={() => onSelect(i)}
              title={f.caption_ai || f.caption || `Figure ${i + 1}`}
            >
              <img
                className="gallery-thumb"
                src={figureUrl(docId, f.id)}
                alt={f.caption_ai || f.caption || `Figure ${i + 1}`}
                loading="lazy"
              />
              <div className="gallery-meta">
                <span className="gallery-idx">#{i + 1}</span>
                {f.page != null && <span className="gallery-page">p.{f.page}</span>}
              </div>
              {f.caption && <p className="gallery-caption">{f.caption}</p>}
              {f.caption_ai && (
                <p className="gallery-caption gallery-caption-ai">
                  <span className="gallery-ai-badge">IA</span>
                  {f.caption_ai}
                </p>
              )}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
