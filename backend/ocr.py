"""OCR optionnel : détection Tesseract + LaTeX-OCR (pix2tex).

Toutes les dépendances OCR (pytesseract, ocrmypdf, pix2tex) sont importées
paresseusement : le module se charge même si elles sont absentes. Les endpoints
qui en dépendent renvoient alors une 503.

Tesseract doit être installé séparément (binaire système) :
  - Windows : scoop install tesseract
  - macOS   : brew install tesseract tesseract-lang
  - Linux   : apt install tesseract-ocr tesseract-ocr-fra
"""
from __future__ import annotations

import logging
import os
import re
import shutil
from pathlib import Path

log = logging.getLogger(__name__)


# ──────────────────────────────────────────────────────────────────────────────
# Détection Tesseract
# ──────────────────────────────────────────────────────────────────────────────

def _find_tesseract() -> tuple[str | None, str | None]:
    """Détecte le binaire tesseract et le répertoire tessdata sur le système.

    Ordre de recherche :
      1. Variable d'environnement TESSERACT_CMD
      2. PATH (shims scoop, brew, conda, apt, etc.)
      3. Emplacements typiques Windows (Program Files, scoop)
    Retourne (cmd_path, tessdata_path) ou (None, None) si absent.
    """
    env_cmd = os.environ.get("TESSERACT_CMD")
    if env_cmd and Path(env_cmd).exists():
        cmd = env_cmd
    else:
        cmd = shutil.which("tesseract")

    if not cmd:
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

    tessdata = os.environ.get("TESSDATA_PREFIX")
    if not tessdata:
        scoop_data = Path(os.environ.get("USERPROFILE", "")) / "scoop" / "apps" / "tesseract" / "current" / "tessdata"
        if scoop_data.exists():
            tessdata = str(scoop_data)
        else:
            real = Path(cmd).resolve()
            candidate = real.parent / "tessdata"
            if candidate.exists():
                tessdata = str(candidate)

    return cmd, tessdata


# Exécuté une fois à l'import du module
TESSERACT_CMD, TESSDATA_DIR = _find_tesseract()

if TESSERACT_CMD:
    if TESSDATA_DIR:
        os.environ["TESSDATA_PREFIX"] = TESSDATA_DIR
    try:
        import pytesseract as _pyt  # type: ignore
        _pyt.pytesseract.tesseract_cmd = TESSERACT_CMD
        log.info("Tesseract: %s | tessdata: %s", TESSERACT_CMD, TESSDATA_DIR)
    except ImportError:
        log.info("Tesseract trouvé (%s) mais pytesseract non installé", TESSERACT_CMD)
else:
    log.info("Tesseract non trouvé — endpoints OCR désactivés (503)")


# ──────────────────────────────────────────────────────────────────────────────
# LaTeX-OCR (pix2tex) — lazy-loaded, optionnel
# ──────────────────────────────────────────────────────────────────────────────

_latex_model = None
_latex_model_loaded = False

# Caractères Unicode que KaTeX ne reconnaît pas → équivalents LaTeX
_UNICODE_TO_LATEX: dict[str, str] = {
    " ": " ",          # espace insécable
    "​": "",           # espace de largeur nulle
    "†": r"\dagger{}",  # †
    "′": "'",          # ′ prime
    "˙": r"\dot ",      # ˙ point au-dessus
    "ˉ": r"\bar ",      # ˉ macron
    "ˊ": r"\acute ",    # ˊ accent aigu
    "∅": r"\emptyset{}",  # ∅
    "⊤": r"\top{}",     # ⊤
    "⊥": r"\bot{}",     # ⊥
}


def sanitize_latex(latex: str) -> str:
    """Nettoie le LaTeX généré par pix2tex pour éviter les erreurs KaTeX.

    - Caractères Unicode → commandes LaTeX équivalentes
    - {array} avec trop peu de colonnes → colonne spec étendue automatiquement
    """
    if not latex:
        return latex

    for char, repl in _UNICODE_TO_LATEX.items():
        latex = latex.replace(char, repl)

    def _fix_array(m: re.Match) -> str:
        spec, body = m.group(1), m.group(2)
        col_letters = [c for c in spec if c in "clr"]
        rows = [r for r in body.split("\\\\") if r.strip()]
        max_cols = max((row.count("&") + 1 for row in rows), default=1)
        if len(col_letters) < max_cols:
            spec = "c" * max_cols
        return r"\begin{array}{" + spec + "}" + body + r"\end{array}"

    latex = re.sub(
        r"\\begin\{array\}\{([^}]*)\}(.*?)\\end\{array\}",
        _fix_array,
        latex,
        flags=re.DOTALL,
    )

    return latex


def _predict(model, img) -> str | None:
    """Appelle pix2tex sans laisser le modèle écraser le presse-papiers système.

    pix2tex appelle clipboard.copy(pred) après chaque prédiction ; on neutralise
    ce comportement temporairement. Le résultat passe par sanitize_latex().
    """
    try:
        import pandas.io.clipboard as _cb  # type: ignore
        _orig = _cb.copy
        _cb.copy = lambda *a, **kw: None
        try:
            result = model(img)
        finally:
            _cb.copy = _orig
    except Exception:
        result = model(img)
    return sanitize_latex(result) if result else result


def init_latex_ocr():
    """Charge le modèle pix2tex (une seule fois). Retourne le modèle ou None."""
    global _latex_model, _latex_model_loaded
    if not _latex_model_loaded:
        _latex_model_loaded = True
        try:
            from pix2tex.cli import LatexOCR  # type: ignore
            _latex_model = LatexOCR()
            log.info("pix2tex chargé — LaTeX-OCR actif")
        except ImportError:
            log.info("pix2tex non installé — LaTeX-OCR désactivé")
            _latex_model = None
        except Exception as e:
            log.warning("Chargement pix2tex échoué : %s", e)
            _latex_model = None
    return _latex_model


def latex_ocr_figure(img_path: Path) -> str | None:
    """Extrait du LaTeX depuis une image de figure. None si pix2tex absent/échec.

    Heuristique : une équation est typiquement large et peu haute ; on saute les
    images carrées ou très grandes (photos, schémas).
    """
    model = init_latex_ocr()
    if model is None:
        return None

    try:
        from PIL import Image
        img = Image.open(img_path)
        w, h = img.size
        if h > w * 0.6 or w * h > 1_000_000:
            return None
        latex = _predict(model, img)
        if not latex or len(latex) < 3 or len(latex) > 600:
            return None
        return latex.strip()
    except Exception:
        return None
