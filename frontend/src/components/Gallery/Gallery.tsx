import type { Figure } from "../../types";
import { figureUrl } from "../../api";
import "./Gallery.css";

interface Props {
  docId: string;
  figures: Figure[];
  onSelect: (index: number) => void;
}

export function Gallery({ docId, figures, onSelect }: Props) {
  if (figures.length === 0) {
    return <p className="gallery-empty">Aucune figure détectée dans ce document.</p>;
  }
  return (
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
          </button>
        </li>
      ))}
    </ul>
  );
}
