import { useMemo } from "react";
import type { TableItem } from "../../types";
import "./Tables.css";

interface Props {
  tables: TableItem[];
  onGotoPage: (page: number) => void;
}

function sanitizeTableHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.body
    .querySelectorAll("script, style, iframe, object, embed, link, meta")
    .forEach((el) => el.remove());

  doc.body.querySelectorAll("*").forEach((el) => {
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      const value = attr.value.trim().toLowerCase();
      if (name.startsWith("on") || name === "style") {
        el.removeAttribute(attr.name);
      }
      if ((name === "href" || name === "src" || name === "xlink:href") && value.startsWith("javascript:")) {
        el.removeAttribute(attr.name);
      }
    }
  });

  return doc.body.innerHTML;
}

/** Dimensions (lignes × colonnes) déduites du HTML de la table. */
function tableDims(html: string): { rows: number; cols: number } | null {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const rows = doc.querySelectorAll("tr");
  if (rows.length === 0) return null;
  let cols = 0;
  rows.forEach((r) => {
    cols = Math.max(cols, r.querySelectorAll("td, th").length);
  });
  return { rows: rows.length, cols };
}

export function Tables({ tables, onGotoPage }: Props) {
  const safeTables = useMemo(
    () =>
      tables.map((t) => {
        const html = t.html ? sanitizeTableHtml(t.html) : "";
        return { ...t, html, dims: html ? tableDims(html) : null };
      }),
    [tables],
  );

  if (tables.length === 0) {
    return (
      <div className="tables-empty">
        <p>Aucune table détectée.</p>
        <p className="tables-empty-hint">
          Les tables sont extraites par Docling (PDF natifs ou scannés retraités en mode complet).
        </p>
      </div>
    );
  }

  return (
    <div className="tables">
      {safeTables.map((t) => (
        <div key={t.id} className="tables-card">
          <div className="tables-header">
            <span className="tables-label">{t.caption || t.id}</span>
            {t.dims && (
              <span className="tables-dims">
                {t.dims.rows}×{t.dims.cols}
              </span>
            )}
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
