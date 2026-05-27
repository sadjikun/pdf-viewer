import { useEffect, useState } from "react";
import "./LoadingDocling.css";

const STAGES = [
  { until: 5, label: "Initialisation Docling…" },
  { until: 15, label: "Détection layout & OCR…" },
  { until: 40, label: "Extraction texte & figures…" },
  { until: 90, label: "Construction de la structure…" },
  { until: Infinity, label: "Toujours en cours — gros document ?" },
];

function fmt(s: number): string {
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
}

interface LoadingDoclingProps {
  progress?: number | null;
  message?: string;
}

export function LoadingDocling({ progress, message }: LoadingDoclingProps) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const hasProgress = progress !== null && progress !== undefined;
  const stageLabel = hasProgress && message 
    ? message 
    : STAGES.find((s) => elapsed < s.until)!.label;

  return (
    <div className="loading-docling">
      <div className="spinner" aria-hidden="true" />
      <p className="loading-stage">{stageLabel}</p>
      
      {hasProgress && (
        <div style={{ margin: "1rem auto", maxWidth: "320px" }}>
          <div className="loading-progress-outer">
            <div 
              className="loading-progress-inner" 
              style={{ width: `${Math.min(100, Math.max(0, progress))}%` }} 
            />
          </div>
          <span className="loading-progress-text">{progress}%</span>
        </div>
      )}

      <p className="loading-elapsed">
        Temps écoulé : <strong>{fmt(elapsed)}</strong>
      </p>
      <p className="loading-hint">
        Ordre de grandeur :
        <br />
        • PDF natif : 5 à 15s pour un document court, 15 à 45s pour un document de 20+ pages.
        <br />
        • PDF scanné / complexe (avec OCR) : ~3 à 5s par page (ex. 1 à 2 min pour 20 pages, 4 à 6 min pour 80+ pages).
        <br />
        Le 1<sup>er</sup> traitement après démarrage du backend prend ~10 à 15s de plus (chargement des modèles).
      </p>
    </div>
  );
}
