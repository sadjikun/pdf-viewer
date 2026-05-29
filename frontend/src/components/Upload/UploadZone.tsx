import { useRef, useState } from "react";
import "./UploadZone.css";

interface Props {
  onFile: (file: File) => void;
  disabled?: boolean;
}

export function UploadZone({ onFile, disabled }: Props) {
  const [hover, setHover] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setHover(false);
    if (disabled) return;
    const file = e.dataTransfer.files?.[0];
    if (file) onFile(file);
  };

  const handleSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) onFile(file);
    e.target.value = "";
  };

  return (
    <div
      className={`upload${hover ? " is-hover" : ""}${disabled ? " is-disabled" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setHover(true);
      }}
      onDragLeave={() => setHover(false)}
      onDrop={handleDrop}
    >
      <p className="upload-title">Déposez un document ici</p>
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
        accept=".pdf,.docx,.pptx,.xlsx,.xls,.html,.htm,.md,.txt,.csv,.ipynb,.png,.jpg,.jpeg,.gif,.bmp,.webp"
        hidden
        onChange={handleSelect}
      />
      <p className="upload-hint">
        PDF, Word, PowerPoint, Excel, HTML, images, notebooks… · Taille max : 100 Mo
        <br />
        Le 1<sup>er</sup> traitement prend quelques dizaines de secondes.
      </p>
    </div>
  );
}
