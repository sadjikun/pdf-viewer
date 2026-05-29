# PHASES — État d'avancement du projet

> Tracker vivant : [`../BACKLOG.md`](../BACKLOG.md)  
> Dernière MAJ : 2026-05-29

---

## Phase 0 — Cadrage et scaffolding ✅ TERMINÉE
Choix Docling + FastAPI + React/Vite. Structure `backend/` + `frontend/`. Python 3.13 venv.

## Phase 1 — POC backend ✅ TERMINÉE (2026-05-04)
- Endpoints `/process`, `/outline`, `/figure`, `/raw`, `/pdf`, `/markdown`
- Pipeline Docling → outline hiérarchique + figures + tables
- Robustesse (100 Mo max, header %PDF, try/except)

## Phase 2 — POC frontend ✅ TERMINÉE (2026-05-05)
- App shell 2 colonnes, upload zone, composant Outline (arbre récursif)
- Client API `api.ts`, PDF viewer react-pdf, sync clic outline → scroll

## Phase 3 — Sync bidirectionnelle + figures ✅ TERMINÉE (2026-05-05)
- `IntersectionObserver` scroll viewer → highlight outline
- Galerie figures (onglet sidebar), overlay HD, nav prev/next
- Mobile-friendly (drawer sidebar, hamburger, `100dvh`)

## Phase 4 — Polish + robustesse 🔄 EN COURS
| # | Tâche | Statut |
|---|-------|--------|
| 4.1 | Tables structurées (TableFormer) | ✅ Fait (FIX-028) |
| 4.2 | Recherche dans le PDF | ✅ Fait |
| 4.3 | Export markdown (endpoint + bouton) | ✅ Fait |
| 4.4 | Mode sombre | ✅ Fait (intégré Reader) |
| 4.5 | Virtualisation pages (performance) | ✅ Fait (FIX-029) |
| 4.6 | Tests unitaires backend (pytest) | ✅ Fait (16 tests pytest) |
| 4.7 | Doc utilisateur (README + requirements.txt) | ✅ Fait |

## Phase 5 — Reader "Interactive Book" 🔄 EN COURS
| # | Tâche | Statut |
|---|-------|--------|
| 5.1 | Export HTML Docling + endpoint `/html` | ✅ Fait |
| 5.2 | Refonte Reader (Source Serif 4, orange accent, dark mode) | ✅ Fait |
| 5.3 | Navigation focus mode (section isolée + prev/next) | ✅ Fait |
| 5.4 | Figures pleine résolution (`margin: -44px`, strip inline) | ✅ Fait |
| 5.5 | `formula-not-decoded` CSS + `LEAF_DIV_CLASSES` | ✅ Fait |
| 5.6 | Fix PDF viewer worker (CDN unpkg) | ✅ Fait |
| 5.7 | Fix nom de fichier (patch rétroactif `filename` result.json) | ✅ Fait |
| 5.8 | Rendu formules LaTeX (KaTeX auto-render) | ✅ Fait (KaTeX intégré) |
| 5.9 | Table of contents flottante dans Reader | ✅ Fait (mini-TOC unifiée) |
| F6.1 | Pages A4 encadrées (bande bureau 36px entre pages) | ✅ Fait (FIX-033) |
| F6.5 | Marges internes type document (--doc-px 72/40/20px responsive) | ✅ Fait (FIX-033) |
| F6.6 | Recherche Ctrl+F (Reader HTML) | ✅ Fait |
| F6.7 | Nettoyage automatique du cache (FIX-053) | ✅ Fait |
| F6.8 | Extraction de secours (Fallback chain) | ✅ Fait (FIX-054) |

---

## Phase 6 — Plateforme d'étude : Confiance (R11/R12) 🔄 EN COURS
> Première piste de la Phase 1 « Confiance » du `ROADMAP.md`. Voir
> `docs/superpowers/specs/2026-05-29-durable-notes-design.md` + `docs/superpowers/plans/2026-05-29-durable-notes.md`.

| # | Tâche | Statut |
|---|-------|--------|
| R11 | Notes & surlignages durables : stockage serveur `cache/{doc}/annotations.json`, migration `localStorage`, restauration section-scopée multi-nœuds | ✅ Fait (2026-05-29, FIX-072/073/074) |
| R12 | Export annotations → fiche de révision HTML/Markdown (`backend/fiche.py`, endpoint `/doc/{id}/fiche`, bouton Reader) | ✅ Fait (2026-05-29) |
| Q1 | Filet de sécurité tests : harnais pytest (`backend/conftest.py`, `backend/tests/`, 10 tests verts) | ✅ Partiel (zones R11/R12) |

---

## Phase 7 — Diffusion : launcher fenêtre (D1) 🔄 EN COURS
> ROADMAP D1. Voir `docs/superpowers/specs/2026-05-29-launcher-pywebview-design.md` + le plan associé + ADR-007.

| # | Tâche | Statut |
|---|-------|--------|
| D1a | Launcher fenêtre pywebview (splash → app), fermeture = quit, `launcher_core.py` testé (11 tests) | ✅ Fait (2026-05-29) |
| D1b | ModeChooser Standard/IA dans l'app (chaque lancement, dernier choix présélectionné) | ✅ Fait (2026-05-29) |
| D1c | Icône app (`assets/app.ico`) + WebView2 bundlé + `build.bat` PyInstaller | ✅ Fait (2026-05-29) |
| D1d | Build frontend statique servi par FastAPI (vrai standalone) | ⬜ À faire |

---

## Prochaines priorités

1. **Intégration continue & Déploiement** : Packaging de l'application pour des déploiements facilités.
2. **pix2tex** : valider pipeline formules complexes avec l'utilisateur (TD-012).
3. **Recherche Ctrl+F avancée** : Améliorer la recherche par pertinence sémantique dans le Reader HTML.

> Voir `memory/HANDOFF.md` pour le détail d'implémentation de chaque tâche.
