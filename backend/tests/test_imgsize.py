from io import BytesIO

from PIL import Image

from imgsize import img_pixel_size


def _encode(w: int, h: int, fmt: str) -> bytes:
    buf = BytesIO()
    Image.new("RGB", (w, h), (200, 30, 30)).save(buf, fmt)
    return buf.getvalue()


def test_png_dimensions():
    assert img_pixel_size(_encode(64, 48, "PNG")) == (64, 48)


def test_jpeg_dimensions():
    assert img_pixel_size(_encode(120, 90, "JPEG")) == (120, 90)


def test_invalid_bytes_return_none():
    assert img_pixel_size(b"not an image at all") is None
