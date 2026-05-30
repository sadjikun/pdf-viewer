# Benchmark : pdf-viewer vs OmniParse

> **Date :** 2026-05-27  
> **Scope :** Comparaison des capacités d'extraction documentaire, performance, et opportunités d'intégration.

---

## 1. Vue d'ensemble des deux outils

| Dimension | **pdf-viewer** (ce projet) | **OmniParse** ([github](https://github.com/adithya-s-k/omniparse)) |
|-----------|---------------------------|-------------------------------------------------------------------|
| Objectif principal | Viewer PDF interactif — lecture structurée, navigation, recherche | Ingestion universelle de données → Markdown structuré pour LLM |
| Moteur PDF | Docling 2.92 + pypdfium2 (fast path) | Marker (Surya OCR + Texify) |
| GPU requis | **Non** — CPU uniquement | **Oui** — 8–10 Go VRAM minimum (T4 GPU) |
| Hébergement | Local self-hosted (mono-user) | Local self-hosted ou cloud |
| Formats d'entrée | PDF, DOCX, PPTX, XLSX, HTML, MD, CSV, images, Jupyter | PDF, DOCX, PPT, images, audio, vidéo, URLs web (~20 formats) |
| Formats exclusifs OmniParse | — | Audio (MP3/WAV/AAC), Vidéo (MP4/MKV/AVI), URLs web |
| Interface utilisateur | ✅ React 19 — viewer, reader, compare, outline, galerie, tables | ❌ API REST uniquement (pas d'interface) |
| Mode opérateur | Interactif (humain lit le document) | Batch/pipeline (ingestion pour LLM/RAG) |

---

## 2. Benchmark de performance — extraction PDF

Ces chiffres sont issus de benchmarks publics (opendataloader-bench, 200 PDFs réels, CPU/GPU mixte) et de mesures internes.

### 2a. Qualité d'extraction (opendataloader-bench, score 0–1)

| Outil | Score global | Ordre de lecture (NID) | Tables (TEDS) | Titres (MHS) | GPU requis |
|-------|:-----------:|:---------------------:|:------------:|:------------:|:----------:|
| **Docling** (notre pipeline) | **0.877** | **0.900** | **0.887** | 0.802 | Non |
| Marker (base d'OmniParse) | 0.861 | 0.890 | 0.808 | 0.796 | Recommandé |
| pdfmux | 0.905 | 0.920 | 0.911 | **0.852** | Non |
| PyMuPDF seul | ~0.80 | ~0.82 | ❌ | ~0.70 | Non |

> Source : [pdfmux benchmark blog](https://pdfmux.com/blog/pdfmux-vs-pymupdf-vs-marker-vs-docling/)

**Résultat :** Docling surpasse Marker sur tables (+7,9 TEDS) et lecture globale (+1,6 pts) **sans GPU**. OmniParse hérite des limites de Marker.

### 2b. Vitesse d'extraction (CPU, documents réels)

| Outil / Mode | 1 page | 6 pages | 50 pages | GPU accélération |
|--------------|:------:|:-------:|:--------:|:----------------:|
| **Fast path** (pypdfium2) | **~10 ms** | **~60 ms** | **~0.5 s** | Non |
| **Docling** (notre pipeline) | ~1–3 s | ~6–8 s | ~65 s | Optionnel (+30–50%) |
| Marker / OmniParse CPU | ~5–20 s | ~30–60 s | ~300–600 s | Requis pour être raisonnable |
| Marker / OmniParse GPU (T4) | ~0.3 s | ~1 s | ~8 s | Oui (8–10 Go VRAM) |

> Sources : [Procycons benchmark](https://procycons.com/en/blogs/pdf-data-extraction-benchmark/), [Applied AI PDF benchmark](https://www.applied-ai.com/briefings/pdf-parsing-benchmark/)

**Résultat critique :** Sur CPU (notre cas d'usage), Marker/OmniParse est **5 à 10× plus lent** que Docling. Notre fast path (pypdfium2) est **300× plus rapide** pour les PDFs natifs.

### 2c. Extraction de tableaux (detail)

| Outil | Tableaux simples | Tableaux complexes (hiérarchiques) | Export |
|-------|:----------------:|:----------------------------------:|:------:|
| **Docling** | **97.9% précision cellules** | **97.9%** | HTML natif |
| Marker / OmniParse | ~100% simples | ~75–80% complexes | Markdown |
| pdfplumber | ~100% simples | ~60% complexes | CSV/liste |

> Source : [Procycons benchmark](https://procycons.com/en/blogs/pdf-data-extraction-benchmark/)

**Résultat :** Docling est supérieur sur les tableaux complexes et exporte en HTML (directement exploitable dans notre TablesPanel). OmniParse exporte en Markdown Markdown (perte de structure pour tableaux fusionnés).

### 2d. Formules mathématiques

| Outil | Moteur LaTeX | Précision | Limites connues |
|-------|:------------:|:---------:|:----------------|
| **pdf-viewer** (Docling + pix2tex) | RapidOCR + pix2tex | Bonne sur formules isolées | pix2tex lent (~2s/fig), pas pour inline |
| OmniParse | Texify (Surya) | Partielle | README : "will not convert 100% of equations" |
| Marker `--use_llm` | GPT-4 Vision | Haute | Payant, cloud requis |

> Source : [arXiv:2512.09874 — Benchmarking PDF Parsers on Math](https://arxiv.org/abs/2512.09874)

---

## 3. Comparaison fonctionnelle détaillée

### 3a. Ce que pdf-viewer fait et OmniParse ne fait pas

| Fonctionnalité | pdf-viewer | OmniParse |
|----------------|:----------:|:---------:|
| Interface de lecture interactive | ✅ | ❌ |
| 3 modes de vue (PDF / Reader / Compare) | ✅ | ❌ |
| Synchronisation scroll outline ↔ viewer | ✅ | ❌ |
| Reader Markdown avec KaTeX en temps réel | ✅ | ❌ |
| Galerie de figures cliquable (lightbox) | ✅ | ❌ |
| Tables rendues HTML avec lien page | ✅ | ❌ |
| OCR Tesseract → PDF cherchable | ✅ | ❌ |
| Fast path 1s pour PDFs natifs | ✅ | ❌ |
| 10 thèmes UI personnalisables | ✅ | ❌ |
| Bibliothèque de documents (historique) | ✅ | ❌ |
| Mode compare PDF/Reader côte à côte | ✅ | ❌ |
| Fonctionne sans GPU | ✅ | ❌ (8–10 Go VRAM) |
| Fonctionne sur Windows natif | ✅ | ⚠️ (problèmes rapportés) |

### 3b. Ce qu'OmniParse fait et pdf-viewer ne fait pas

| Fonctionnalité | OmniParse | pdf-viewer |
|----------------|:---------:|:----------:|
| Transcription audio (Whisper Small) | ✅ | ❌ |
| Transcription vidéo | ✅ | ❌ |
| Crawling de pages web (Selenium) | ✅ | ❌ |
| Captioning d'images (Florence-2) | ✅ | ❌ (pix2tex seulement) |
| Parsing HEIC, BMP, TIFF | ✅ | ❌ |
| Sortie optimisée pour RAG/LLM | ✅ | Partiel |
| API endpoint unique `/parse_document` | ✅ | Multiple endpoints |

### 3c. Ce que les deux font

| Fonctionnalité | pdf-viewer | OmniParse |
|----------------|:----------:|:---------:|
| PDF → Markdown | ✅ Docling | ✅ Marker |
| Extraction de tableaux | ✅ HTML | ✅ Markdown |
| Extraction de figures | ✅ PNG + LaTeX | ✅ PNG + caption |
| OCR sur PDFs scannés | ✅ RapidOCR | ✅ Surya OCR |
| DOCX, PPTX, XLSX | ✅ MarkItDown | ✅ Marker |
| Images (PNG/JPG) | ✅ MarkItDown | ✅ Florence-2 |
| Jupyter notebooks | ✅ MarkItDown | ❌ |
| Self-hosted / local | ✅ | ✅ |
| Cache disque | ✅ sha256 | ❌ (stateless) |

---

## 4. Analyse des limitations d'OmniParse

Issues documentées dans le repo OmniParse :

| Limitation | Impact | Statut |
|-----------|--------|--------|
| Requires 8–10 GB VRAM GPU | Bloquant sur machines sans GPU | Pas de roadmap CPU |
| Tables pas toujours correctement formatées | Perte de structure dans le Markdown | Connu, pas résolu |
| OCR "optimisé pour la vitesse" — imprécis | Erreurs sur scannés complexes | Par design |
| Support non-anglais limité | Usage professionnel FR/CN difficile | Reconnu dans README |
| Migration Marker → Docling ouverte (issue #109) | Le moteur principal est moins bon que Docling | En discussion, non implémenté |
| 100% des équations non converties en LaTeX | Math partielle | Reconnu dans README |
| Pas de cache — chaque requête re-traite | Coût CPU/GPU élevé en production | Pas de roadmap |

---

## 5. Opportunités d'intégration dans notre workflow

OmniParse n'est pas un concurrent direct — c'est un outil complémentaire. Voici les pistes concrètes pour enrichir pdf-viewer :

### 5a. Florence-2 pour le captioning de figures ⭐ Haute valeur

**Problème actuel :** pix2tex ne gère que les formules mathématiques. Les figures non-mathématiques (graphiques, schémas, photos) n'ont pas de description textuelle dans notre pipeline.

**Ce qu'OmniParse fait :** Florence-2 génère une légende textuelle pour toute image (ex. : "Diagramme de flux montrant le processus d'authentification").

**Comment l'intégrer :**
```python
# pipeline.py — après extraction figure
from transformers import AutoProcessor, AutoModelForCausalLM

def caption_figure(img_path: Path) -> str:
    model = AutoModelForCausalLM.from_pretrained("microsoft/Florence-2-base")
    processor = AutoProcessor.from_pretrained("microsoft/Florence-2-base")
    # ... génère caption automatique
```

**Bénéfice :** La galerie de figures afficherait des descriptions générées automatiquement, utilisables pour la recherche sémantique dans les figures.

---

### 5b. Whisper pour les PDFs de conférences/présentations ⭐ Valeur moyenne

**Problème actuel :** Les PDFs de slides de conférences référencent souvent des enregistrements audio/vidéo. Ces ressources sont ignorées.

**Ce qu'OmniParse fait :** Whisper Small transcrit audio et vidéo en texte.

**Comment l'intégrer :** Ajouter un endpoint `POST /doc/{id}/transcribe` qui accepte un fichier audio/vidéo et enrichit le `result.json` avec la transcription.

**Bénéfice :** Permettrait d'indexer et chercher dans le contenu audio d'un cours ou d'une conférence dont on a les slides.

---

### 5c. Web crawling pour les références de documents ⭐ Valeur moyenne

**Problème actuel :** Les PDFs contiennent des liens vers des pages web (normes, articles cités). Ces ressources sont ignorées.

**Ce qu'OmniParse fait :** Selenium crawle les pages web et retourne leur contenu en Markdown.

**Comment l'intégrer :**
```python
# Nouveau endpoint
POST /doc/{id}/fetch-reference
Body: {"url": "https://..."}
Returns: {"markdown": "...", "title": "..."}
```

**Bénéfice :** Depuis la galerie ou le Reader, clic sur une URL → contenu importé dans la bibliothèque.

---

### 5d. Surya OCR comme alternative à RapidOCR ⭐ Valeur basse (pour nous)

**Contexte :** Surya OCR (utilisé par OmniParse) vs RapidOCR (utilisé par Docling dans notre pipeline).

**Résultat benchmarks :** Les deux sont comparables sur l'anglais. Surya est légèrement meilleur sur le multilingue mais nécessite plus de VRAM. RapidOCR est plus léger et suffit pour nos cas d'usage.

**Conclusion :** Pas de migration recommandée — RapidOCR via Docling est le bon choix pour notre profil (CPU, français, PDFs techniques).

---

## 6. Recommandations prioritaires

```
PRIORITÉ 1 — Florence-2 captioning (2–3 jours)
  → Enrichit les figures de la galerie avec descriptions auto
  → Ouvre la voie à la recherche sémantique dans les figures
  → Impact direct sur l'expérience utilisateur

PRIORITÉ 2 — Web crawling des références (1–2 jours)
  → Ajouter endpoint /fetch-reference
  → Séparément de la logique pipeline (pas de refactoring)
  → Utiliser httpx + readability-lxml (pas Selenium — trop lourd)

PRIORITÉ 3 — Audio/Vidéo (1 semaine)
  → Uniquement si le use case "cours + slides" est confirmé
  → Ajoute Whisper (~1.5 Go) aux dépendances
  → À isoler dans un service optionnel
```

---

## 7. Conclusion

| Critère | Gagnant | Commentaire |
|---------|---------|-------------|
| Vitesse extraction PDF (CPU) | **pdf-viewer** | Fast path 300×, Docling 5–10× plus rapide que Marker sur CPU |
| Qualité tables | **pdf-viewer** | Docling 97.9% vs Marker ~75–80% sur tableaux complexes |
| Qualité texte | **pdf-viewer** | Docling 0.877 vs Marker 0.861 |
| Sans GPU | **pdf-viewer** | OmniParse inutilisable sans 8–10 Go VRAM |
| Expérience de lecture | **pdf-viewer** | OmniParse n'a pas d'interface |
| Multimedia (audio/vidéo) | **OmniParse** | Whisper — pdf-viewer ne supporte pas |
| Captioning d'images | **OmniParse** | Florence-2 — pix2tex de pdf-viewer ne fait que les formules |
| Web crawling | **OmniParse** | Selenium — non implémenté dans pdf-viewer |
| Maintenance / modernité moteur | **pdf-viewer** | Docling vs Marker — Docling est plus récent et mieux maintenu |
| Support Windows natif | **pdf-viewer** | OmniParse a des problèmes rapportés sur Windows |

**Notre stack actuelle (Docling + pypdfium2) est objectivement supérieure à OmniParse pour le cas d'usage "lire et naviguer des PDFs techniques sur CPU".** OmniParse apporte trois fonctionnalités complémentaires qui valent d'être intégrées individuellement : le captioning Florence-2, la transcription Whisper, et le crawling de références web.

---

## Sources

- [pdfmux vs PyMuPDF vs Marker vs Docling — 200 PDF benchmark](https://pdfmux.com/blog/pdfmux-vs-pymupdf-vs-marker-vs-docling/)
- [PDF Data Extraction Benchmark 2025 — Docling vs LlamaParse vs Unstructured](https://procycons.com/en/blogs/pdf-data-extraction-benchmark/)
- [Benchmarking PDF Parsers on Math Formula Extraction — arXiv:2512.09874](https://arxiv.org/abs/2512.09874)
- [Benchmarking PDF Parsers on Table Extraction — arXiv:2603.18652](https://arxiv.org/pdf/2603.18652)
- [OmniDocBench — CVPR 2025](https://github.com/opendatalab/OmniDocBench)
- [OmniParse README](https://github.com/adithya-s-k/omniparse)
- [OmniParse issue #109 — Migrate Marker → Docling](https://github.com/adithya-s-k/omniparse/issues/109)
