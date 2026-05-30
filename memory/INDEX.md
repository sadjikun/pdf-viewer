# INDEX — Catalogue mémoire

Mis à jour : 2026-05-29  
Pages actives : 15

Flux **LECTURE** : INDEX.md → LOG.md (top 10) → fixes-registry.md → page spécifique  
Flux **ÉCRITURE** : mettre à jour page → INDEX.md (si nouvelle) → LOG.md

---

## Références core (lire en premier)

| Page | Résumé |
|------|--------|
| [VISION.md](VISION.md) | **LIRE EN PREMIER** — Philosophie, personas, ce que le projet EST et N'EST PAS |
| [PRD.md](PRD.md) | Cahier des charges complet : features priorisées, contraintes, roadmap, hors-scope |
| [fixes-registry.md](fixes-registry.md) | FIX-001..074 — invariants critiques à ne jamais régresser |
| [phases.md](phases.md) | Phases 0-5, statuts, travaux en cours, lien BACKLOG.md |
| [architecture.md](architecture.md) | Vue système, flux données, constantes, contrats entre couches |

## Backend

| Page | Résumé |
|------|--------|
| [backend-api.md](backend-api.md) | 15 endpoints : route, params, réponse, codes erreur |
| [backend-pipeline.md](backend-pipeline.md) | Fast path pypdfium2 vs Docling, OCR, batchs, filtres figures |
| [cache-schema.md](cache-schema.md) | Layout `cache/{id}/`, spec complète `result.json` |
| [formulas.md](formulas.md) | CodeFormulaV2 + pix2tex fallback + rendu KaTeX frontend |

## Frontend

| Page | Résumé |
|------|--------|
| [frontend-app.md](frontend-app.md) | App.tsx : 3 modes vue, onglets sidebar, state, refs viewerRef/readerRef |
| [frontend-reader.md](frontend-reader.md) | MarkdownReader : sectionizeHtml, forwardRef/ReaderHandle, focus mode |

## Gestion projet

| Page | Résumé |
|------|--------|
| [HANDOFF.md](HANDOFF.md) | **LIRE EN PREMIER pour reprendre le travail** — résumé session, TDs ouverts, tâches restantes classées, pièges connus |
| [technical-debt.md](technical-debt.md) | TD ouverts (perf, tests, virtualisation) avec priorité |
| [decisions.md](decisions.md) | ADR-001..005 : choix pypdfium2, Docling, cache SHA256, react-pdf |

---

## Fichiers archivés (référence historique seulement)

| Fichier | Statut |
|---------|--------|
| [FIXES.md](../docs/archive/FIXES.md) | SUPERSEDED → lire `fixes-registry.md` |
| [BACKLOG.md](../docs/archive/BACKLOG.md) | Tracker vivant → vue résumée dans `phases.md` |
| [IMPLEMENTATION.md](../docs/archive/IMPLEMENTATION.md) | ARCHIVE — journal historique, ne pas modifier |
| [gemini_implementation.md](../docs/archive/gemini_implementation.md) | EXPÉRIMENTAL pix2tex — état actuel dans `formulas.md` |
