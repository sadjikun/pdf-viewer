import { useEffect, useRef } from "react";
import "./SearchBar.css";

interface Props {
  value: string;
  onChange: (value: string) => void;
  matchIndex: number;
  matchTotal: number;
  onPrev: () => void;
  onNext: () => void;
}

export function SearchBar({
  value,
  onChange,
  matchIndex,
  matchTotal,
  onPrev,
  onNext,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "f") {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (e.shiftKey) onPrev();
      else onNext();
    }
    if (e.key === "Escape") {
      onChange("");
      inputRef.current?.blur();
    }
  };

  return (
    <div className="search">
      <input
        ref={inputRef}
        type="search"
        className="search-input"
        placeholder="Rechercher dans le PDF…"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
      />
      {value && (
        <div className="search-controls">
          <span className="search-count">
            {matchTotal > 0 ? `${matchIndex + 1}/${matchTotal}` : "0"}
          </span>
          <button
            type="button"
            className="search-nav"
            aria-label="Résultat précédent"
            onClick={onPrev}
            disabled={matchTotal === 0}
          >
            ▲
          </button>
          <button
            type="button"
            className="search-nav"
            aria-label="Résultat suivant"
            onClick={onNext}
            disabled={matchTotal === 0}
          >
            ▼
          </button>
          <button
            type="button"
            className="search-clear"
            aria-label="Effacer"
            onClick={() => onChange("")}
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
}
