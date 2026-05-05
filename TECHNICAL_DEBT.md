# pdf-viewer — Dette technique

> Registre des ecarts spec/implementation, placeholders a remplacer, workarounds, limitations.

**Derniere MAJ** : 2026-05-05 (Phase 4 partielle : 4.2/4.3/4.7)

---

## Legende

- **Statut** : `OUVERT` | `EN COURS` | `RESOLU`
- **Gravite** : `BLOQUANT` | `ELEVEE` | `MOYENNE` | `FAIBLE`

---

## Dettes ouvertes

| ID | Date | Description | Gravite | Statut | Action |
|----|------|-------------|---------|--------|--------|
| TD-006 | 2026-05-04 | **Smoke test manuel uniquement** sur 1 PDF (`2510.04871v1.pdf`). Pas de pytest, pas de snapshot, pas de regression covered. | FAIBLE | OUVERT | Ajouter `pytest` en Phase 4.6 avec snapshots de `result.json` sur 3-5 PDFs samples (papers + scanne + technique). |
| TD-007 | 2026-05-04 | **Sur-detection SectionHeader Docling sur docs admin** : sur les CV, formulaires, courriers (DMT), Docling classe en SectionHeader des titres de blocs ou des fragments inline (ex: "Villa 14A Dakar", "40 heures"). Bruit visuel dans la sidebar outline mais pas de crash. | FAIBLE | OUVERT | Soit filtre cote pipeline (longueur min, ratio chiffres/caracteres alphabetiques, exclusion lignes < N caracteres), soit option cote frontend pour masquer les sections sans children/page suivante. A trancher si gene confirmee a l'usage. |
| TD-008 | 2026-05-05 | **Bundle JS frontend > 500 kB** : warning Vite a chaque build. `index.js` ~620 kB + `pdf.worker.mjs` ~1 Mo. Acceptable POC, charge initiale lente sur connexion mobile faible. | FAIBLE | OUVERT | Code-splitting dynamique via `import()` (charger `react-pdf` + worker uniquement quand un doc est selectionne). A faire en Phase 4.5 (perf). |

---

## Dettes resolues

| ID | Date resolution | Description courte | Resolution |
|----|-----------------|--------------------|------------|
| TD-001 | 2026-05-04 | Hierarchie outline plate (level=1 partout) | Parser `_level_depuis_titre` dans `pipeline.py` deduit le niveau du nombre de segments de la numerotation (`2.1.` → 2). Fallback `level` brut si pas de numerotation. Verifie sur arxiv 2510 et 2509.25140 (depth 2 atteinte). |
| TD-004 | 2026-05-04 | Pas de gestion d'erreur claire si Docling crash | `try/except` autour de `convertir_pdf` dans `main.py` → `HTTPException(422, "Echec extraction Docling : {type}: {msg}")` + `shutil.rmtree(ddir)` pour autoriser une retry. Verifie sur PDF corrompu. |
| TD-005 | 2026-05-04 | Pas de limite de taille upload | Constante `MAX_UPLOAD_BYTES = 100 * 1024 * 1024` dans `main.py` → HTTP 413 si depasse. + checks 400 (fichier vide, entete `%PDF` absent, extension non `.pdf`). Verifie avec faux PDF de 101 Mo. |
| TD-002 | 2026-05-05 | Convention bbox a documenter et eventuellement centraliser | Verification empirique sur le cache : Docling renvoie systematiquement `t > b` → BOTTOMLEFT confirme. Conversion centralisee **cote frontend** dans `frontend/src/bbox.ts` (helper `bboxToPct`). SPEC §4.2 conservee (API expose les bbox brutes). Backend non modifie. Markers figures dans `Viewer.tsx` consomment le helper. |
| TD-003 | 2026-05-05 | Modeles RapidOCR telecharges au premier run (~40 Mo) | `README.md` cree (section Installation backend) qui mentionne explicitement le telechargement automatique au 1er traitement de PDF. Pas de script de pre-fetch (overkill POC). Si packaging futur necessaire, voir options dans la doc Docling. |
