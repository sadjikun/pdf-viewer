import type { TableItem } from "../../types";
import "./Tables.css";

interface Props {
  tables: TableItem[];
  onGotoPage: (page: number) => void;
}

export function Tables({ tables, onGotoPage }: Props) {
  if (tables.length === 0) {
    return <p className="tables-empty">Aucune table détectée.</p>;
  }

  return (
    <div className="tables">
      {tables.map((t) => (
        <div key={t.id} className="tables-card">
          <div className="tables-header">
            <span className="tables-label">{t.caption || t.id}</span>
            {t.page != null && (
              <button
                type="button"
                className="tables-goto"
                onClick={() => onGotoPage(t.page!)}
              >
                p.{t.page}
              </button>
            )}
          </div>
          {t.html ? (
            <div
              className="tables-content"
              dangerouslySetInnerHTML={{ __html: t.html }}
            />
          ) : (
            <p className="tables-no-data">Données non disponibles</p>
          )}
        </div>
      ))}
    </div>
  );
}
