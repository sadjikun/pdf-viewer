import "./SearchBar.css";

interface Props {
  value: string;
  onChange: (value: string) => void;
}

export function SearchBar({ value, onChange }: Props) {
  return (
    <div className="search">
      <input
        type="search"
        className="search-input"
        placeholder="Rechercher dans le PDF…"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {value && (
        <button
          type="button"
          className="search-clear"
          aria-label="Effacer"
          onClick={() => onChange("")}
        >
          ✕
        </button>
      )}
    </div>
  );
}
