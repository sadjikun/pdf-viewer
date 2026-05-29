# PRD — Product Requirements Document
## pdf-viewer · v1.x

> Consulter avant toute décision d'implémentation significative.
> VISION.md = boussole 2 min. Ce fichier = référence complète.

---

## 1. Contexte & problème

Voir VISION.md pour la synthèse. En détail :

Les PDFs techniques présentent plusieurs obstacles à la lecture productive :
- **Scan/OCR** : beaucoup de vieux rapports sont des images scannées sans couche texte
- **Formules** : les éditeurs scientifiques embarquent des formules en tant qu'images
  ou en MathML/LaTeX — illisibles sans rendu spécifique
- **Mise en page complexe** : colonnes multiples, tableaux, figures légendées,
  numérotation de sections imbriquée
- **Lecture longue** : 80-300 pages → besoin de navigation rapide, d'annotations
  persistantes et de lecture audio

---

## 2. Principes de design (non négociables)

Ces principes gouvernent chaque décision d'implémentation. En cas de conflit entre
deux features, ces principes tranchent.

### P1 — Fidélité au document original
Le Reader HTML doit ressembler au PDF source, pas reformater arbitrairement le
contenu. Si Docling exporte un titre de niveau 2, il doit apparaître comme un titre
de niveau 2, à la taille et position approximatives du PDF.

**Implication** : ne pas imposer une typographie "blog" sur un document technique.
Les marges, l'espacement des titres, la taille des images doivent évoquer le PDF.

### P2 — Lisibilité enrichie
Le Reader ajoute ce que le PDF ne peut pas faire nativement :
surlignage persistant, notes adhésives, TTS, thèmes d'affichage, mode focus.
Ces fonctionnalités ne doivent jamais dégrader la lecture du contenu principal.

### P3 — Offline-first absolu
Zéro appel réseau externe (aucun CDN, aucune API cloud) sauf pour le chargement
initial des polices Google Fonts (acceptable car non critique).
Les données extraites restent dans `backend/cache/`.

### P4 — Robustesse progressive
Un PDF qui échoue partiellement doit toujours afficher quelque chose d'utile
(dégradation gracieuse). Un crash total n'est jamais acceptable.

### P5 — Simplicité d'usage
Interface sans mode d'emploi. Un utilisateur qui ouvre l'app pour la première fois
doit pouvoir uploader un PDF et le lire en < 30 secondes.

---

## 3. Features — Statut & Priorité

