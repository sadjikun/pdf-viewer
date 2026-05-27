import type { Table } from "../../types";
import "./TablesPanel.css";

interface Props {
  tables: Table[];
  onGotoPage: (page: number) => void;
}

function sanitizeTableHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("script,style,iframe,object,embed,link,meta").forEach((el) => el.remove());
  doc.body.querySelectorAll("*").forEach((el) => {
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      const value = attr.value.trim().toLowerCase();
      if (name.startsWith("on") || value.startsWith("javascript:")) {
        el.removeAttribute(attr.name);
      }
    }
  });
  return doc.body.innerHTML;
}

export function TablesPanel({ tables, onGotoPage }: Props) {
  if (tables.length === 0) {
    return (
      <div className="tables-empty">
        <p>Aucune table extraite.</p>
        <p className="tables-empty-hint">
          Les tables sont extraites en mode Docling (PDFs scannés ou retraitement complet).
        </p>
      </div>
    );
  }

  return (
    <div className="tables-list">
      {tables.map((table) => (
        <div key={table.id} className="tables-item">
          <div className="tables-item-header">
            <span className="tables-item-meta">
              {table.n_rows}×{table.n_cols}
              {table.page != null && (
                <button
                  type="button"
                  className="tables-item-page"
                  onClick={() => table.page != null && onGotoPage(table.page)}
                  title={`Aller à la page ${table.page}`}
                >
                  p.{table.page}
                </button>
              )}
            </span>
            {table.caption && (
              <span className="tables-item-caption" title={table.caption}>
                {table.caption}
              </span>
            )}
          </div>
          {table.html ? (
            <div
              className="tables-item-html"
              dangerouslySetInnerHTML={{ __html: sanitizeTableHtml(table.html) }}
            />
          ) : (
            <p className="tables-item-nohtml">
              {table.n_rows} lignes × {table.n_cols} colonnes (aperçu HTML non disponible)
            </p>
          )}
        </div>
      ))}
    </div>
  );
}
