# DECISIONS — Architecture Decision Records

Dernière mise à jour : 2026-05-21

Format ADR : contexte → décision → alternatives rejetées → conséquences

---

## ADR-001 — pypdfium2 comme fast path pour PDFs natifs

**Contexte :** Les PDFs natifs (texte extractable) n'ont pas besoin du ML Docling (lent, 25-80s).

**Décision :** Utiliser pypdfium2 (libpdfium Google, binding C) pour :
- Détecter nativité (count chars sur 3 pages)
- Extraire TOC natif
- Extraire texte page par page
- Rasteriser PDFs problématiques (JPEG2000, ICC invalide)

**Alternatives rejetées :**
- PyMuPDF (MuPDF) : licence AGPL contraignante pour usage commercial futur
- pdfminer : pur Python, plus lent, moins fiable sur PDFs complexes
- pdfplumber : wrapper pdfminer, mêmes limitations

**Conséquences :** PDFs natifs traités en ~1s vs 25-80s. Couche texte préservée dans PDF viewer.

---

## ADR-002 — Docling pour PDFs scannés + extraction ML

**Contexte :** Les PDFs scannés nécessitent OCR + détection de layout (titres vs corps vs figures).

**Décision :** Utiliser Docling (IBM Research) avec RapidOCR intégré.

**Alternatives rejetées :**
- Tesseract seul : pas de détection de layout, pas de formules, pas de tableaux
- nougat (Meta) : excellent pour papers scientifiques mais trop spécialisé, lent
- marker-pdf : bonne qualité mais Tesseract requis en dépendance système

**Conséquences :** RapidOCR embarqué (pas de dépendance système), TableFormer pour tables,
CodeFormulaV2 pour formules. Modèles HuggingFace téléchargés au premier lancement (~500 MB).

---

## ADR-003 — Cache SHA256[:16] comme doc_id

**Contexte :** Comment identifier un document de manière unique ?

**Décision :** `SHA256(bytes)[:16]` — 16 chars hex = 64 bits entropie, collision négligeable.

**Avantages :**
- Idempotent : même fichier → même ID, cache réutilisé immédiatement
- Pas besoin de BDD
- Nom de répertoire court

**Alternatives rejetées :**
- UUID aléatoire : pas idempotent, re-upload toujours recalcule
- Nom de fichier : collision possible, espaces/caractères spéciaux problématiques

**Conséquences :** `backend/cache/{16-char-hex}/` — structure simple, pas de base de données.

---

## ADR-004 — react-pdf (PDF.js) pour le viewer

**Contexte :** Afficher le PDF dans le navigateur.

**Décision :** react-pdf (wrapper React de PDF.js) avec worker chargé depuis CDN unpkg.

**Worker CDN (FIX-005.6) :** Import `?url` Vite du worker cassait le MIME type.
Fix : `pdfjs.GlobalWorkerOptions.workerSrc = "https://unpkg.com/pdfjs-dist@.../pdf.worker.min.mjs"`

**Alternatives rejetées :**
- `<iframe>` natif : pas de contrôle sur l'UI, pas de sync possible avec sidebar
- PDF.js vanille : trop de code boilerplate React

**Conséquences :** JPEG2000 non supporté → `cleaned.pdf` (rastérisé) servi à la place.

---

## ADR-005 — KaTeX pour le rendu LaTeX (vs MathJax)

**Contexte :** Rendre les formules LaTeX dans le Reader HTML.

**Décision :** KaTeX auto-render (client-side, pas de build step).

**Avantages vs MathJax :**
- ~10x plus rapide au rendu
- Bundle plus petit
- API simple : `renderMathInElement(el, {delimiters, throwOnError: false})`

**Limitation :** KaTeX ne supporte pas 100% des commandes LaTeX (MathJax plus complet).
Acceptable pour les formules physiques/ingénierie typiques (manquent surtout les paquets exotiques).

**Conséquences :** `throwOnError: false` — les formules non supportées sont affichées en rouge
au lieu de planter. Formules CodeFormulaV2 et pix2tex compatibles KaTeX dans la grande majorité.

---

## ADR-006 — Architecture sans base de données

**Contexte :** Stocker les résultats d'extraction.

**Décision :** Fichiers JSON dans `backend/cache/{doc_id}/`. Pas de SQLite, pas de PostgreSQL.

**Raison :** Application mono-utilisateur, mono-machine. La complexité d'une BDD n'est pas justifiée.
Le cache est reconstituable à tout moment (source PDF toujours présent).

**Conséquences :** Pas de requêtes cross-documents (liste des docs récents → localStorage frontend).
Nettoyage manuel du cache possible via `DELETE /doc/{id}` ou `rm -rf backend/cache/`.

---

## ADR-007 — Launcher = fenêtre pywebview (window-only) + WebView2 bundlé

**Contexte :** Rendre le lancement plus convivial (ROADMAP D1). Le launcher systray (pystray)
demandait plusieurs clics et n'offrait pas de fenêtre applicative.

**Décision :** Fenêtre de bureau **pywebview** (backend EdgeChromium/WebView2). Double-clic →
splash → démarrage auto des serveurs → chargement de l'app ; **fermer la fenêtre = quitter**
(pas de tray). Le mode Standard/IA est choisi dans l'interface web (`ModeChooser`), plus dans le
launcher. Runtime WebView2 **bundlé** (bootstrapper Evergreen, auto-install au 1er lancement).
Logique serveur isolée et testée dans `launcher_core.py` ; coquille GUI dans `launcher.py`.

**Raison :** expérience « app » native ; pywebview et pystray se disputent la boucle GUI principale
→ window-only ; WebView2 bundlé pour une machine fraîche. *Fait évoluer le launcher pystray (WIP).*

**Conséquences :** dépend du runtime WebView2 (mitigé par le bundle). Le packaging « frontend statique servi par FastAPI » (D1) a été implémenté : lorsque `frontend/dist` existe, FastAPI sert l'application directement à la racine, évitant de lancer le serveur de dev Node/Vite en production.

---

## ADR-008 — Téléchargement des modèles ML au premier lancement (Lazy Loading)

**Contexte :** L'application utilise plusieurs modèles de Machine Learning locaux (Docling pour la structure et les tableaux, Florence-2 pour le légendage d'images, et pix2tex/texify pour le LaTeX-OCR). Bundler ces modèles dans l'installateur Windows (one-click) augmenterait la taille de l'exécutable à plus de 1,2 Go.

**Décision :** Ne pas bundler les modèles dans l'installateur. Ils seront téléchargés automatiquement en tâche de fond (lazy loading) lors de leur premier appel réel (Docling lors de la première extraction de document, Florence-2 lors du premier légendage de figures, etc.).

**Alternatives rejetées :**
- **Tout bundler dans l'installateur** : Rejeté pour éviter un livrable massif (> 1,2 Go) et complexe à distribuer, alors que certains utilisateurs n'activeront pas toutes les options (ex. le légendage Florence-2).

**Conséquences :**
- L'installateur reste très léger (~27 Mo) et facile à distribuer.
- Une connexion Internet est requise uniquement lors de la première exécution de chaque traitement concerné.
- Temps de démarrage du premier traitement allongé de 30-90s (barre de progression rotative dans le frontend avec des hints explicatifs sur le chargement initial). Les exécutions suivantes sont 100% locales et rapides.
