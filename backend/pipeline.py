"""Wrapper Docling : PDF → outline + figures + tables + bbox normalisées.

Sortie au format consommé par le frontend :
{
    "pages":   [{"number": 1, "width": 595, "height": 842}, ...],
    "outline": [{"id":"s_0","level":1,"title":"Intro","page":1,"bbox":[...],"children":[...]}],
    "figures": [{"id":"f_0","page":3,"bbox":[...],"caption":"...","latex":"..."}],
    "tables":  [{"id":"t_0","page":5,"bbox":[...],"caption":"...","html":"<table>...","n_rows":3,"n_cols":4}],
    "extraction_mode": "fast" | "docling",
    "tesseract_available": true | false
}

Moteurs OCR :
  fast path   → pypdfium2 uniquement (PDFs natifs, pas d'OCR)
  docling     → RapidOCR intégré (scannés, ~1 s/page, sans dépendance système)
  OCRmyPDF    → Tesseract CLI (couche texte embarquée, endpoint /searchable-pdf)
  pytesseract → Tesseract CLI (OCR direct sur images, endpoint /ocr-image)
"""
from __future__ import annotations

import os
import sys
import io

# Disable automatic update checks of albumentations (prevents network timeouts on load)
os.environ["NO_ALBUMENTATIONS_UPDATE"] = "1"

# Route HuggingFace downloads through mirror (hf-mirror.com) if HF_ENDPOINT not already set.
# Needed when huggingface.co is blocked on the network.
os.environ.setdefault("HF_ENDPOINT", "https://hf-mirror.com")

# Force UTF-8 on stdout/stderr to avoid cp1252 UnicodeEncodeError on Windows
if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
if sys.stderr.encoding and sys.stderr.encoding.lower() != "utf-8":
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

import base64
import html
import json
import re
import shutil
import socket
import tempfile
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any, Callable, Optional

import pypdfium2 as pdfium

# ── Forcer IPv4 ───────────────────────────────────────────────────────────────
_orig_getaddrinfo = socket.getaddrinfo
def _ipv4_only(host, port, family=0, type=0, proto=0, flags=0):
    return _orig_getaddrinfo(host, port, socket.AF_INET, type, proto, flags)
socket.getaddrinfo = _ipv4_only
# ─────────────────────────────────────────────────────────────────────────────

from docling.datamodel.base_models import InputFormat
from docling.datamodel.pipeline_options import (
    AcceleratorDevice,
    AcceleratorOptions,
    PdfPipelineOptions,
)
from docling.document_converter import DocumentConverter, PdfFormatOption

from imgsize import img_pixel_size

# ══════════════════════════════════════════════════════════════════════════════
# TESSERACT — détection et configuration au démarrage
# ══════════════════════════════════════════════════════════════════════════════

def _find_tesseract() -> tuple[str | None, str | None]:
    """Détecte le binaire tesseract et le répertoire tessdata sur le système.

    Cherche dans l'ordre :
      1. Variable d'environnement TESSERACT_CMD
      2. PATH (shims scoop, conda, etc.)
      3. Chemins typiques Windows (Program Files, scoop)
    Retourne (cmd_path, tessdata_path) ou (None, None) si absent.
    """
    # Chemin explicite via env
    env_cmd = os.environ.get("TESSERACT_CMD")
    if env_cmd and Path(env_cmd).exists():
        cmd = env_cmd
    else:
        cmd = shutil.which("tesseract")

    if not cmd:
        # Emplacements Windows courants
        candidates = [
            Path(os.environ.get("ProgramFiles", ""), "Tesseract-OCR", "tesseract.exe"),
            Path(os.environ.get("ProgramFiles(x86)", ""), "Tesseract-OCR", "tesseract.exe"),
            Path(os.environ.get("LOCALAPPDATA", ""), "Programs", "Tesseract-OCR", "tesseract.exe"),
            Path(os.environ.get("USERPROFILE", ""), "scoop", "shims", "tesseract.exe"),
        ]
        for c in candidates:
            if c.exists():
                cmd = str(c)
                break

    if not cmd:
        return None, None

    # Chercher tessdata à côté du binaire ou via TESSDATA_PREFIX
    tessdata = os.environ.get("TESSDATA_PREFIX")
    if not tessdata:
        # Scoop : le vrai binaire est dans apps/tesseract/current, pas le shim
        scoop_data = Path(os.environ.get("USERPROFILE", "")) / "scoop" / "apps" / "tesseract" / "current" / "tessdata"
        if scoop_data.exists():
            tessdata = str(scoop_data)
        else:
            # À côté du binaire résolu
            real = Path(cmd).resolve()
            candidate = real.parent / "tessdata"
            if candidate.exists():
                tessdata = str(candidate)

    return cmd, tessdata


# Exécuté une fois à l'import du module
TESSERACT_CMD, TESSDATA_DIR = _find_tesseract()

if TESSERACT_CMD:
    # Configurer TESSDATA_PREFIX pour tesseract CLI et ocrmypdf
    if TESSDATA_DIR:
        os.environ["TESSDATA_PREFIX"] = TESSDATA_DIR
    # Configurer pytesseract si disponible
    try:
        import pytesseract as _pyt  # type: ignore
        _pyt.pytesseract.tesseract_cmd = TESSERACT_CMD
        print(f"[tesseract] {TESSERACT_CMD} | tessdata: {TESSDATA_DIR}")
    except ImportError:
        pass
else:
    print("[tesseract] Non trouve - OCRmyPDF et pytesseract desactives")

BATCH_SIZE = 10        # pages par tranche Docling (réduit pour éviter les OOM / timeouts)
_NATIVE_CHAR_MIN = 100 # chars sur 3 premières pages pour déclarer PDF natif

# TD-013 : version pipeline — incrémentée à chaque changement de logique d'extraction.
# Permet de détecter un cache obsolète et de proposer un re-traitement.
PIPELINE_VERSION = "2026-05-25"

# Locks partagés pour les ressources non thread-safe
_CONVERTER_LOCK = threading.Lock()   # sérialise la création du DocumentConverter
_PIX2TEX_LOCK   = threading.Lock()   # sérialise l'inférence pix2tex
_PDFIUM_LOCK    = threading.Lock()   # sérialise les appels pypdfium2 (non thread-safe sur même fichier)

# ── Pre-compiled patterns pour le post-traitement HTML (Piste A) ─────────────
# Ces patterns étaient compilés à chaque appel de fonction ; ils sont désormais
# compilés une seule fois au chargement du module.
_RE_FIG_FIGURE  = re.compile(r'<figure>(.*?)</figure>', re.DOTALL | re.IGNORECASE)
_RE_FIG_B64     = re.compile(r'src="data:image/[^;]+;base64,([A-Za-z0-9+/=]+)"', re.IGNORECASE)
_RE_LATEX_START = re.compile(r'^\s*(\$\$|\$|\\[\(\[]|\\begin\{)')

# ── Pattern combiné pour les passes HTML légères (Piste D) ───────────────────
# Fusionne 3 passes indépendantes en une seule substitution :
#   dblspace  : doubles espaces résiduels d'extraction PDF
#   formula   : balises formula-not-decoded → formula (si contenu LaTeX)
#   pgnum     : lignes "N-M" seules (numéros de page en-tête/pied)
#   italic    : <p><em>...</em></p> courts (pieds de page italiques)
_RE_COMBINED = re.compile(
    r'(?P<dblspace>(?<![<>])  +(?![<>]))'
    r'|(?P<formula><(?P<ftag>div|span)(?P<fattrs>[^>]*\bformula-not-decoded\b[^>]*)>'
    r'(?P<fcont>.*?)</(?P=ftag)>)'
    r'|(?P<pgnum><p>\s*(?:<[^>]+>)*\s*\d+[-–]\d+\s*(?:</[^>]+>)*\s*</p>)'
    r'|(?P<italic><p>\s*<em>(?P<itxt>[^<]{0,120})</em>\s*</p>)',
    re.DOTALL,
)


def _apply_combined_passes(html: str) -> str:
    """Applique dblspace + formula-decode + pgnum-strip + short-italic-strip en une passe."""
    def _dispatch(m: re.Match) -> str:
        if m.group('dblspace') is not None:
            return ' '
        if m.group('formula') is not None:
            if _RE_LATEX_START.search(m.group('fcont')):
                new_attrs = re.sub(r'\bformula-not-decoded\b', 'formula', m.group('fattrs'))
                tag = m.group('ftag')
                return f'<{tag}{new_attrs}>{m.group("fcont")}</{tag}>'
            return m.group(0)
        if m.group('pgnum') is not None:
            return ''
        if m.group('italic') is not None:
            return '' if len(m.group('itxt').split()) <= 12 else m.group(0)
        return m.group(0)
    return _RE_COMBINED.sub(_dispatch, html)


# TD-009 : surveillance RAM ────────────────────────────────────────────────────
try:
    import psutil as _psutil
    _PSUTIL_OK = True
except ImportError:
    _psutil = None  # type: ignore
    _PSUTIL_OK = False


def _log_memory(label: str = "") -> None:
    """Affiche la consommation mémoire du processus courant (RSS)."""
    if not _PSUTIL_OK:
        return
    rss = _psutil.Process().memory_info().rss
    mb = rss / (1024 * 1024)
    tag = f" [{label}]" if label else ""
    print(f"[memory]{tag} RSS={mb:.0f} MB")


def _detect_compute() -> tuple[str, float]:
    """Détecte le meilleur device disponible : cuda > mps > cpu.

    Retourne (device_str, vram_gb).
    AcceleratorDevice.AUTO est utilisé dans _converter — cette détection sert
    uniquement à ajuster le nombre de workers et le logging.
    """
    try:
        import torch
        if torch.cuda.is_available():
            name  = torch.cuda.get_device_name(0)
            vram  = torch.cuda.get_device_properties(0).total_memory / (1024 ** 3)
            print(f"[pipeline] GPU CUDA  : {name} ({vram:.1f} GB VRAM)")
            return "cuda", vram
        if torch.backends.mps.is_available():
            print("[pipeline] GPU MPS (Apple Silicon) detecte")
            return "mps", 0.0
    except Exception:
        pass
    print("[pipeline] GPU : aucun CUDA/MPS - inference sur CPU")
    return "cpu", 0.0


