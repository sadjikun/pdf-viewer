"""Image pixel-dimension helper (FIX-035 de-embedding).

Kept in its own lightweight module so it can be unit-tested without importing
the heavy Docling/Torch stack pulled in by ``pipeline.py``.
"""
from __future__ import annotations


def img_pixel_size(raw: bytes) -> "tuple[int, int] | None":
    """Return ``(width, height)`` in pixels for an encoded image, or ``None``.

    Handles any format Pillow can read (PNG, JPEG, …). Used by the de-embedder to
    stamp ``data-w``/``data-h`` on de-embedded ``<img>`` tags so the Reader's logo
    and proportional-sizing filters work on ``/html-image/`` URLs instead of base64.
    """
    try:
        from io import BytesIO

        from PIL import Image

        with Image.open(BytesIO(raw)) as im:
            w, h = im.size
        return (int(w), int(h))
    except Exception:
        return None
