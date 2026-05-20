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

export function Tables({ tables, onGotoPage }: Props) {
  const safeTables = useMemo(
    () => tables.map((t) => ({ ...t, html: t.html ? sanitizeTableHtml(t.html) : "" })),
    [tables],
  );

  if (tables.length === 0) {
    return <p className="tables-empty">Aucune table détectée.</p>;
  }

  return (
    <div className="tables">
      {safeTables.map((t) => (
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