def _compute_docling_workers(device: str) -> tuple[int, int]:
    """Calcule (n_workers, threads_par_worker) en fonction de toutes les ressources.

    Stratégie :
    - GPU disponible  : peu de workers CPU (GPU gère l'inférence ML), beaucoup de threads par worker.
    - CPU uniquement  : sweet-spot empirique = 4 threads par worker Docling.
                        Au-delà de 4 threads, le gain par worker devient marginal (overhead OpenMP).
                        On maximise donc le nombre de workers dans la limite RAM/CPU.

    Hiérarchie : env var DOCLING_WORKERS > calcul auto.
    """
    cpu_cores = os.cpu_count() or 4

    if "DOCLING_WORKERS" in os.environ:
        n = int(os.environ["DOCLING_WORKERS"])
        threads = max(1, cpu_cores // n)
        print(f"[pipeline] DOCLING_WORKERS={n} (env var), {threads} threads/worker")
        return n, threads

    if device in ("cuda", "mps"):
        # Inférence ML déléguée au GPU — peu de workers CPU suffisent
        threads_per = max(4, cpu_cores // 4)
        workers_by_cpu = max(1, min(cpu_cores // threads_per, 4))
    else:
        # CPU only : 4 threads/worker = sweet-spot Docling
        threads_per = 4
        workers_by_cpu = max(1, cpu_cores // threads_per)   # 32 cores → 8 workers

    if _PSUTIL_OK:
        available_gb = _psutil.virtual_memory().available / (1024 ** 3)
        total_gb     = _psutil.virtual_memory().total     / (1024 ** 3)
        workers_by_ram = max(1, int((available_gb - 2.0) / 1.5))
        n = min(workers_by_ram, workers_by_cpu, 16)
        # Dynamically scale threads per worker if worker count is limited by RAM
        threads_per = max(4, min(cpu_cores // n, 12))
        print(
            f"[pipeline] DOCLING_WORKERS auto={n} | {threads_per} threads/worker | "
            f"device={device} | RAM {available_gb:.1f}/{total_gb:.1f} GB | {cpu_cores} cores"
        )
    else:
        n = min(2, workers_by_cpu)
        threads_per = max(1, cpu_cores // n)
        print(f"[pipeline] DOCLING_WORKERS={n} (psutil absent, fallback)")

    n = max(1, n)

    # Aligner PyTorch sur l'allocation choisie — évite la contention entre workers
    try:
        import torch
        torch.set_num_threads(threads_per)
        torch.set_num_interop_threads(max(1, cpu_cores // 4))
    except Exception:
        pass

    return n, threads_per


COMPUTE_DEVICE, COMPUTE_VRAM_GB = _detect_compute()
DOCLING_WORKERS, THREADS_PER_WORKER = _compute_docling_workers(COMPUTE_DEVICE)


# Numéro de section : requiert au minimum le format X.Y (ex: 1.1, 2.3.4)
_SECTION_PREFIX = re.compile(r"^\s*(\d+(?:\.\d+)+)\.?(?=\s|$)")
# Chapitre top-level : "1. Titre", "12. Titre" — un seul chiffre suivi d'un point et d'une majuscule
_TOP_CHAPTER_PREFIX = re.compile(r"^\s*(\d{1,2})\.\s+([A-ZÀ-Ü])")
# Chapitre : requiert un deux-points pour distinguer "Chapter 3: Title" de "Chapter 3 describes..."
_CHAPTER_PREFIX = re.compile(r"^\s*Chapter\s+(\d+)\s*:", re.IGNORECASE)
# Annexes : "Attachment A", "Appendix B", "Annex C", "Annex 1" etc.
_ANNEX_PREFIX = re.compile(
    r"^\s*(Attachment|Appendix|Annex|Exhibit)\s+([A-Z0-9]+)\b",
    re.IGNORECASE,
)
# Gardé pour compatibilité interne (Docling path)
_NUM_PREFIX = re.compile(r"^\s*(\d+(?:\.\d+)*)\.?(?=\s|$)")
_FALSE_POSITIVE_PATTERNS = re.compile(
    r"^("
    r"In these expressions|T-stub response|Definition of effective|"
    r"Definition of the rigid|"
    r"where\s|Note\s*:|see\s|with\s|for\s|and\s|the\s|this\s|it\s|from\s|"
    r"Part\s+[IVX]+\s*:|"
    r"\([a-z]\)\s|"
    r"·\s|"
    r"Data\s*:|Calculation\s*:|PRELIMINARY\s|CALCULATION\s+PROCEDURE|"
    r"Assembly procedure\s|Presentation for\s|"
    r"^Strength$|^Stiffness$|^Modelling$|^Data$|^Calculation$"
    r")",
    re.IGNORECASE,
)


def _clean_markdown(text: str) -> str:
    """Nettoie le texte Markdown généré par Docling/MarkItDown.

    1. Remplace les quadruples dollars $$$$ par des doubles dollars $$ (LaTeX display).
    2. Supprime les points de conduite (dot-leaders) du sommaire dans le Markdown.
    """
    if not text:
        return text
    # 1. Nettoyer les quadruples dollars pour KaTeX
    text = re.sub(r'\$\$\$\$', '$$', text)

    # 2. Supprime les points de conduite du sommaire
    text = re.sub(r'[\s.·\u00B7\u2022]{3,}\s*\d*\s*(?=\||$|\n)|[\s.·\u00B7\u2022]{5,}\s*\d*\s*', ' ', text)

    return text


def has_native_text(pdf_path: Path) -> bool:
    """Retourne True si le PDF contient du texte extractable (non scanné)."""
    src = pdfium.PdfDocument(str(pdf_path))
    try:
        chars = 0
        for i in range(min(3, len(src))):
            tp = src[i].get_textpage()
            chars += len(tp.get_text_range())
            tp.close()
        return chars > _NATIVE_CHAR_MIN
    finally:
        src.close()


# ═══════════════════════════════════════════════════════════════════════════════
# CHEMIN RAPIDE — pypdfium2 uniquement (PDFs natifs)
# ═══════════════════════════════════════════════════════════════════════════════
_ALPHA_WORD = re.compile(r"[a-zA-ZÀ-ÿ]{3,}")   # au moins 3 lettres consécutives
_MATH_HEAVY = re.compile(r"[=×÷±≤≥≠∆∑∫√½π⋅·σδε]|[<>]=?")  # symboles math




def _toc_vers_outline(toc_items: list) -> list[dict[str, Any]]:
    """Convertit les items TOC pypdfium2 en outline hierarchique.

    FIX-049 : tri par numero de page avant la construction de la hierarchie.
    Certains PDF placent les Attachments/Annexes en tete de leurs bookmarks
    alors qu'ils se trouvent a la fin du document. Le tri garantit que l'ordre
    d'affichage dans la sidebar correspond a l'ordre reel des pages.
    Les entrees sans page (None) sont releguees a la fin.
    """
    flat: list[dict[str, Any]] = []
    for i, item in enumerate(toc_items):
        title = (item.get_title() or "").strip()
        if not title:
            continue
        dest = item.get_dest()
        page_index = dest.get_index() if dest is not None else None
        flat.append({
            "id": f"s_{i}",
            "level": (item.level or 0) + 1,  # pdfium 0-indexed -> 1-indexed
            "title": title,
            "page": (page_index + 1) if page_index is not None else None,
            "bbox": None,
            "children": [],
        })
    # Trier par page (None -> fin) pour retablir l'ordre du document
    flat.sort(key=lambda x: (x["page"] is None, x["page"] or 0))
    return _construire_outline(flat)


def _est_titre_section(
    line: str, has_chapters: bool = False, has_x0_chapters: bool = False
) -> tuple[bool, int | None]:
    """Retourne (is_section, level) si la ligne ressemble à un titre de section.

    Critères stricts pour le fast path (pas de layout ML) :
    - Chapitres top-level : "1. Titre", "12. Titre" (FIX-013)
    - Chapitres : "Chapter N: Titre" (deux-points obligatoire)
    - Annexes   : "Attachment A", "Appendix B", "Annex C", etc.
    - Sections  : format X.Y minimum (au moins un point dans le numéro)
    - Texte après le numéro : >=10 chars, >=50 % lettres, >=1 mot de 3+ lettres
    - Pas de symboles mathématiques dans la suite

    has_x0_chapters : True si le doc utilise le style "N.0 Titre" pour les chapitres
      → désactive _TOP_CHAPTER_PREFIX (évite les items de liste "1. Texte..." en L1)
      → les sections "N.0" reçoivent le niveau 1 au lieu de 2 (FIX-076)
    """
    if ".." in line:
        return False, None

    # Chapter N: Titre
    if _CHAPTER_PREFIX.match(line):
        return True, 1

    # Attachment A / Appendix B / Annex C
    if _ANNEX_PREFIX.match(line):
        # Filter out Annex citations/references (e.g. "Annex L [1]", "Annex L, 1992", "Annex J of Eurocode 3.")
        if re.search(r"\[\d+\]", line) or re.search(r"\b(19|20)\d{2}\b", line) or "of Eurocode" in line:
            return False, None
        return True, 1

    # Chapitre top-level : "1. Titre" ... "99. Titre"
    # Désactivé quand les chapitres "Chapter N:" existent, ou quand le style "N.0" est détecté
    # (dans ce cas "1. Texte" est un item de liste, pas un chapitre — FIX-076)
    if not has_chapters and not has_x0_chapters:
        m_top = _TOP_CHAPTER_PREFIX.match(line)
        if m_top:
            rest = line[m_top.end() - 1:].strip()
            if (len(rest) >= 5
                    and _ALPHA_WORD.search(rest)
                    and not _MATH_HEAVY.search(rest)
                    and not _FALSE_POSITIVE_PATTERNS.match(line)):
                alpha_ratio = sum(c.isalpha() for c in rest) / max(len(rest), 1)
                if alpha_ratio >= 0.50:
                    return True, 1

    # Section X.Y
    m = _SECTION_PREFIX.match(line)
    if not m:
        return False, None

    rest = line[m.end():].strip()

    # FIX-076 : abaissé de 10 à 5 pour capturer les titres courts comme "GENERAL" (7) ou "CRITERIA" (8)
    if len(rest) < 5:
        return False, None

    # Title must start with capital letter or digit (not lowercase)
    if rest and rest[0].islower():
        return False, None

    if not _ALPHA_WORD.search(rest):
        return False, None

    if _MATH_HEAVY.search(rest):
        return False, None

    alpha_ratio = sum(c.isalpha() for c in rest) / max(len(rest), 1)
    if alpha_ratio < 0.50:
        return False, None

    # FIX-076 : sections "N.0 Titre" (ex. "1.0 INTRODUCTION", "2.0 GENERAL...") sont des
    # chapitres top-level dans le style de numérotation "X.0". Avec dot_count + 1 elles
    # recevraient niveau 2 — identique aux sous-sections "2.1", "3.3" — rendant l'outline
    # plat. Si le dernier segment du numéro est "0", réduire le niveau d'un cran.
    parts = m.group(1).split(".")
    if has_x0_chapters and len(parts) >= 2 and parts[-1] == "0":
        level = max(1, m.group(1).count("."))  # "1.0" → 1, "2.0" → 1
    else:
        level = m.group(1).count(".") + 1
    return True, level


def _flatten_outline_list(nodes: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Retourne tous les noeuds d'un outline (aplatissement recursif)."""
    result: list[dict[str, Any]] = []
    for n in nodes:
        result.append(n)
        result.extend(_flatten_outline_list(n.get("children", [])))
    return result


_TOC_PAGE_THRESHOLD = 20  # Raised from 6 to 20 — filtering is now robust enough


def _is_toc_page(text: str) -> bool:
    """Determine si le texte d'une page correspond a une table des matieres (TOC)."""
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    for line in lines:
        if line.lower() in ("table of contents", "sommaire", "table des matieres", "contents"):
            return True
    dot_leader_lines = 0
    for line in lines:
        if "..." in line or "..." in line or ". . ." in line or " . . " in line:
            dot_leader_lines += 1
    if dot_leader_lines >= 3:
        return True
    return False


def _line_continuation_check(lines: list[str], i: int) -> bool:
    """Return True if line at index i looks like a continuation of the previous line (not a heading)."""
    if i <= 0:
        return False
    prev_line = lines[i-1]
    if not prev_line or len(prev_line) <= 20:
        return False
    ends_with_punc = prev_line[-1] in (".", "!", "?", ":", ")", "]", '"', "'", "\u201d")
    is_prev_heading = (_SECTION_PREFIX.match(prev_line) or
                       _CHAPTER_PREFIX.match(prev_line) or
                       _ANNEX_PREFIX.match(prev_line))
    ends_with_ref_keyword = any(prev_line.lower().endswith(kw) for kw in
        ("fig.", "figure", "table", "eq.", "equation", "section", "annex", "appendix",
         "and", "or", "the", "a", "of", "to", "in", "for"))
    if not is_prev_heading and (not ends_with_punc or ends_with_ref_keyword):
        return True
    return False


_X0_CHAPTER = re.compile(r"^\s*\d{1,3}\.0\s+[A-ZÀ-Ü]")


def _outline_depuis_texte_flat(page_texts: list[str]) -> list[dict[str, Any]]:
    """Variante de _outline_depuis_texte qui retourne une liste plate (sans hierarchie)."""
    flat: list[dict[str, Any]] = []
    seen: set[str] = set()
    sid = 0

    has_chapters = any(_CHAPTER_PREFIX.match(l) for t in page_texts for l in t.splitlines())
    # FIX-076 : détecte le style "N.0 Titre" (ex. "1.0 INTRODUCTION", "2.0 GENERAL CONSIDERATIONS")
    # → désactive _TOP_CHAPTER_PREFIX pour éviter les items de liste numérotés comme L1
    has_x0_chapters = not has_chapters and any(
        _X0_CHAPTER.match(l.strip())
        for t in page_texts for l in t.splitlines() if l.strip()
    )

    for pno, text in enumerate(page_texts):
        if _is_toc_page(text):
            continue
        lines = [line.strip() for line in text.splitlines()]
        candidates: list[tuple[str, int]] = []
        for i, line in enumerate(lines):
            if not line or len(line) > 120:
                continue
            if _FALSE_POSITIVE_PATTERNS.match(line):
                continue
            if _line_continuation_check(lines, i):
                continue
            ok, level = _est_titre_section(line, has_chapters, has_x0_chapters)
            if ok:
                candidates.append((line, level or 1))

        if len(candidates) >= _TOC_PAGE_THRESHOLD:
            continue

        for line, level in candidates:
            key = line.lower()
            if key in seen:
                continue
            seen.add(key)
            flat.append({
                "id": f"sa_{sid}",
                "level": level,
                "title": line,
                "page": pno + 1,
                "bbox": None,
                "children": [],
            })
            sid += 1

    return flat


def _outline_depuis_texte(page_texts: list[str]) -> list[dict[str, Any]]:
    """Detecte les sections par regex dans le texte brut des pages (fallback sans TOC)."""
    flat: list[dict[str, Any]] = []
    seen: set[str] = set()
    sid = 0

    has_chapters = any(_CHAPTER_PREFIX.match(l) for t in page_texts for l in t.splitlines())
    has_x0_chapters = not has_chapters and any(
        _X0_CHAPTER.match(l.strip())
        for t in page_texts for l in t.splitlines() if l.strip()
    )

    for pno, text in enumerate(page_texts):
        if _is_toc_page(text):
            continue
        lines = [line.strip() for line in text.splitlines()]
        candidates: list[tuple[str, int]] = []
        for i, line in enumerate(lines):
            if not line or len(line) > 120:
                continue
            if _FALSE_POSITIVE_PATTERNS.match(line):
                continue
            if _line_continuation_check(lines, i):
                continue
            ok, level = _est_titre_section(line, has_chapters, has_x0_chapters)
            if ok:
                candidates.append((line, level or 1))

        if len(candidates) >= _TOC_PAGE_THRESHOLD:
            continue

        for line, level in candidates:
            key = line.lower()
            if key in seen:
                continue
            seen.add(key)
            flat.append({
                "id": f"s_{sid}",
                "level": level,
                "title": line,
                "page": pno + 1,
                "bbox": None,
                "children": [],
            })
            sid += 1

    return _construire_outline(flat)


def _extraire_natif(pdf_path: Path, out_dir: Path, pages_info: list[dict[str, Any]]) -> dict[str, Any]:
    """Extraction rapide via pypdfium2 uniquement. Pas de Docling — <2 s."""
    src = pdfium.PdfDocument(str(pdf_path))
    n_pages = len(src)
    page_texts: list[str] = []

    for pno in range(n_pages):
        tp = src[pno].get_textpage()
        page_texts.append(tp.get_text_range())
        tp.close()

    # Outline depuis TOC natif, sinon détection par regex.
    # Dans les deux cas, compléter avec les Annexes/Attachments détectés par texte
    # car ils sont souvent absents du TOC interne du PDF.
    toc = list(src.get_toc())
    if toc:
        outline = _toc_vers_outline(toc)
        # Chercher les Annexes dans le texte et les ajouter si absentes du TOC
        text_outline_flat = _outline_depuis_texte_flat(page_texts)
        toc_keys = {n["title"].lower().strip() for n in _flatten_outline_list(outline)}
        for node in text_outline_flat:
            if _ANNEX_PREFIX.match(node["title"]) and node["title"].lower().strip() not in toc_keys:
                outline.append(node)
    else:
        outline = _outline_depuis_texte(page_texts)
    src.close()

    # Markdown : texte brut paginé
    parts = [t.strip() for t in page_texts if t.strip()]
    full_md = "\n\n".join(parts)
    (out_dir / "figures").mkdir(exist_ok=True)
    (out_dir / "result.md").write_text(_clean_markdown(full_md), encoding="utf-8")

    return {
        "pages": pages_info,
        "outline": outline,
        "figures": [],
        "tables": [],
        "n_pages": n_pages,
        "n_figures": 0,
        "n_tables": 0,
        "extraction_mode": "fast",
    }

# ═══════════════════════════════════════════════════════════════════════════════
# CHEMIN DOCLING — extraction complète (OCR, figures, tables)
# ═══════════════════════════════════════════════════════════════════════════════

# ── CodeFormulaV2 (Docling natif) ─────────────────────────────────────────────
# Passe 1 : Docling décode les formules via son modèle VLM intégré.
# Nécessite ~1-2 GB HuggingFace au 1er lancement.
# Activer avec : FORMULA_ENRICHMENT=1 dans l'environnement.
FORMULA_ENRICHMENT = os.environ.get("FORMULA_ENRICHMENT", "0").strip() == "1"
if FORMULA_ENRICHMENT:
    print("[pipeline] CodeFormulaV2 ACTIVE - 1er lancement = telechargement HuggingFace (~1-2 GB)")
else:
    print("[pipeline] CodeFormulaV2 desactive. Mettre FORMULA_ENRICHMENT=1 pour activer.")

# ── pix2tex (LaTeX-OCR) fallback ──────────────────────────────────────────────
# Passe 2 : après Docling, toute formule encore "not decoded" est soumise à
# pix2tex. Actif par défaut dès que pix2tex est installé.
# Désactiver avec : PIX2TEX_FALLBACK=0 dans l'environnement.
PIX2TEX_FALLBACK = os.environ.get("PIX2TEX_FALLBACK", "1").strip() == "1"
if PIX2TEX_FALLBACK:
    print("[pipeline] pix2tex fallback ACTIVE - s'applique aux formules restantes apres CodeFormulaV2")
else:
    print("[pipeline] pix2tex fallback desactive.")


# ── Moteur LaTeX-OCR ──────────────────────────────────────────────────────────
# FORMULA_ENGINE contrôle quel moteur est utilisé pour convertir les formules
# non décodées par Docling en LaTeX :
#   "texify"  → Texify (VikParuchuri) — batch, plus précis sur les formules complexes
#   "pix2tex" → pix2tex legacy — image par image
#   "auto"    → Texify si installé, sinon pix2tex (défaut)
FORMULA_ENGINE = os.environ.get("FORMULA_ENGINE", "auto").strip().lower()
print(f"[pipeline] FORMULA_ENGINE={FORMULA_ENGINE}")

# ── Texify (LaTeX-OCR) ────────────────────────────────────────────────────────
_texify_model     = None
_texify_processor = None
_texify_loaded    = False


def _init_texify() -> bool:
    """Charge le modèle Texify une seule fois (lazy singleton).

    Retourne True si le modèle est disponible.
    Téléchargement HuggingFace ~500 MB au premier lancement.
    """
    global _texify_model, _texify_processor, _texify_loaded
    if _texify_loaded:
        return _texify_model is not None
    _texify_loaded = True
    try:
        from texify.model.model import load_model        # type: ignore
        from texify.model.processor import load_processor  # type: ignore
        print("[pipeline] Texify : chargement modèle (~500 MB)...")
        _texify_processor = load_processor()
        _texify_model     = load_model()
        print("[pipeline] Texify chargé")
        return True
    except ImportError:
        print("[pipeline] Texify non installé. pip install texify")
        return False
    except Exception as exc:
        print(f"[pipeline] Texify erreur chargement : {exc}")
        return False


def _resolve_engine() -> str:
    """Retourne 'texify' ou 'pix2tex' selon FORMULA_ENGINE et les deps installées."""
    if FORMULA_ENGINE == "texify":
        return "texify"
    if FORMULA_ENGINE == "pix2tex":
        return "pix2tex"
    # auto : texify en priorité
    if _init_texify():
        return "texify"
    _init_latex_ocr()
    return "pix2tex" if _latex_model is not None else "none"


def _latex_ocr_batch(imgs: list) -> list[str | None]:
    """Exécute LaTeX-OCR sur une liste d'images PIL.

    Retourne une liste de même longueur : chaîne LaTeX ou None.
    - Texify   : un seul appel batch_inference (efficace, ~modèle 500 MB)
    - pix2tex  : traitement image par image via _pix2tex_predict
    Sérialisé via _PIX2TEX_LOCK — les deux moteurs partagent PyTorch.
    """
    if not imgs:
        return []

    engine = _resolve_engine()

    if engine == "texify":
        try:
            from texify.inference import batch_inference  # type: ignore
            with _PIX2TEX_LOCK:
                raw = batch_inference(imgs, _texify_model, _texify_processor)
            out: list[str | None] = []
            for r in raw:
                s = (r or "").strip()
                s = _sanitize_latex(s)
                out.append(s if 3 <= len(s) <= 800 else None)
            return out
        except Exception as exc:
            print(f"[pipeline] Texify batch erreur : {exc}")
            return [None] * len(imgs)

    if engine == "pix2tex":
        results: list[str | None] = []
        for img in imgs:
            try:
                with _PIX2TEX_LOCK:
                    latex = _pix2tex_predict(_latex_model, img)
                s = (latex or "").strip()
                results.append(s if 3 <= len(s) <= 800 else None)
            except Exception:
                results.append(None)
        return results

    return [None] * len(imgs)


def _latex_ocr_single(img) -> str | None:
    """Raccourci : OCR sur une seule image. Retourne LaTeX ou None."""
    results = _latex_ocr_batch([img])
    return results[0] if results else None


# ── Florence-2 (figure captioning) ───────────────────────────────────────────
# Génère une description textuelle pour chaque figure extraite.
# Modèle : microsoft/Florence-2-base (~450 MB, CPU, ~1-3 s/figure)
# Activer : FLORENCE2_CAPTION=1
# Désactiver : FLORENCE2_CAPTION=0 (défaut — opt-in car téléchargement 450 MB)
FLORENCE2_CAPTION = os.environ.get("FLORENCE2_CAPTION", "0").strip() == "1"
if FLORENCE2_CAPTION:
    print("[pipeline] Florence-2 ACTIVE - 1er lancement = téléchargement HuggingFace (~450 MB)")
else:
    print("[pipeline] Florence-2 desactive. Mettre FLORENCE2_CAPTION=1 pour activer le captioning IA.")

_FLORENCE_LOCK = threading.Lock()
_florence_model = None
_florence_processor = None
_florence_loaded = False


def _init_florence() -> bool:
    """Charge Florence-2-base une seule fois (lazy singleton). Retourne True si disponible."""
    global _florence_model, _florence_processor, _florence_loaded
    if _florence_loaded:
        return _florence_model is not None
    _florence_loaded = True
    try:
        import torch
        from transformers import AutoModelForCausalLM, AutoProcessor
        print("[pipeline] Florence-2 : chargement microsoft/Florence-2-base...")
        _florence_processor = AutoProcessor.from_pretrained(
            "microsoft/Florence-2-base", trust_remote_code=True
        )
        _florence_model = AutoModelForCausalLM.from_pretrained(
            "microsoft/Florence-2-base",
            trust_remote_code=True,
            torch_dtype=torch.float32,
            attn_implementation="eager",
        ).eval()
        print("[pipeline] Florence-2 chargé")
        return True
    except Exception as e:
        print(f"[pipeline] Florence-2 non disponible : {e}")
        _florence_model = None
        _florence_processor = None
        return False


def _florence_caption(img) -> str | None:
    """Génère une description détaillée pour une image PIL via Florence-2.

    Retourne une chaîne de caractères ou None en cas d'échec.
    Sérialisé via _FLORENCE_LOCK — le modèle n'est pas thread-safe.
    """
    if not _init_florence():
        return None
    try:
        import torch
        task = "<DETAILED_CAPTION>"
        with _FLORENCE_LOCK:
            inputs = _florence_processor(text=task, images=img, return_tensors="pt")
            with torch.no_grad():
                ids = _florence_model.generate(
                    input_ids=inputs["input_ids"],
                    pixel_values=inputs["pixel_values"],
                    max_new_tokens=128,
                    do_sample=False,
                    num_beams=3,
                )
            raw = _florence_processor.batch_decode(ids, skip_special_tokens=False)[0]
            parsed = _florence_processor.post_process_generation(
                raw, task=task, image_size=(img.width, img.height)
            )
        caption = (parsed.get(task) or "").strip()
        return caption if len(caption) > 8 else None
    except Exception as e:
        print(f"[pipeline] Florence-2 caption erreur : {e}")
        return None


_CONVERTERS: dict[bool, DocumentConverter | None] = {True: None, False: None}

def _converter(do_ocr: bool = False) -> DocumentConverter:
    # Serialise la construction du DocumentConverter (chargement modèles Torch/HF)
    with _CONVERTER_LOCK:
        if _CONVERTERS[do_ocr] is None:
            opts = PdfPipelineOptions()
            opts.do_ocr = do_ocr                           # True pour PDFs scannés, False pour natifs
            opts.do_table_structure = True                 # TableFormer activé pour extraire les tables
            opts.generate_picture_images = True
            opts.generate_page_images = True               # Enable page rendering for crops (for formula decoding)
            opts.images_scale = 2.0                        # 144 DPI — images at proper reading resolution
            opts.do_formula_enrichment = FORMULA_ENRICHMENT  # CodeFormulaV2 : LaTeX au lieu de "not decoded"
            # Utiliser le meilleur accélérateur disponible (CUDA > MPS > CPU)
            # et allouer exactement THREADS_PER_WORKER threads par worker
            opts.accelerator_options = AcceleratorOptions(
                num_threads=THREADS_PER_WORKER,
                device=AcceleratorDevice.AUTO,
            )
            _CONVERTERS[do_ocr] = DocumentConverter(
                format_options={InputFormat.PDF: PdfFormatOption(pipeline_options=opts)}
            )
        return _CONVERTERS[do_ocr]


def _bbox_to_list(bbox) -> list[float] | None:
    if bbox is None:
        return None
    try:
        return [float(bbox.l), float(bbox.t), float(bbox.r), float(bbox.b)]
    except AttributeError:
        return None


def _provenance(item) -> tuple[int | None, list[float] | None]:
    prov = getattr(item, "prov", None) or []
    if not prov:
        return None, None
    p0 = prov[0]
    page = getattr(p0, "page_no", None)
    bbox = _bbox_to_list(getattr(p0, "bbox", None))
    return page, bbox


def _extraire_sections_doc(doc, page_offset: int, id_offset: int) -> list[dict[str, Any]]:
    sections: list[dict[str, Any]] = []
    seen_titles: set[str] = set()

    for i, item in enumerate(doc.texts):
        label = getattr(item, "label", None)
        label_str = str(label).lower() if label else ""
        title = (item.text or "").strip()

        is_section_header = "section_header" in label_str
        is_chapter = bool(_CHAPTER_PREFIX.match(title))
        is_annex = bool(_ANNEX_PREFIX.match(title))
        if not is_section_header and not is_chapter and not is_annex:
            continue
        if ".." in title:
            continue
        if _FALSE_POSITIVE_PATTERNS.match(title):
            continue
        if len(title) > 120:
            continue

        title_key = title.lower().strip()
        if title_key in seen_titles:
            continue
        seen_titles.add(title_key)

        page, bbox = _provenance(item)
        if page is not None:
            page = page + page_offset

        chapter_match = _CHAPTER_PREFIX.match(title)
        annex_match = _ANNEX_PREFIX.match(title)
        inferred = _level_depuis_titre(title)
        if chapter_match or annex_match:
            level = 1
        elif inferred is not None:
            level = inferred
        else:
            level = int(getattr(item, "level", 1) or 1)

        sections.append({
            "id": f"s_{id_offset + i}",
            "level": level,
            "title": title,
            "page": page,
            "bbox": bbox,
            "children": [],
        })

    return sections


def _extraire_figures_doc(
    doc, page_offset: int, fig_offset: int, figures_dir: Path,
    do_latex_ocr: bool = False,
) -> list[dict[str, Any]]:
    """Extrait les figures d'un DoclingDocument.

    do_latex_ocr=False (défaut) : extraction rapide, pas de pix2tex.
    do_latex_ocr=True  : appelé uniquement via POST /doc/{id}/latex-ocr (à la demande).

    Filtres qualité :
      - Images < 50×50 px ignorées (éléments décoratifs : puces, tirets, icônes)
      - Surface < 2 500 px² ignorée (ex. 40×40 = 1 600 px²)
      Évite les vignettes cassées dans la galerie du viewer.
    """
    MIN_DIM = 50    # px — dimension minimale (largeur ET hauteur)
    MIN_AREA = 2500 # px² — surface minimale

    figures: list[dict[str, Any]] = []
    for i, pic in enumerate(doc.pictures):
        fig_id = f"f_{fig_offset + i}"
        page, bbox = _provenance(pic)
        if page is not None:
            page = page + page_offset
        caption = pic.caption_text(doc) if hasattr(pic, "caption_text") else ""
        img_path = figures_dir / f"{fig_id}.png"

        # ── Extraire l'image et vérifier sa taille ────────────────────────────
        img_saved = False
        try:
            img = pic.get_image(doc) if hasattr(pic, "get_image") else None
            if img is not None:
                w, h = img.size
                if w >= MIN_DIM and h >= MIN_DIM and w * h >= MIN_AREA:
                    img.save(img_path)
                    img_saved = True
                else:
                    print(f"[pipeline] Figure {fig_id} ignoree - trop petite ({w}x{h} px)")
        except Exception:
            pass

        # Sauter les figures sans image valide (évite les vignettes cassées)
        if not img_saved:
            continue

        # LaTeX-OCR : uniquement à la demande explicite (bouton dans le viewer)
        latex = _latex_ocr_figure(img_path) if (do_latex_ocr and img_path.exists()) else None

        # Florence-2 captioning : actif si FLORENCE2_CAPTION=1
        caption_ai: str | None = None
        if FLORENCE2_CAPTION and img_saved:
            try:
                from PIL import Image as _PIL
                caption_ai = _florence_caption(_PIL.open(img_path))
            except Exception:
                pass

        figures.append({
            "id": fig_id,
            "page": page,
            "bbox": bbox,
            "caption": caption or "",
            **({"caption_ai": caption_ai} if caption_ai else {}),
            **({"latex": latex} if latex else {}),
        })
    return figures


def _extraire_tables_doc(
    doc, page_offset: int, tbl_offset: int  # noqa: ANN001
) -> list[dict[str, Any]]:
    """Extrait les tables d'un DoclingDocument avec leur HTML et métadonnées."""
    tables: list[dict[str, Any]] = []
    for i, table in enumerate(doc.tables):
        tbl_id = f"t_{tbl_offset + i}"
        page, bbox = _provenance(table)
        if page is not None:
            page = page + page_offset

        caption = table.caption_text(doc) if hasattr(table, "caption_text") else ""

        html = ""
        try:
            # doc argument requis depuis Docling 2.x (deprecated sans)
            html = table.export_to_html(doc)
        except TypeError:
            try:
                html = table.export_to_html()
            except Exception:
                pass
        except Exception:
            pass

        n_rows, n_cols = 0, 0
        try:
            if hasattr(table, "data") and table.data is not None:
                n_rows = table.data.num_rows
                n_cols = table.data.num_cols
        except Exception:
            pass

        if not html and n_rows == 0:
            continue  # table vide / non extraite, on ignore

        tables.append({
            "id": tbl_id,
            "page": page,
            "bbox": bbox,
            "caption": caption or "",
            "html": html,
            "n_rows": n_rows,
            "n_cols": n_cols,
        })
    return tables


# ═══════════════════════════════════════════════════════════════════════════════
# LATEX-OCR (pix2tex) — optionnel, lazy-loaded
# ═══════════════════════════════════════════════════════════════════════════════

_latex_model = None
_latex_model_loaded = False


# Caractères Unicode que KaTeX ne reconnaît pas → équivalents LaTeX
_UNICODE_TO_LATEX: dict[str, str] = {
    ' ': ' ',            # espace insécable
    '​': '',             # espace de largeur nulle
    '†': r'\dagger{}',   # †
    '′': "'",            # ′ prime
    '˙': r'\dot ',       # ˙ point au-dessus
    'ˉ': r'\bar ',       # ˉ macron
    'ˊ': r'\acute ',     # ˊ accent aigu
    '∅': r'\emptyset{}', # ∅
    '⊤': r'\top{}',      # ⊤
    '⊥': r'\bot{}',      # ⊥
}


def _sanitize_latex(latex: str) -> str:
    """Nettoie le LaTeX généré par pix2tex pour éviter les erreurs KaTeX.

    Corrections appliquées :
    - Caractères Unicode → commandes LaTeX équivalentes
    - {array} avec trop peu de colonnes → colonne spec étendue automatiquement
    """
    if not latex:
        return latex

    for char, repl in _UNICODE_TO_LATEX.items():
        latex = latex.replace(char, repl)

    # Corriger \begin{array}{spec} quand spec a moins de colonnes que de & par ligne
    def _fix_array(m: re.Match) -> str:
        spec, body = m.group(1), m.group(2)
        col_letters = [c for c in spec if c in 'clr']
        rows = [r for r in body.split('\\\\') if r.strip()]
        max_cols = max((row.count('&') + 1 for row in rows), default=1)
        if len(col_letters) < max_cols:
            spec = 'c' * max_cols
        return r'\begin{array}{' + spec + '}' + body + r'\end{array}'

    latex = re.sub(
        r'\\begin\{array\}\{([^}]*)\}(.*?)\\end\{array\}',
        _fix_array,
        latex,
        flags=re.DOTALL,
    )

    return latex


def _pix2tex_predict(model, img):
    """Call pix2tex without letting it overwrite the system clipboard.

    pix2tex unconditionally calls clipboard.copy(pred) after every prediction.
    We neutralise that by temporarily replacing the copy function.
    Result is passed through _sanitize_latex to fix common KaTeX-incompatible outputs.
    """
    try:
        import pandas.io.clipboard as _cb
        _orig = _cb.copy
        _cb.copy = lambda *a, **kw: None
        try:
            result = model(img)
        finally:
            _cb.copy = _orig
    except Exception:
        result = model(img)
    return _sanitize_latex(result) if result else result


def _init_latex_ocr():
    global _latex_model, _latex_model_loaded
    if not _latex_model_loaded:
        _latex_model_loaded = True
        try:
            from pix2tex.cli import LatexOCR  # type: ignore
            _latex_model = LatexOCR()
            print("[pipeline] pix2tex charge - LaTeX-OCR active")
        except ImportError:
            _latex_model = None


def _latex_ocr_figure(img_path: Path) -> str | None:
    """Extrait du LaTeX depuis une figure PNG via le moteur actif (FORMULA_ENGINE).

    Heuristique : skip les images trop carrées ou trop grandes (photos/schémas).
    Texify tolère un ratio plus large (≤ 0.85) que pix2tex (≤ 0.6).
    """
    try:
        from PIL import Image
        img = Image.open(img_path)
        w, h = img.size
        max_ratio = 0.85 if _resolve_engine() == "texify" else 0.6
        if h > w * max_ratio or w * h > 2_000_000:
            return None
        return _latex_ocr_single(img)
    except Exception:
        return None


# ═══════════════════════════════════════════════════════════════════════════════
# NETTOYAGE TEXTE PDF NATIF
# ═══════════════════════════════════════════════════════════════════════════════

def _merge_pdf_lines(raw: str) -> str:
    """Fusionne les sauts de ligne visuels d'un PDF en vrais paragraphes.

    pypdfium2 retourne chaque ligne visuelle séparée par \\n (ou \\r\\n).
    Cette fonction détecte les fins de paragraphe réelles (ligne courte,
    ponctuation finale, saut de ligne double) et fusionne le reste avec espace.
    """
    # Normaliser les fins de ligne
    text = raw.replace("\r\n", "\n").replace("\r", "\n")
    # Séparer les blocs déjà délimités par des lignes vides
    raw_blocks = re.split(r"\n{2,}", text)

    paragraphs: list[str] = []
    for block in raw_blocks:
        lines = [l.rstrip() for l in block.split("\n") if l.strip()]
        if not lines:
            continue
        merged: list[str] = []
        buf = ""
        for i, line in enumerate(lines):
            if not buf:
                buf = line
                continue
            prev = buf
            # Trait d'union de coupure de mot → coller sans espace
            if prev.endswith("-"):
                buf = prev[:-1] + line
            # Fin de phrase / ligne courte → nouveau paragraphe
            elif prev[-1] in ".!?:" and (len(prev) < 72 or line[0].isupper()):
                merged.append(buf)
                buf = line
            # Ligne de titre courte (< 60 car, pas de ponctuation finale)
            elif len(prev) < 60 and prev[-1] not in ",;(":
                merged.append(buf)
                buf = line
            else:
                buf = prev + " " + line
        if buf:
            merged.append(buf)
        paragraphs.append("\n".join(merged))

    return "\n\n".join(p for p in paragraphs if p.strip())


# ═══════════════════════════════════════════════════════════════════════════════
# SPLIT PDF EN TRANCHES
# ═══════════════════════════════════════════════════════════════════════════════

def _split_pdf(pdf_path: Path, start: int, end: int, tmp_dir: Path) -> Path:
    with _PDFIUM_LOCK:
        src = pdfium.PdfDocument(str(pdf_path))
        dst = pdfium.PdfDocument.new()
        dst.import_pages(src, list(range(start, min(end, len(src)))))
        out = tmp_dir / f"chunk_{start}_{end}.pdf"
        dst.save(str(out))
        src.close()
        dst.close()
    return out


# ═══════════════════════════════════════════════════════════════════════════════
# POINT D'ENTRÉE PRINCIPAL
# ═══════════════════════════════════════════════════════════════════════════════

def convertir_pdf(
    pdf_path: Path,
    out_dir: Path,
    progress_callback: Optional[Callable[[int, str], None]] = None,
    fast_mode: bool = False,
    force_ocr: bool = False,
) -> dict[str, Any]:
    """Convertit un PDF. Choisit automatiquement le mode fast (natif) ou Docling (scanné).

    force_ocr=True : force le mode Docling avec OCR activé, même si le PDF est natif.
    Utile pour les PDFs hybrides (corps natif + pièces jointes scannées).
    """
    _log_memory("pipeline start")
    if progress_callback:
        progress_callback(5, "Initialisation de la structure PDF...")

    # Lire les dimensions de pages + détecter si natif
    src = pdfium.PdfDocument(str(pdf_path))
    n_total_pages = len(src)
    if progress_callback:
        progress_callback(10, f"Analyse préliminaire : {n_total_pages} pages...")
    pages_info: list[dict[str, Any]] = []
    chars = 0
    for pno in range(n_total_pages):
        page = src[pno]
        w, h = page.get_size()
        pages_info.append({"number": pno + 1, "width": w, "height": h})
        if pno < 3:
            tp = page.get_textpage()
            chars += len(tp.get_text_range())
            tp.close()

    # Item 9 : titre du document depuis les métadonnées PDF (avant src.close())
    try:
        pdf_title = (src.get_metadata_value("Title") or "").strip()
        # Supprime les préfixes "Microsoft Word/PowerPoint/Excel - " indésirables
        pdf_title = re.sub(r'^(Microsoft\s+(?:Word|PowerPoint|Excel)\s*-\s*)', '', pdf_title, flags=re.IGNORECASE).strip()
    except Exception:
        pdf_title = ""
    src.close()

    if fast_mode:
        print(f"[pipeline] Fast mode active: skipping Docling completely for {pdf_path.name}")
        if progress_callback:
            progress_callback(30, "Fast Mode: Extraction du texte brut et du sommaire...")
            
        src2 = pdfium.PdfDocument(str(pdf_path))
        page_texts: list[str] = []
        for pno in range(n_total_pages):
            tp = src2[pno].get_textpage()
            page_texts.append(tp.get_text_range())
            tp.close()
        toc = list(src2.get_toc())
        outline = _toc_vers_outline(toc) if toc else _outline_depuis_texte(page_texts)
        src2.close()
        
        fallback_md = "\n\n".join(
            _merge_pdf_lines(t) for t in page_texts if t.strip()
        )
        (out_dir / "result.md").write_text(_clean_markdown(fallback_md), encoding="utf-8")
        
        # Generer un html simple avec marqueurs de page pour que le reader puisse paginer
        html_parts = []
        for pno, text in enumerate(page_texts):
            pg = pno + 1
            cleaned_text = _merge_pdf_lines(text)
            escaped = html.escape(cleaned_text).replace("\n", "<br>")
            part = (
                f'<div class="pdf-page-sep" data-page="{pg}" id="pdf-p-{pg}"></div>'
                f'<div class="docling-page" data-page-no="{pg}">'
                f'<p>{escaped}</p>'
                f'</div>'
            )
            html_parts.append(part)
            
        html_body = "\n".join(html_parts)
        html_content = (
            "<!DOCTYPE html><html><head><meta charset='utf-8'>"
            "<style>body{font-family:sans-serif;max-width:900px;margin:0 auto;padding:1rem}</style>"
            f"</head><body>{html_body}</body></html>"
        )
        (out_dir / "result.html").write_text(html_content, encoding="utf-8")
        (out_dir / "html_part_0001.html").write_text(html_content, encoding="utf-8")
        
        html_manifest = [{"start": 1, "end": n_total_pages, "file": "html_part_0001.html"}]
        (out_dir / "html_manifest.json").write_text(json.dumps(html_manifest), encoding="utf-8")
        
        if progress_callback:
            progress_callback(100, "Traitement termine.")
            
        _log_memory("pipeline end")
        return {
            "pages": pages_info,
            "outline": outline,
            "figures": [],
            "tables": [],
            "n_pages": n_total_pages,
            "n_figures": 0,
            "n_tables": 0,
            "extraction_mode": "fast",
            "pdf_title": pdf_title,
            "pipeline_version": PIPELINE_VERSION,
        }

    is_native = chars > _NATIVE_CHAR_MIN
    if force_ocr and is_native:
        is_native = False
        print(f"[pipeline] force_ocr=True → mode Docling+OCR forcé (PDF hybride détecté comme natif)")
    print(f"[pipeline] {n_total_pages} pages, {chars} chars/3p -> {'natif (hybrid)' if is_native else 'scanne (docling)'}")

    figures_dir = out_dir / "figures"
    figures_dir.mkdir(exist_ok=True)

    all_figures: list[dict[str, Any]] = []
    all_tables: list[dict[str, Any]] = []
    outline: list[dict[str, Any]] = []
    extraction_mode = "native" if is_native else "docling"

    try:
        all_md_parts: list[str] = []
        all_html_parts: list[str] = []
        all_html_page_starts: list[int] = []   # 1-indexed PDF page start for each html part
        docling_sections: list[dict[str, Any]] = []

        # ── Outline + texte via pypdfium2 pour PDFs natifs (rapide, précis) ─────
        native_fallback_md: str = ""
        if is_native:
            src2 = pdfium.PdfDocument(str(pdf_path))
            page_texts: list[str] = []
            for pno in range(n_total_pages):
                tp = src2[pno].get_textpage()
                page_texts.append(tp.get_text_range())
                tp.close()
            toc = list(src2.get_toc())
            native_outline = _toc_vers_outline(toc) if toc else _outline_depuis_texte(page_texts)
            src2.close()
            # Texte nettoyé : lignes visuelles fusionnées en vrais paragraphes
            native_fallback_md = "\n\n".join(
                _merge_pdf_lines(t) for t in page_texts if t.strip()
            )

        # ── Docling : figures + tables (toujours) ; outline/texte si scanné ──────
        # Piste C : les batches s'exécutent en parallèle (DOCLING_WORKERS workers).
        # Chaque worker crée son propre DocumentConverter (thread-safe).
        do_ocr = not is_native
        n_batches = (n_total_pages + BATCH_SIZE - 1) // BATCH_SIZE
        effective_workers = min(DOCLING_WORKERS, n_batches)

        with tempfile.TemporaryDirectory() as tmp_dir_str:
            tmp_dir = Path(tmp_dir_str)

            if progress_callback:
                progress_callback(15, f"Analyse & OCR ({n_total_pages} pages, {effective_workers} workers)...")

            def _run_one_batch(batch_start: int) -> dict[str, Any]:
                """Traite un batch Docling. Thread-safe : converter créé localement."""
                batch_end = min(batch_start + BATCH_SIZE, n_total_pages)
                t_batch_start = time.perf_counter()
                print(f"[pipeline] Docling pages {batch_start+1}-{batch_end}/{n_total_pages}...")

                batch_conv = _converter(do_ocr=do_ocr)

                html_parts_local: list[tuple[int, str]] = []
                md_parts_local:   list[str]              = []
                figures_local:    list[dict[str, Any]]   = []
                tables_local:     list[dict[str, Any]]   = []
                sections_local:   list[dict[str, Any]]   = []

                def _harvest(doc, page_start: int) -> None:
                    # LaTeX-OCR item-level : collecte toutes les formules non décodées
                    # puis appel batch unique (Texify) ou séquentiel (pix2tex).
                    if PIX2TEX_FALLBACK:
                        formula_items: list[tuple[Any, Any]] = []  # (item, PIL image)
                        for item, _lvl in doc.iterate_items():
                            label_str = str(getattr(item, "label", "") or "").lower()
                            if "formula" not in label_str and "equation" not in label_str:
                                continue
                            text = (getattr(item, "text", "") or "").strip()
                            if text and "not decoded" not in text.lower() and len(text) > 3:
                                continue
                            try:
                                img = item.get_image(doc)
                                if img is not None:
                                    formula_items.append((item, img))
                            except Exception:
                                pass

                        if formula_items:
                            imgs   = [it[1] for it in formula_items]
                            latexs = _latex_ocr_batch(imgs)
                            n_decoded = 0
                            for (item, _img), latex in zip(formula_items, latexs):
                                if latex and 3 <= len(latex) <= 600:
                                    item.text = f"$${latex}$$"
                                    n_decoded += 1
                            if n_decoded:
                                engine = _resolve_engine()
                                print(f"[pipeline] {engine} : {n_decoded} formule(s) batch {batch_start+1}-{batch_end}")

                    if not is_native:
                        sections_local.extend(_extraire_sections_doc(doc, page_start - 1, 0))

                    try:
                        md_parts_local.append(doc.export_to_markdown())
                    except Exception:
                        pass

                    html_str = None
                    try:
                        from docling_core.types.doc import ImageRefMode
                        html_str = doc.export_to_html(image_mode=ImageRefMode.EMBEDDED, split_page_view=True)
                    except Exception:
                        try:
                            html_str = doc.export_to_html(split_page_view=True)
                        except Exception:
                            pass
                    if html_str:
                        html_parts_local.append((page_start, html_str))

                    figures_local.extend(_extraire_figures_doc(doc, page_start - 1, 0, figures_dir))
                    tables_local.extend(_extraire_tables_doc(doc, page_start - 1, 0))

                chunk_path = _split_pdf(pdf_path, batch_start, batch_end, tmp_dir)
                try:
                    t_ocr = time.perf_counter()
                    doc = batch_conv.convert(str(chunk_path)).document
                    print(f"[pipeline] OCR batch {batch_start+1}-{batch_end} : {time.perf_counter()-t_ocr:.1f}s")
                    _harvest(doc, batch_start + 1)
                except Exception as e:
                    print(f"[pipeline] Erreur tranche {batch_start+1}-{batch_end}: {e}")
                    print(f"[pipeline] Retry page par page sur {batch_start+1}-{batch_end}...")
                    for single_page in range(batch_start, batch_end):
                        try:
                            single_path = _split_pdf(pdf_path, single_page, single_page + 1, tmp_dir)
                            sdoc = batch_conv.convert(str(single_path)).document
                            _harvest(sdoc, single_page + 1)
                        except Exception as pe:
                            print(f"[pipeline] Page {single_page+1} ignoree : {pe}")

                print(f"[pipeline] batch {batch_start+1}-{batch_end} termine en {time.perf_counter()-t_batch_start:.1f}s")
                return {
                    "batch_start":  batch_start,
                    "html_parts":   html_parts_local,
                    "md_parts":     md_parts_local,
                    "figures":      figures_local,
                    "tables":       tables_local,
                    "sections":     sections_local,
                }

            batch_starts = list(range(0, n_total_pages, BATCH_SIZE))
            t_docling_start = time.perf_counter()
            with ThreadPoolExecutor(max_workers=effective_workers) as pool:
                batch_results = sorted(
                    pool.map(_run_one_batch, batch_starts),
                    key=lambda r: r["batch_start"],
                )
            print(f"[pipeline] Docling total : {time.perf_counter()-t_docling_start:.1f}s ({effective_workers} workers, {len(batch_starts)} batches)")
            _log_memory("after Docling batches")

            # ── Fusion des résultats dans l'ordre, recalcul des offsets d'ID ─────
            fig_offset = tbl_offset = prev_sec_count = 0
            for res in batch_results:
                # Renumérote les figures/tables séquentiellement (offset=0 dans workers)
                for j, fig in enumerate(res["figures"]):
                    fig["id"] = f"f_{fig_offset + j}"
                fig_offset += len(res["figures"])
                all_figures.extend(res["figures"])

                for j, tbl in enumerate(res["tables"]):
                    tbl["id"] = f"t_{tbl_offset + j}"
                tbl_offset += len(res["tables"])
                all_tables.extend(res["tables"])

                # Schéma × 100 préservé : chaque slot peut avoir jusqu'à 100 sections
                for j, sec in enumerate(res["sections"]):
                    sec["id"] = f"s_{prev_sec_count * 100 + j}"
                prev_sec_count += len(res["sections"])
                docling_sections.extend(res["sections"])

                all_md_parts.extend(res["md_parts"])
                for page_start, html_str in res["html_parts"]:
                    all_html_parts.append(html_str)
                    all_html_page_starts.append(page_start)

            if not is_native and len(all_html_parts) == 0:
                raise RuntimeError("Docling failed to extract any pages")


        if progress_callback:
            progress_callback(90, "Reconstruction du sommaire...")

        if is_native:
            outline = native_outline
        else:
            # TD-007 : sur les documents courts (≤ 3 pages), Docling sur-détecte les
            # SectionHeader sur CV, lettres, formulaires (rubrique "Experience", "Objet:", etc.).
            # Filtre : garder uniquement les sections avec un préfixe numéroté ou une annexe.
            if n_total_pages <= 3 and docling_sections:
                numbered = [s for s in docling_sections
                            if _SECTION_PREFIX.match(s["title"])
                            or _TOP_CHAPTER_PREFIX.match(s["title"])
                            or _ANNEX_PREFIX.match(s["title"])
                            or _CHAPTER_PREFIX.match(s["title"])]
                if len(numbered) < len(docling_sections):
                    print(f"[pipeline] TD-007 : doc court ({n_total_pages}p), "
                          f"{len(docling_sections) - len(numbered)} section(s) non numérotée(s) filtrée(s)")
                    docling_sections = numbered
            outline = _construire_outline(docling_sections)

        if progress_callback:
            progress_callback(95, "Génération des documents Markdown et HTML...")

        # ── Écriture result.md ───────────────────────────────────────────────────
        # Si disponible, utiliser le markdown riche de Docling (avec formules/tables).
        # Sinon, fallback sur le texte brut pypdfium2 (pour les natifs) ou ce qui a été collecté.
        if all_md_parts:
            (out_dir / "result.md").write_text(_clean_markdown("\n\n".join(all_md_parts)), encoding="utf-8")
        elif is_native and native_fallback_md:
            (out_dir / "result.md").write_text(_clean_markdown(native_fallback_md), encoding="utf-8")

        # ── Écriture result.html : HTML Docling (tous les PDFs) ─────────────────
        # Chaque partie est un document HTML complet — extraire seulement le <body>
        if all_html_parts:
            try:
                _re = re  # alias local (re est importé au niveau module)

                def _extract_body(html: str) -> str:
                    m = _re.search(r"<body[^>]*>(.*?)</body>", html, _re.DOTALL | _re.IGNORECASE)
                    return m.group(1) if m else html

                def _fix_formula_html(html: str) -> str:
                    """Convertit les éléments formula-not-decoded décodés par pix2tex.

                    Quand pix2tex réussit à décoder une formule, il place le LaTeX dans
                    item.text sous la forme '$$...$$'. Docling exporte quand même l'élément
                    avec la classe 'formula-not-decoded'. Cette fonction :
                      1. Détecte les éléments formula-not-decoded dont le contenu commence
                         par $$ (LaTeX display) ou $ (LaTeX inline).
                      2. Remplace leur classe par 'formula' → CSS blue-box + KaTeX auto-render.
                    Les éléments dont le contenu est encore "formula not decoded" (pix2tex
                    n'a pas pu décoder) conservent leur classe et s'affichent en puce discrète.
                    """
                    def _replace(m) -> str:
                        tag, attrs, content = m.group(1), m.group(2), m.group(3)
                        if _RE_LATEX_START.search(content):  # module-level pre-compiled (Piste A)
                            # Remplacer la classe formula-not-decoded par formula
                            new_attrs = _re.sub(
                                r'\bformula-not-decoded\b', 'formula', attrs
                            )
                            return f'<{tag}{new_attrs}>{content}</{tag}>'
                        return m.group(0)

                    return _re.sub(
                        r'<(div|span)([^>]*\bformula-not-decoded\b[^>]*)>(.*?)</\1>',
                        _replace,
                        html,
                        flags=_re.DOTALL,
                    )

                def _convert_figure_formulas(html: str) -> str:
                    """Convertit les figures-formules (sans figcaption) via LaTeX-OCR.

                    Collecte tous les candidats (figures sans légende, ratio largeur/hauteur ≥ 1.0),
                    puis appel batch unique à _latex_ocr_batch (Texify ou pix2tex).
                    Doit tourner AVANT _deembed_images (images encore en base64).
                    """
                    if not PIX2TEX_FALLBACK:
                        return html

                    import html as _hl
                    from PIL import Image
                    import io as _io

                    all_matches = list(_RE_FIG_FIGURE.finditer(html))
                    if not all_matches:
                        return html

                    # Étape 1 : identifier les candidats formules avec leur PIL Image
                    tasks: list[tuple[int, Any]] = []  # (match_idx, PIL Image)
                    for idx, m in enumerate(all_matches):
                        content = m.group(1)
                        if '<figcaption' in content.lower():
                            continue
                        b64m = _RE_FIG_B64.search(content)
                        if not b64m:
                            continue
                        try:
                            img = Image.open(_io.BytesIO(base64.b64decode(b64m.group(1))))
                            w, h = img.size
                            # Texify gère les ratios plus larges ; pix2tex nécessite ≥ 1.2
                            min_ratio = 1.0 if _resolve_engine() == "texify" else 1.2
                            if h == 0 or w / h < min_ratio or w * h > 1_500_000:
                                continue
                            tasks.append((idx, img))
                        except Exception:
                            continue

                    if not tasks:
                        return html

                    # Étape 2 : batch LaTeX-OCR (un seul appel pour tous les candidats)
                    imgs    = [t[1] for t in tasks]
                    latexs  = _latex_ocr_batch(imgs)

                    replacements: dict[int, str] = {}
                    for (task_idx, _img), latex in zip(tasks, latexs):
                        if not latex:
                            continue
                        # Stripping outer $...$ — batch functions may or may not add them
                        if latex.startswith('$$') and latex.endswith('$$'):
                            latex = latex[2:-2].strip()
                        elif latex.startswith('$') and latex.endswith('$'):
                            latex = latex[1:-1].strip()
                        if len(latex) < 3:
                            continue
                        replacements[task_idx] = (
                            f'<div class="formula">'
                            f'<math xmlns="http://www.w3.org/1998/Math/MathML" display="block">'
                            f'<annotation encoding="TeX">$${_hl.escape(latex)}$$</annotation>'
                            f'</math></div>'
                        )

                    if not replacements:
                        return html

                    # Étape 3 : reconstruire le HTML en une seule passe
                    out: list[str] = []
                    prev = 0
                    n_conv = 0
                    for idx, m in enumerate(all_matches):
                        out.append(html[prev:m.start()])
                        if idx in replacements:
                            out.append(replacements[idx])
                            n_conv += 1
                        else:
                            out.append(m.group(0))
                        prev = m.end()
                    out.append(html[prev:])

                    if n_conv:
                        print(f"[pipeline] figure->formule pix2tex : {n_conv} converties")
                    return "".join(out)

                def _clean_html_spaces(html: str) -> str:
                    """Supprime les doubles espaces résidus d'extraction PDF."""
                    html = _re.sub(r'(?<![<>])  +(?![<>])', ' ', html)
                    return html

                def _annotate_split_page_divs(html: str, batch_page_start: int) -> str:
                    """Remplace les <div class='page'> de Docling par des marqueurs numérotés.

                    Avec split_page_view=True, Docling ajoute AVANT chaque <div class='page'>
                    une image PNG rasterisée pleine page (miniature). Ces images sont
                    supprimées ici avant d'injecter les marqueurs pdf-page-sep (FIX-016).
                    """
                    page_counter = [batch_page_start]

                    def inject(m):
                        pg = page_counter[0]
                        page_counter[0] += 1
                        sep = (
                            f'<div class="pdf-page-sep" data-page="{pg}" '
                            f'id="pdf-p-{pg}"></div>'
                        )
                        return sep + f'<div class="docling-page" data-page-no="{pg}">'

                    # Supprimer les images pleine-page et placeholders générés par split_page_view
                    # AVANT les <div class='page'> : ces éléments sont les miniatures non désirées.
                    # Pattern : (optionnel : <img...> ou <figure>no page-image found</figure>)
                    #           suivi de <div class='page'>
                    html = _re.sub(
                        r'(?:<figure>\s*no page-image found\s*</figure>|'
                        r'<img[^>]+>\s*|'
                        r'<figure[^>]*>\s*<img[^>]+>\s*</figure>\s*)*'
                        r'(<div\s+class=[\'"]page[\'"]>)',
                        lambda m2: m2.group(1),  # garde seulement le <div class='page'>
                        html,
                        flags=_re.DOTALL,
                    )

                    result = _re.sub(r"<div\s+class=['\"]page['\"]>", inject, html)

                    # PASS 2 : strip la première figure embedded qui apparaît
                    # DANS chaque <div class="docling-page"> (variante Docling récente :
                    # le raster pleine-page est placé comme premier enfant du page-div,
                    # pas avant lui). On supprime si et seulement si elle n'a pas de
                    # <figcaption> (les figures de contenu ont toujours une légende).
                    def _maybe_strip_inner_raster(m3):
                        whole = m3.group(0)
                        if '<figcaption' in whole:
                            return whole  # garder : légende présente → figure de contenu
                        return m3.group(1)  # supprimer : sans légende → raster pleine-page

                    result = _re.sub(
                        r'(<div\s+class="docling-page"[^>]*>)\s*'
                        r'<figure[^>]*>\s*<img\s[^>]*src="data:image[^"]*"[^>]*/?\s*>\s*</figure>',
                        _maybe_strip_inner_raster,
                        result,
                        flags=_re.DOTALL,
                    )

                    # Fallback : si Docling ne produit pas de <div class='page'>,
                    # insérer un seul marqueur en début de contenu
                    if page_counter[0] == batch_page_start:
                        sep = (
                            f'<div class="pdf-page-sep" data-page="{batch_page_start}" '
                            f'id="pdf-p-{batch_page_start}"></div>'
                        )
                        result = sep + result
                    return result

                def _fix_toc_entries(html: str) -> str:
                    """Supprime les points de conduite (dot-leaders) des entrées de sommaire.

                    Docling préserve le texte littéral du sommaire PDF, y compris les
                    successions de points "....." utilisées comme séparateur titre/numéro
                    de page. Exemple : "7. Results and reports .....47"
                    → "7. Results and reports"
                    FIX-014
                    """
                    # Supprime les séquences de ≥3 points (possiblement entrecoupés d'espaces)
                    # suivies d'un numéro de page optionnel en fin de paragraphe <p> ou cellule <td>
                    # Pattern : point+espace répétés, puis chiffres éventuels, en fin de ligne texte
                    def _strip_leaders(m: "_re.Match[str]") -> str:
                        inner = m.group(1)
                        # Supprime les dot-leaders et numéros de page finaux
                        cleaned = _re.sub(r'[\s.·•\u00B7\u2022]{3,}\s*\d*\s*(?=\||$|\n)|[\s.·•\u00B7\u2022]{5,}\s*\d*\s*', '', inner).rstrip()
                        if cleaned:
                            # FIX-046: tag as toc-entry so frontend can detect TOC pages
                            # structurally, independent of heading name/language.
                            return f'<p class="toc-entry">{cleaned}</p>'
                        return ''  # paragraphe vide → supprimé

                    # Traite uniquement les <p> courts (typiques d'une ligne de sommaire)
                    def _maybe_strip(m: "_re.Match[str]") -> str:
                        inner = m.group(1)
                        # S'il y a au moins 3 points consécutifs → c'est une ligne de TOC
                        if _re.search(r'\.{3,}|(?:[\s\.]{2,}\d+\s*$)', inner):
                            return _strip_leaders(m)
                        return m.group(0)

                    # Traite également les cellules <td> courtes du sommaire imprimé
                    def _maybe_strip_td(m: "_re.Match[str]") -> str:
                        attrs = m.group(1)
                        inner = m.group(2)
                        if _re.search(r'\.{3,}|(?:[\s\.]{2,}\d+\s*$)', inner):
                            cleaned = _re.sub(r'[\s.·•\u00B7\u2022]{3,}\s*\d*\s*(?=\||$|\n)|[\s.·•\u00B7\u2022]{5,}\s*\d*\s*', '', inner).rstrip()
                            return f'<td{attrs}>{cleaned}</td>'
                        return m.group(0)

                    html = _re.sub(r'<p>([^<]{0,1000})</p>', _maybe_strip, html)
                    html = _re.sub(r'<td([^>]*)>([^<]{0,1000})</td>', _maybe_strip_td, html)

                    # PASS 2 : éclater les paragraphes TOC concaténés sans séparateur.
                    # Docling peut agréger toute une page de sommaire en un seul gros <p>
                    # sans retour à la ligne entre les entrées. Ex :
                    #   "1. Welcome to Advance Design 20262.1Composite beams2.2Modeling..."
                    # Détection : paragraphe long contenant ≥ 3 motifs "N.M".
                    # Division : insérer \n avant chaque numéro de section collé au texte.
                    def _split_concat_toc_para(m_p: "_re.Match[str]") -> str:
                        full  = m_p.group(0)   # <p...>...</p>
                        attrs = m_p.group(1)   # attributs éventuels du <p>
                        inner = m_p.group(2)   # contenu brut entre <p> et </p>
                        # Pas de <p> imbriqué (tableaux / listes imbriquées)
                        if '<p' in inner:
                            return full
                        # Texte brut pour l'analyse
                        text = _re.sub(r'<[^>]+>', '', inner)
                        if len(text) < 100:
                            return full  # paragraphe court → pas concaténé
                        # Au moins 3 numéros de section "N.M" pour être un TOC concaténé
                        if len(_re.findall(r'\d+\.\d', text)) < 3:
                            return full
                        # Insérer un saut avant chaque nouveau numéro de section
                        # collé directement au texte précédent (pas d'espace intermédiaire) :
                        #   "beams2.2Modeling"  → "beams\n2.2Modeling"
                        #   "20262.1Composite"  → "2026\n2.1Composite"
                        split = _re.sub(
                            # FIX-025 : \d+(?:\.\d+)+ couvre les numéros 2 niveaux (6.1) ET plus (6.1.1).
                            r'([A-Za-zÀ-ÿ\d])(\d+(?:\.\d+)+\s*[A-ZÀ-ÿ])',
                            lambda s: s.group(1) + '\n' + s.group(2),
                            text,
                        )
                        if split == text:
                            return full  # aucun changement → laisser tel quel
                        lines = [l.strip() for l in split.split('\n') if l.strip()]
                        if len(lines) < 2:
                            return full
                        tag_open = f'<p{attrs}>'
                        return tag_open + f'</p>\n{tag_open}'.join(lines) + '</p>'

                    # Applique sur tous les <p> longs ; la fonction filtre en interne.
                    html = _re.sub(
                        r'<p([^>]*?)>([\s\S]{100,}?)</p>',
                        _split_concat_toc_para,
                        html,
                    )
                    return html

                def _fix_bullet_lists(html: str) -> str:
                    """Supprime les caractères de puce PDF intégrés dans les <li> Docling.

                    Docling préserve les caractères de puce du PDF (·, •, ○, ▪, et le
                    caractère "o" utilisé comme puce de sous-liste dans les docs Word/PDF)
                    comme premier caractère du texte des éléments de liste.
                    Le CSS `li::marker` ajoute déjà un symbole de puce → double puce.
                    Cette fonction supprime le caractère redondant du texte brut.
                    """
                    # Caractères de puce Unicode courants dans les PDFs
                    bullet_pattern = r'[·•‣◦▪●■·•‣◦▪●■]'

                    def strip_li_bullet(m: "_re.Match[str]") -> str:
                        attrs = m.group(1)
                        content = m.group(2)
                        # Supprimer une puce Unicode en début de contenu
                        content = _re.sub(rf'^\s*{bullet_pattern}\s*', '', content)
                        # Supprimer "o " comme puce de sous-liste (suivi d'une lettre majuscule)
                        content = _re.sub(r'^\s*o\s+(?=[A-ZÀ-Ü])', '', content)
                        return f'<li{attrs}>{content}</li>'

                    return _re.sub(
                        r'<li([^>]*)>(.*?)</li>',
                        strip_li_bullet,
                        html,
                        flags=_re.DOTALL,
                    )

                def _deembed_images(html: str, images_dir: Path, doc_id: str, batch_idx: int) -> str:
                    """Remplace les data URI base64 par des URLs API servies depuis le disque.

                    FIX-035 : Réduit la taille des fichiers HTML de 50-600 MB à quelques KB
                    en extrayant chaque image base64 vers html_images/bN/NNNNNN.png et en
                    remplaçant le src par /doc/{doc_id}/html-image/bN/NNNNNN.png.
                    """
                    batch_dir = images_dir / f"b{batch_idx}"
                    batch_dir.mkdir(parents=True, exist_ok=True)
                    counter = [0]

                    def replace_src(m: "re.Match[str]") -> str:
                        data_uri = m.group(1)
                        try:
                            meta, b64data = data_uri.split(",", 1)
                            ext = "jpg" if ("/jpeg" in meta or "/jpg" in meta) else "png"
                            img_name = f"{counter[0]:06d}.{ext}"
                            raw = base64.b64decode(b64data)
                            (batch_dir / img_name).write_bytes(raw)
                            counter[0] += 1
                            # FIX-035 : émettre data-w/data-h pour que les filtres logos /
                            # dimensionnement du Reader fonctionnent sur les URLs de-embeddées.
                            dims = img_pixel_size(raw)
                            dim_attrs = f' data-w="{dims[0]}" data-h="{dims[1]}"' if dims else ""
                            return f'src="/doc/{doc_id}/html-image/b{batch_idx}/{img_name}"{dim_attrs}'
                        except Exception:
                            return m.group(0)

                    return _re.sub(r'src="(data:image/[^"]+)"', replace_src, html)

                def _strip_page_headers_footers(html: str) -> str:
                    """Supprime les entêtes et pieds de page récurrents dans le HTML Docling.

                    Docling inclut les éléments de mise en page (numéros de page,
                    en-têtes courants, logos de footer) comme du contenu normal.
                    On les supprime heuristiquement :
                      - <p> ou <span> contenant uniquement un numéro de page (ex: "1-1", "A-3")
                      - <p> courts en italique (<em>) seuls dans un bloc (en-têtes courants)
                      - <figure> sans vrai contenu texte dans leur légende (logos)
                    """
                    # 1. Numéros de page isolés : "1-1", "2-3", "A-1", "i", "ii"
                    html = _re.sub(
                        r'<p>\s*(?:<[^>]+>)*\s*\d+[-–]\d+\s*(?:</[^>]+>)*\s*</p>',
                        '', html
                    )
                    # 2. Paragraphes en italique courts (≤12 mots) → en-tête courant typique
                    html = _re.sub(
                        r'<p>\s*<em>([^<]{0,120})</em>\s*</p>',
                        lambda m: '' if len(m.group(1).split()) <= 12 else m.group(0),
                        html
                    )
                    return html

                # Chaque partie correspond à un batch ; on connaît sa page de départ
                # Fallback : si page_starts non synchronisé (erreurs), numéroter séquentiellement
                page_starts = all_html_page_starts if len(all_html_page_starts) == len(all_html_parts) \
                    else list(range(1, len(all_html_parts) + 1))

                _HTML_SHELL_OPEN = (
                    "<!DOCTYPE html><html><head><meta charset='utf-8'>"
                    "<style>body{font-family:sans-serif;max-width:900px;margin:0 auto;padding:1rem}"
                    "img{max-width:100%;height:auto;display:block;margin:0 auto}"
                    "table{border-collapse:collapse;width:100%}"
                    "td,th{border:1px solid #ccc;padding:4px 8px}"
                    "pre{overflow-x:auto}</style></head><body>"
                )

                # doc_id = dernier composant du chemin de cache (ex. "a1b2c3d4e5f6...")
                _doc_id_for_html = out_dir.name
                _html_images_dir = out_dir / "html_images"

                # Piste E : traitement + écriture de chaque partie HTML en parallèle.
                # Chaque partie est indépendante (fichier propre + répertoire b{i}/).
                def _process_and_write_part(i: int) -> dict[str, Any]:
                    part = all_html_parts[i]
                    body = _annotate_split_page_divs(_extract_body(part), page_starts[i])
                    body = _apply_combined_passes(body)   # Piste D : dblspace+formula+pgnum+italic
                    body = _fix_bullet_lists(body)
                    body = _fix_toc_entries(body)
                    body = _convert_figure_formulas(body)
                    body = _deembed_images(body, _html_images_dir, _doc_id_for_html, i)
                    page_start = page_starts[i]
                    page_end = (page_starts[i + 1] - 1) if i + 1 < len(page_starts) else n_total_pages
                    part_filename = f"html_part_{page_start:04d}.html"
                    (out_dir / part_filename).write_text(
                        _HTML_SHELL_OPEN + body + "</body></html>",
                        encoding="utf-8",
                    )
                    return {"start": page_start, "end": page_end, "file": part_filename}

                html_manifest: list[dict[str, Any]] = []
                part_indices = list(range(len(all_html_parts)))
                html_workers = min(DOCLING_WORKERS, len(part_indices)) if part_indices else 1
                with ThreadPoolExecutor(max_workers=html_workers) as pool:
                    # map() préserve l'ordre → manifest reste ordonné par page_start
                    html_manifest = list(pool.map(_process_and_write_part, part_indices))

                (out_dir / "html_manifest.json").write_text(
                    json.dumps(html_manifest, ensure_ascii=False),
                    encoding="utf-8",
                )
                # result.html = first part only (backward compat with old frontend / direct links)
                if html_manifest:
                    first_part = out_dir / html_manifest[0]["file"]
                    if first_part.exists():
                        import shutil as _shutil
                        _shutil.copy2(first_part, out_dir / "result.html")
            except Exception as e:
                print(f"[pipeline] Erreur écriture HTML: {e}")

        if progress_callback:
            progress_callback(100, "Traitement terminé.")

    except Exception as e:
        import traceback
        docling_error_msg = f"{type(e).__name__}: {str(e)}"
        print(f"[pipeline] Docling pipeline failed: {docling_error_msg}. Attempting fallback...")
        traceback.print_exc()

        if progress_callback:
            progress_callback(50, "Docling a échoué. Tentative de conversion de secours...")

        # 1. Fallback 1: MarkItDown
        try:
            print("[pipeline] Fallback 1: MarkItDown...")
            from markitdown import MarkItDown
            converter = MarkItDown()
            result = converter.convert(str(pdf_path))
            markdown_text = result.text_content or ""

            (out_dir / "result.md").write_text(_clean_markdown(markdown_text), encoding="utf-8")
            outline = _outline_from_markdown(markdown_text)
            extraction_mode = "markitdown_fallback"

            html_content = (
                "<!DOCTYPE html><html><head><meta charset='utf-8'>"
                "<style>body{font-family:sans-serif;max-width:900px;margin:0 auto;padding:1rem}</style>"
                "</head><body>" + html.escape(markdown_text).replace("\n", "<br>") + "</body></html>"
            )
            (out_dir / "result.html").write_text(html_content, encoding="utf-8")

            html_manifest = [{"start": 1, "end": n_total_pages, "file": "result.html"}]
            (out_dir / "html_manifest.json").write_text(json.dumps(html_manifest), encoding="utf-8")
            print("[pipeline] Fallback 1 (MarkItDown) réussi")
        except Exception as me:
            print(f"[pipeline] Fallback 1 (MarkItDown) a échoué: {me}. Tentative de secours ultime...")
            # 2. Fallback 2: pypdfium2 text + outline parsing
            try:
                if progress_callback:
                    progress_callback(80, "Secours ultime: extraction brute de texte...")

                src3 = pdfium.PdfDocument(str(pdf_path))
                page_texts: list[str] = []
                for pno in range(n_total_pages):
                    tp = src3[pno].get_textpage()
                    page_texts.append(tp.get_text_range())
                    tp.close()
                toc = list(src3.get_toc())
                outline = _toc_vers_outline(toc) if toc else _outline_depuis_texte(page_texts)
                src3.close()

                fallback_md = "\n\n".join(
                    _merge_pdf_lines(t) for t in page_texts if t.strip()
                )
                (out_dir / "result.md").write_text(_clean_markdown(fallback_md), encoding="utf-8")

                html_content = (
                    "<!DOCTYPE html><html><head><meta charset='utf-8'>"
                    "<style>body{font-family:sans-serif;max-width:900px;margin:0 auto;padding:1rem}</style>"
                    "</head><body>" + html.escape(fallback_md).replace("\n", "<br>") + "</body></html>"
                )
                (out_dir / "result.html").write_text(html_content, encoding="utf-8")

                html_manifest = [{"start": 1, "end": n_total_pages, "file": "result.html"}]
                (out_dir / "html_manifest.json").write_text(json.dumps(html_manifest), encoding="utf-8")
                extraction_mode = "pypdfium2_fallback"
                print("[pipeline] Fallback 2 (pypdfium2) réussi")
            except Exception as pe:
                print(f"[pipeline] Fallback ultime échoué: {pe}")
                raise RuntimeError(
                    f"Le traitement a échoué : {docling_error_msg}. Secours également en échec: {pe}"
                ) from e

    if progress_callback:
        progress_callback(100, "Traitement terminé.")

    _log_memory("pipeline end")
    return {
        "pages": pages_info,
        "outline": outline,
        "figures": all_figures,
        "tables": all_tables,
        "n_pages": n_total_pages,
        "n_figures": len(all_figures),
        "n_tables": len(all_tables),
        "extraction_mode": extraction_mode,
        "pdf_title": pdf_title,           # Item 9 : titre depuis métadonnées PDF
        "pipeline_version": PIPELINE_VERSION,  # TD-013 : version du pipeline pour détection cache obsolète
    }


# ═══════════════════════════════════════════════════════════════════════════════
# UTILITAIRES OUTLINE
# ═══════════════════════════════════════════════════════════════════════════════

def _level_depuis_titre(title: str) -> int | None:
    m = _NUM_PREFIX.match(title)
    if not m:
        return None
    return m.group(1).count(".") + 1


def _construire_outline(sections: list[dict[str, Any]]) -> list[dict[str, Any]]:
    racine: list[dict[str, Any]] = []
    pile: list[dict[str, Any]] = []
    seen_titles: set[str] = set()

    for s in sections:
        key = s["title"].lower().strip()
        if key in seen_titles:
            continue
        seen_titles.add(key)

        while pile and pile[-1]["level"] >= s["level"]:
            pile.pop()
        if pile:
            pile[-1]["children"].append(s)
        else:
            racine.append(s)
        pile.append(s)

    return racine


# ═══════════════════════════════════════════════════════════════════════════════
# P3 — MULTI-FORMAT via markitdown
# ═══════════════════════════════════════════════════════════════════════════════

_MD_HEADING = re.compile(r"^(#{1,6})\s+(.+)", re.MULTILINE)


def _outline_from_markdown(text: str) -> list[dict[str, Any]]:
    """Construit un outline depuis les titres Markdown (# → niveau 1, ## → 2…)."""
    flat: list[dict[str, Any]] = []
    for i, m in enumerate(_MD_HEADING.finditer(text)):
        flat.append({
            "id": f"s_{i}",
            "level": len(m.group(1)),
            "title": m.group(2).strip(),
            "page": None,
            "bbox": None,
            "children": [],
        })
    return _construire_outline(flat)


# Formats supportés par markitdown avec leurs extensions
MARKITDOWN_EXTENSIONS: set[str] = {
    ".docx", ".pptx", ".xlsx", ".xls",
    ".html", ".htm", ".md", ".txt",
    ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp",
    ".ipynb", ".csv",
}


def convertir_generic(
    file_path: Path, 
    out_dir: Path, 
    progress_callback: Optional[Callable[[int, str], None]] = None
) -> dict[str, Any]:
    """Convertit un fichier non-PDF en Markdown via markitdown.

    Extrait le texte, les titres (outline) et sauvegarde result.md.
    Retourne extraction_mode='markitdown' sans figures ni tables (extraction PDF uniquement).
    """
    from markitdown import MarkItDown  # type: ignore

    if progress_callback:
        progress_callback(10, "Initialisation de MarkItDown...")

    ext = file_path.suffix.lower()
    print(f"[pipeline] markitdown: {file_path.name} ({ext})")

    if progress_callback:
        progress_callback(30, "Chargement et décodage du fichier...")

    converter = MarkItDown()
    try:
        if progress_callback:
            progress_callback(50, "Conversion en cours via MarkItDown...")
        result = converter.convert(str(file_path))
        markdown_text = result.text_content or ""
    except Exception as e:
        raise RuntimeError(f"markitdown failed on {file_path.name}: {e}") from e

    if progress_callback:
        progress_callback(85, "Sauvegarde du fichier Markdown...")

    # Sauvegarde du markdown
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "result.md").write_text(_clean_markdown(markdown_text), encoding="utf-8")
    (out_dir / "figures").mkdir(exist_ok=True)

    if progress_callback:
        progress_callback(90, "Extraction de la table des matières...")

    outline = _outline_from_markdown(markdown_text)

    n_chars = len(markdown_text)
    n_words = len(markdown_text.split())
    # Estimation pages : ~500 mots/page
    est_pages = max(1, round(n_words / 500))

    print(f"[pipeline] markitdown: {n_chars} chars, {len(outline)} sections de haut niveau")

    if progress_callback:
        progress_callback(100, "Traitement terminé.")

    return {
        "pages": [],
        "outline": outline,
        "figures": [],
        "tables": [],
        "n_pages": est_pages,
        "n_figures": 0,
        "n_tables": 0,
        "extraction_mode": "markitdown",
        "file_type": ext.lstrip("."),
    }
