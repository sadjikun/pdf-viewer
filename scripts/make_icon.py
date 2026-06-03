"""Generate assets/app.ico from the book favicon. Run once; commit the .ico.
Prefers rasterizing frontend/public/favicon.svg (exact). Falls back to a Pillow
re-draw using the same palette if no SVG rasterizer is installed.
"""
from pathlib import Path

ROOT = Path(__file__).parent
SVG = ROOT / "frontend" / "public" / "favicon.svg"
OUT = ROOT / "assets" / "app.ico"
SIZES = [16, 32, 48, 64, 128, 256]


def _from_svg() -> bool:
    try:
        import io

        import cairosvg  # type: ignore
        from PIL import Image
    except Exception:
        return False
    pngs = []
    for s in SIZES:
        data = cairosvg.svg2png(url=str(SVG), output_width=s, output_height=s)
        pngs.append(Image.open(io.BytesIO(data)).convert("RGBA"))
    OUT.parent.mkdir(parents=True, exist_ok=True)
    pngs[-1].save(OUT, sizes=[(s, s) for s in SIZES])
    return True


def _from_pillow() -> None:
    from PIL import Image, ImageDraw

    base = 256
    img = Image.new("RGBA", (base, base), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    k = base / 48.0  # favicon uses a 48px viewBox

    def S(*v):
        return [x * k for x in v]

    d.rounded_rectangle(S(0, 0, 48, 48), radius=10 * k, fill="#0f1117")
    # left + right pages
    d.polygon(S(22, 9, 18, 10, 12, 11, 8, 13, 8, 37, 12, 35, 18, 35.5, 22, 37), fill="#e8edf8")
    d.polygon(S(26, 9, 30, 10, 36, 11, 40, 13, 40, 37, 36, 35, 30, 35.5, 26, 37), fill="#e8edf8")
    # spine
    d.rounded_rectangle(S(21.5, 9, 26.5, 37), radius=2.5 * k, fill="#ff8c00")
    # highlighted line (reading)
    d.rounded_rectangle(S(10, 14.5, 20, 18), radius=1.75 * k, fill="#ffd9a0")
    OUT.parent.mkdir(parents=True, exist_ok=True)
    img.save(OUT, sizes=[(s, s) for s in SIZES])


if __name__ == "__main__":
    if not _from_svg():
        _from_pillow()
    print(f"Wrote {OUT}")
