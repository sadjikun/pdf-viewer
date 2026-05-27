import { useRef, useState } from "react";
import "./UploadZone.css";

// Extensions acceptées côté frontend (miroir de MARKITDOWN_EXTENSIONS + .pdf)
const ACCEPT = [
  ".pdf",
  ".docx", ".pptx", ".xlsx", ".xls",
  ".html", ".htm", ".md", ".txt", ".csv",
  ".png", ".jpg", ".jpeg", ".gif", ".webp",
  ".ipynb",
].join(",");

interface Props {
  onFile: (file: File, fastMode: boolean) => void;
  disabled?: boolean;
}

export function UploadZone({ onFile, disabled }: Props) {
  const [hover, setHover] = useState(false);
  const [fastMode, setFastMode] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setHover(false);
    if (disabled) return;
    const file = e.dataTransfer.files?.[0];
    if (file) onFile(file, fastMode);
  };

  const handleSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) onFile(file, fastMode);
    e.target.value = "";
  };

  return (
    <div
      className={`upload${hover ? " is-hover" : ""}${disabled ? " is-disabled" : ""}`}
      onDragOver={(e) => { e.preventDefault(); if (!disabled) setHover(true); }}
      onDragLeave={() => setHover(false)}
      onDrop={handleDrop}
    >
      <p className="upload-title">Déposez un document ici</p>
      <p className="upload-sub">PDF · Word · PowerPoint · Excel · HTML · Image · Jupyter…</p>
      
      <div className="upload-fastmode-container">
        <label className="upload-fastmode-label" title="Extraction ultra rapide du texte brut en 1s. Décochez pour activer Docling et extraire les figures/tableaux.">
          <input
            type="checkbox"
            checked={fastMode}
            onChange={(e) => setFastMode(e.target.checked)}
            disabled={disabled}
          />
          <span>Extraction rapide (1s, recommandé)</span>
        </label>
      </div>

      <p className="upload-or">ou</p>
      <button
        type="button"
        className="upload-btn"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
      >
        Choisir un fichier…
      </button>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        hidden
        onChange={handleSelect}
      />
      <p className="upload-hint">
        Taille max : 100 Mo · PDF → Docling (figures + tables) · Autres → markitdown
      </p>
    </div>
  );
}
