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

export function LoadingDocling() {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const stage = STAGES.find((s) => elapsed < s.until)!;

  return (
    <div className="loading-docling">
      <div className="spinner" aria-hidden="true" />
      <p className="loading-stage">{stage.label}</p>
      <p className="loading-elapsed">
        Temps écoulé : <strong>{fmt(elapsed)}</strong>
      </p>
      <p className="loading-hint">
        Ordre de grandeur : 5–30s pour un document court, 60–90s pour un paper de 20+ pages.
        <br />
        Le 1<sup>er</sup> traitement après démarrage du backend prend ~10s de plus (chargement modèles).
      </p>
    </div>
  );
}