### Légende priorité
- **M** : Must (core — sans ça l'appli est inutile)
- **S** : Should (important — présent dans la v1)
- **C** : Could (nice-to-have — v1.x ou v2)
- **W** : Won't (explicitement hors scope)

---

### 3.1 Extraction & pipeline

| ID | Feature | Priorité | Statut |
|----|---------|----------|--------|
| E1 | Upload PDF → extraction texte natif via pypdfium2 (fast path) | M | ✅ Livré |
| E2 | Upload PDF scanné → OCR via Docling + RapidOCR | M | ✅ Livré |
| E3 | Extraction sommaire (TOC) — natif ou via détection de pattern | M | ✅ Livré |
| E4 | Extraction figures avec légendes et coordonnées bbox | M | ✅ Livré |
| E5 | Extraction tableaux en HTML | M | ✅ Livré |
| E6 | Export HTML sémantique Docling avec séparateurs de pages | M | ✅ Livré |
| E7 | Support JPEG2000 et ICC invalides (rastérisation fallback) | M | ✅ Livré |
| E8 | Reconnaissance formules LaTeX (pix2tex fallback) | S | ✅ Livré — pix2tex 0.1.4 installé, PIX2TEX_FALLBACK=1, FIX-044 |
| E9 | Support .md, .docx, .pptx via markitdown | C | ✅ Livré |
| E10 | PDF OCR avec couche texte embarquée (OCRmyPDF) | C | ✅ Livré |

---

### 3.2 Interface — Modes d'affichage

| ID | Feature | Priorité | Statut |
|----|---------|----------|--------|
| V1 | Mode PDF : rendu natif via PDF.js (react-pdf) | M | ✅ Livré |
| V2 | Mode Reader : HTML Docling avec navigation sections | M | ✅ Livré |
| V3 | Mode Compare : PDF (gauche) + Reader (droite) synchronisés | S | ✅ Livré |
| V4 | Divider Compare redimensionnable | S | ✅ Livré (FIX-017) |
| V5 | Synchronisation scroll PDF ↔ Reader via sommaire | S | ✅ Livré |
| **V6** | **Reader : rendu fidèle à la mise en page du PDF** | **M** | **🔄 En cours** |
| V7 | Zoom PDF (react-pdf natif) | M | ✅ Livré |

---

### 3.3 Reader — Fidélité visuelle (détail V6)

*Ceci est le sujet central des itérations actuelles.*

| ID | Sous-feature | Priorité | Statut |
|----|-------------|----------|--------|
| F6.1 | Pages A4 encadrées (blanc + ombre = rendu papier) | M | ✅ Livré — carte blanche + ombre + bureau gris visible 20px |
| F6.2 | En-têtes de page avec nom du document + numéro | M | ✅ Livré (FIX-022) |
| F6.3 | Pieds de page avec numéro | M | ✅ Livré (FIX-022) |
| F6.4 | Suppression rasters pleine-page (espaces blancs) | M | ✅ Livré (FIX-022/023) |
| F6.5 | Marges internes type document (2-2.5 cm) | S | ✅ Livré — --doc-px:72px bureau, 40px tablette, 16px mobile |
| F6.6 | Police proche du PDF (sans-serif document-like) | S | ✅ Livré — défaut Calibri/Segoe, bouton "Document" dans typographie |
| F6.7 | Images à taille proportionnelle (pas full-width systématique) | S | ✅ Livré (FIX-032) |
| F6.8 | Préservation des layouts 2 colonnes | C | ❌ Non livré (complexité ML) |
| F6.9 | Correspondance exacte de position des éléments | W | Techniquement impossible avec HTML sémantique |

---

### 3.4 Reader — Fonctionnalités enrichies

| ID | Feature | Priorité | Statut |
|----|---------|----------|--------|
| R1 | Surlignage multi-couleurs persistant (localStorage) | M | ✅ Livré |
| R2 | Notes adhésives sur surlignage | M | ✅ Livré |
| R3 | Export HTML autonome annoté (KaTeX embarqué) | S | ✅ Livré |
| R4 | Text-to-Speech français vitesse réglable | S | ✅ Livré |
| R5 | Mode focus section (masque le reste) | S | ✅ Livré |
| R6 | Navigation page par page (scroll-snap) | S | ✅ Livré (FIX-016) |
| R7 | Rendu LaTeX/KaTeX inline et display | M | ✅ Livré |
| R8 | Changement de police (serif/sans) et taille | S | ✅ Livré |
| R9 | Barre de progression lecture | C | ✅ Livré |
| R10 | Mode Markdown brut (fallback) | C | ✅ Livré |

---

### 3.5 Sidebar & Navigation

| ID | Feature | Priorité | Statut |
|----|---------|----------|--------|
| N1 | Sommaire hiérarchique cliquable avec numéros de pages | M | ✅ Livré |
| N2 | Galerie figures avec vignettes et lightbox | S | ✅ Livré |
| N3 | Panneau tableaux avec navigation vers page | S | ✅ Livré |
| N4 | Barre de recherche dans le document | S | ✅ Livré |
| N5 | Sidebar redimensionnable | S | ✅ Livré |
| N6 | Hamburger desktop (plier/déplier sidebar) | S | ✅ Livré (FIX-019) |

---

### 3.6 Thèmes & accessibilité

| ID | Feature | Priorité | Statut |
|----|---------|----------|--------|
| T1 | Thème CSTB (défaut) — orange, blanc cassé | M | ✅ Livré (FIX-020) |
| T2 | 6 thèmes visuels (Glass, Clair, Tech, Sépia, OLED, Forêt) | S | ✅ Livré |
| T3 | Mode sombre global synchronisé | S | ✅ Livré (FIX-020) |
| T4 | Polices : Outfit (UI) + Lora/Serif (corps) + JetBrains Mono | S | ✅ Livré |

---

### 3.7 Plateforme d'étude — nouvelle direction

> Cap formalisé le 2026-05-29 (**ADR-006**). Séquençage en 3 phases dans **`ROADMAP.md`** :
> Confiance → Intelligence → Diffusion. Le socle offline-first / mono-utilisateur / sans cloud est conservé.

#### Phase 1 — Confiance (durabilité & organisation)

| ID | Feature | Priorité | Statut |
|----|---------|----------|--------|
| R11 | Notes & surlignages durables — stockage serveur (`cache/{doc}/annotations.json`), *supersede ADR-003* | M | ⬜ Planifié |
| R12 | Export des annotations en fiche de révision (HTML/Markdown) | S | ⬜ Planifié |
| L1 | Organisation bibliothèque : dossiers / matières / tags + filtrage | M | ⬜ Planifié |
| L2 | Métadonnées d'étude (matière, statut à lire/en cours/lu, priorité) | S | ⬜ Planifié |
| Q1 | Filet de sécurité tests (smoke + zones touchées par R11/L1) | M | ⬜ Planifié |
| Q2 | Tests de non-régression ciblés (1 par FIX critique, progressif) | C | ⬜ Planifié |

#### Phase 2 — Intelligence (IA locale)

| ID | Feature | Priorité | Statut |
|----|---------|----------|--------|
| AI1 | Recherche plein-texte transversale (toute la bibliothèque) | M | ⬜ Planifié |
| AI2 | Q&A IA locale « interroge tes documents » — réponse sourcée avec n° de page, hors-ligne | M | ⬜ Planifié |
| AI3 | Résumés / fiches de révision auto depuis les surlignages | C | ⬜ Planifié |

#### Phase 3 — Diffusion (packaging)

| ID | Feature | Priorité | Statut |
|----|---------|----------|--------|
| D1 | Installateur one-click (pywebview + PyInstaller, frontend statique servi par FastAPI) | S | 🔄 En cours (launcher) |
| D2 | Stratégie modèles ML (bundle vs téléchargement au 1er lancement) | S | ⬜ Planifié |

---

## 4. Architecture cible (v1.x)

```
POST /process  ← upload PDF
  └→ pipeline.py
       ├─ has_native_text() → fast path (pypdfium2) OU docling path
       ├─ _annotate_split_page_divs() → marqueurs pages dans HTML
       ├─ _strip_page_headers_footers()
       ├─ _fix_bullet_lists(), _fix_toc_entries()
       └─ result.json + html + md → backend/cache/{sha256[:16]}/

React Frontend
  ├─ App.tsx      → shell (sidebar, mode switching, compare)
  ├─ Viewer       → PDF.js (react-pdf)
  └─ MarkdownReader
       ├─ sectionizeHtml()  → HTML → sections + marqueurs visuels
       ├─ Highlights/Notes  → localStorage
       └─ TTS               → Web Speech API
```

---

## 5. Contraintes non-fonctionnelles

| Contrainte | Valeur cible |
|-----------|-------------|
| Temps chargement PDF natif | < 3 s (50 pages) |
| Temps OCR scan Docling | < 120 s (80 pages) |
| Mémoire backend (uvicorn) | < 2 GB crête |
| Navigateur supporté | Chrome 120+, Edge 120+ (Windows) |
| OS | Windows 10/11 (machine de l'utilisateur) |
| Réseau externe | Aucun (sauf Google Fonts au premier chargement) |
| Données stockées | `backend/cache/` uniquement, aucune BDD |

---

## 6. Hors scope (Won't build)

- Authentification, comptes utilisateurs
- Synchronisation cloud ou réseau local
- Édition/annotation du PDF natif (écriture dans le PDF)
- Traduction *cloud* — *(une traduction **locale** via LLM est à réévaluer, voir §9)*
- Collaboration multi-utilisateurs
- GED d'entreprise (workflows, versioning, conformité) — la centralisation sert l'étude personnelle
- Impression fidèle pixel-perfect du Reader
- Support mobile (app iOS/Android)
- Plugins navigateur
- Layout 2 colonnes exact (limite du pipeline Docling sémantique)
- Positionnement exact des éléments HTML calqué sur le PDF (impossible sans coordonnées)

---

## 7. Roadmap priorisée

> **La roadmap forward de référence est désormais `ROADMAP.md`**
> (3 phases : Confiance → Intelligence → Diffusion — ADR-006).

- **Phase 1 — Confiance :** notes durables (R11), export annotations (R12),
  organisation bibliothèque (L1/L2), filet de sécurité tests (Q1/Q2).
- **Phase 2 — Intelligence :** recherche transversale (AI1), Q&A IA locale sourcée (AI2),
  fiches de révision auto (AI3).
- **Phase 3 — Diffusion :** installateur one-click (D1), stratégie modèles ML (D2).

### Historique (livré)
- ✅ Fidélité visuelle Reader (F6.x) — pages A4, en-têtes/pieds, police document, images proportionnelles
- ✅ Recherche Ctrl+F interne Reader · pix2tex installé · nettoyage cache auto · fallback chain
- ✅ Choix du mode Standard/IA dans l'interface · vignettes première page · retraitement respecte le mode

---

## 8. Décisions architecturales clés (résumé)

| Décision | Raison |
|---------|--------|
| Docling pour HTML sémantique | Meilleure extraction structure vs pdfminer |
| split_page_view=True | Permet les séparateurs de pages dans le Reader |
| ImageRefMode.EMBEDDED | Figures en base64 dans le HTML (offline) |
| pypdfium2 fast path | ~1s vs 25-80s pour Docling sur PDFs natifs |
| localStorage pour notes/HL | Pas de BDD, offline-first |
| React + Vite | Stack moderne, HMR rapide pour développement |

---

## 9. Questions ouvertes

| Question | Décision attendue |
|---------|-----------------|
| F6.8 : layout 2 colonnes | Nécessite une extension Docling ou post-traitement bbox — décider si on investit |
| Cache invalidation | Quand forcer un retraitement auto vs manuel ? |
| **Modèle LLM local (AI2)** | Quel modèle ? Arbitrage taille / qualité / RAM (< 2 GB crête). Ollama vs llama.cpp |
| **Techno d'index (AI1/AI2)** | SQLite FTS5 (plein-texte) et/ou vector store local (sqlite-vec / FAISS) pour le sémantique |
| **Traduction locale** | Réévaluer : FR↔EN hors-ligne via LLM local, désormais faisable sans cloud |
| **Stockage annotations (R11)** | Format JSON par doc dans `cache/` + migration depuis localStorage |
