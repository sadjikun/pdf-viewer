# INDEX — Catalogue mémoire

Mis à jour : 2026-06-04
Pages actives : 11

Wiki de connaissance projet, construit par MHDINGBI pour ses agents IA
(Codex, Antigravity, Gemini) et porté sur main/develop pour partage.

> **État de fraîcheur (2026-06-11)** — alignés sur la branche `develop` :
> `HANDOFF` (section 0), `cache-schema`, `architecture`, `LOG` (entrée du haut).
> **Directionnels** (cap projet, pas l'implémentation exacte) : `VISION`, `PRD`,
> `ROADMAP`, `decisions`. **Historiques branche v2** (référencent du code partiellement
> absent de develop : Reader câblé, de-embedding, fast path) : `fixes-registry`,
> `formulas`, sections 1-4 de `HANDOFF`. En cas de doute sur l'implémentation réelle,
> `cache-schema` + `architecture` font foi pour develop.

Flux **LECTURE** : INDEX.md → HANDOFF.md (section 0) → cache-schema/architecture → page spécifique
Flux **ÉCRITURE** : mettre à jour page → INDEX.md (si nouvelle) → LOG.md

---

## Références core (lire en premier)

| Page | Résumé |
|------|--------|
| [VISION.md](VISION.md) | **LIRE EN PREMIER** — Philosophie, personas, ce que le projet EST et N'EST PAS |
| [PRD.md](PRD.md) | Cahier des charges complet : features priorisées, contraintes, roadmap, hors-scope |
| [fixes-registry.md](fixes-registry.md) | FIX-001..074 — invariants critiques à ne jamais régresser (1597 l.) |
| [ROADMAP.md](ROADMAP.md) | Plan long terme (au-delà des phases actuelles) |
| [architecture.md](architecture.md) | Vue système, flux données, constantes, contrats entre couches |

## Backend

| Page | Résumé |
|------|--------|
| [cache-schema.md](cache-schema.md) | Layout `cache/{id}/`, spec complète `result.json` |
| [formulas.md](formulas.md) | CodeFormulaV2 + pix2tex/Texify fallback + rendu KaTeX frontend |

## Gestion projet

| Page | Résumé |
|------|--------|
| [HANDOFF.md](HANDOFF.md) | **LIRE EN PREMIER pour reprendre le travail** — résumé session, TDs ouverts, tâches restantes, pièges |
| [decisions.md](decisions.md) | ADR-001..007 : choix pypdfium2, Docling, cache SHA256, react-pdf, etc. |
| [LOG.md](LOG.md) | Journal chronologique des sessions |

---

## Non portés (restent sur la branche MHDINGBI)

| Page | Raison |
|------|--------|
| `phases.md` | Doublon de `BACKLOG.md` (le nôtre est à jour) |
| `technical-debt.md` | Doublon de `TECHNICAL_DEBT.md` (numérotation incompatible) |
| `frontend-app.md` | Décrit son App.tsx (câblé différemment du nôtre) |
| `frontend-reader.md` | Décrit son MarkdownReader (câblé différemment) |
| `backend-api.md` | En retard (15 endpoints vs nos 24) |
| `backend-pipeline.md` | Décrit son pipeline v2 (divergent) |
