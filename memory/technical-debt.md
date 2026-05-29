# TECHNICAL DEBT — Dettes techniques

Dernière mise à jour : 2026-05-25

Format : `TD-NNN | Priorité | Statut | Description`  
Priorité : 🔴 Haute / 🟡 Moyenne / 🟢 Basse

---

## Ouverts

| ID | Priorité | Zone | Description |
|----|----------|------|-------------|
| TD-006 | ✅ 2026-05-25 | Backend | **Tests pytest** — `test_pipeline_unit.py` créé : 15 tests (15/15 pass) couvrant attributs module-level, `_est_titre_section`, `_apply_combined_passes`, `PIPELINE_VERSION`. |
| TD-007 | ✅ 2026-05-23 | Backend | **Sur-détection sections** — Résolu par FIX-030 : filtre post-extraction sur docs ≤ 3 pages, garde uniquement les sections numérotées et les annexes. |
| TD-008 | ✅ 2026-05-23 | Frontend | **Virtualisation pages react-pdf** — Résolu par FIX-029 : `position:absolute` + fenêtre ±5 pages + scroll handler + cumulative heights. |
| TD-009 | ✅ 2026-05-25 | Backend | **Surveillance RAM** — `_log_memory()` helper psutil loggue RSS au démarrage du pipeline, après Docling batches, et en fin de traitement. |
| TD-010 | ✅ 2026-05-25 | Frontend | **Mini-TOC flottante** — panneau `position:fixed` droite avec états `showMiniToc`/`activeSid`, bouton toolbar, surlignage section active au scroll. |
| TD-011 | ✅ 2026-05-23 | Frontend | **Tables structurées** — Résolu par FIX-028 : strip image-tables, wrap `.table-wrap`, promotion `<thead>` automatique. |
| TD-012 | ✅ 2026-05-24 | Backend | **pix2tex installé** (v0.1.4). `PIX2TEX_FALLBACK=1` par défaut dans pipeline.py. `_convert_figure_formulas()` branché avant `_deembed_images`. Le modèle LatexOCR se télécharge automatiquement (~400 MB) au premier traitement d'une formule. |
| TD-013 | ✅ 2026-05-25 | Backend | **Version pipeline** — `PIPELINE_VERSION = "2026-05-25"` dans pipeline.py, inclus dans result.json. `_load_result()` de main.py injecte `needs_reprocess` pour détection cache obsolète. |

---

## Résolus

| ID | Date résolution | Description |
|----|----------------|-------------|
| TD-001 | 2026-05-04 | Hiérarchie outline reconstruite depuis numérotation |
| TD-002 | 2026-05-05 | Convention bbox normalisée (points PDF 0,0 en haut gauche) |
| TD-003 | — | (non documenté) |
| TD-004 | 2026-05-04 | Robustesse /process (check %PDF, try/except, nettoyage cache partiel) |
| TD-005 | 2026-05-04 | Limite 100 Mo appliquée |

---

## Ajouter une nouvelle dette

```markdown
| TD-NNN | 🟡 | Zone | Description courte. Détail si nécessaire. |
```

Incrémenter depuis le dernier numéro. Marquer résolu avec date quand corrigé.
