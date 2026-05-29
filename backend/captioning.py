"""Captioning IA des figures via Florence-2 (optionnel, opt-in).

Modèle microsoft/Florence-2-base (~450 MB, téléchargé au 1er usage). Toutes les
dépendances (transformers, torch, einops, timm) sont importées paresseusement :
le module se charge même si elles sont absentes, et l'endpoint renvoie 503.
"""
from __future__ import annotations

import logging
import threading

log = logging.getLogger(__name__)

_FLORENCE_LOCK = threading.Lock()  # le modèle n'est pas thread-safe
_model = None
_processor = None
_loaded = False


def init_florence() -> bool:
    """Charge Florence-2-base une seule fois (lazy singleton). True si disponible."""
    global _model, _processor, _loaded
    if _loaded:
        return _model is not None
    _loaded = True
    try:
        import torch
        from transformers import AutoModelForCausalLM, AutoProcessor
        log.info("Florence-2 : chargement microsoft/Florence-2-base...")
        _processor = AutoProcessor.from_pretrained(
            "microsoft/Florence-2-base", trust_remote_code=True
        )
        _model = AutoModelForCausalLM.from_pretrained(
            "microsoft/Florence-2-base",
            trust_remote_code=True,
            torch_dtype=torch.float32,
        ).eval()
        log.info("Florence-2 chargé")
        return True
    except Exception as e:
        log.info("Florence-2 non disponible : %s", e)
        _model = None
        _processor = None
        return False


def caption_figure(img) -> str | None:
    """Génère une légende détaillée pour une image PIL via Florence-2.

    Retourne la légende ou None (échec / modèle absent). Sérialisé par _FLORENCE_LOCK.
    """
    if not init_florence():
        return None
    try:
        import torch
        task = "<DETAILED_CAPTION>"
        with _FLORENCE_LOCK:
            inputs = _processor(text=task, images=img, return_tensors="pt")
            with torch.no_grad():
                ids = _model.generate(
                    input_ids=inputs["input_ids"],
                    pixel_values=inputs["pixel_values"],
                    max_new_tokens=128,
                    do_sample=False,
                    num_beams=3,
                )
            raw = _processor.batch_decode(ids, skip_special_tokens=False)[0]
            parsed = _processor.post_process_generation(
                raw, task=task, image_size=(img.width, img.height)
            )
        caption = (parsed.get(task) or "").strip()
        return caption if len(caption) > 8 else None
    except Exception as e:
        log.warning("Florence-2 caption erreur : %s", e)
        return None
