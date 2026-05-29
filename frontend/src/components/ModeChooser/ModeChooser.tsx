import "./ModeChooser.css";

interface Props {
  current: "standard" | "ai";
  onChoose: (mode: "standard" | "ai") => void;
}

export function ModeChooser({ current, onChoose }: Props) {
  return (
    <div className="mode-chooser" role="dialog" aria-modal="true"
         aria-label="Choix du mode de lancement">
      <div className="mode-chooser__panel">
        <h1 className="mode-chooser__title">Comment veux-tu lancer&nbsp;?</h1>
        <p className="mode-chooser__sub">
          Tu pourras changer à tout moment depuis la barre du haut.
        </p>
        <div className="mode-chooser__cards">
          <button
            type="button"
            className={`mode-card${current === "standard" ? " is-preselected" : ""}`}
            onClick={() => onChoose("standard")}
            autoFocus={current === "standard"}
          >
            <span className="mode-card__icon">⚡</span>
            <span className="mode-card__name">Standard</span>
            <span className="mode-card__desc">
              Extraction rapide, sans IA. Idéal pour lire et annoter vite.
            </span>
          </button>
          <button
            type="button"
            className={`mode-card mode-card--ai${current === "ai" ? " is-preselected" : ""}`}
            onClick={() => onChoose("ai")}
            autoFocus={current === "ai"}
          >
            <span className="mode-card__icon">🤖</span>
            <span className="mode-card__name">Mode IA</span>
            <span className="mode-card__desc">
              Florence-2 (légendes de figures) + Texify (formules). Plus riche, plus lent.
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
