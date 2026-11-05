"""Draws the app icons used when EDEN is installed as an app (frontend/public/icons/*.png) from the same leaf as favicon.svg.
Run: python scripts/make-pwa-icons.py   (needs Pillow, which is in backend/requirements-dev.txt)"""
import math
from pathlib import Path

from PIL import Image, ImageDraw

BG, LEAF = (20, 32, 27, 255), (76, 195, 138, 255)
OUT = Path(__file__).resolve().parent.parent / "frontend" / "public" / "icons"


def bezier(p0, c1, c2, p3, n=24):
    pts = []
    for i in range(n + 1):
        t = i / n
        u = 1 - t
        pts.append((u ** 3 * p0[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t ** 3 * p3[0],
                    u ** 3 * p0[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t ** 3 * p3[1]))
    return pts


def leaf_outline():
    right = bezier((16, 5), (22, 8), (25, 13), (25, 18))
    arc = [(16 + 9 * math.cos(math.radians(a)), 18 + 9 * math.sin(math.radians(a))) for a in range(0, 181, 6)]  # 25,18 -> bottom -> 7,18
    left = bezier((7, 18), (7, 13), (10, 8), (16, 5))
    return right + arc[1:-1] + left


def draw(size: int, margin: float, rounded: bool) -> Image.Image:
    """Leaf on a dark square. margin = share of the side kept empty around the 32-unit artwork (more for maskable icons)."""
    s = 2048
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if rounded:
        d.rounded_rectangle([0, 0, s - 1, s - 1], radius=int(s * 0.25), fill=BG)
    else:
        d.rectangle([0, 0, s, s], fill=BG)
    k = s * (1 - 2 * margin) / 32
    o = s * margin
    pt = lambda p: (o + p[0] * k, o + p[1] * k)
    d.polygon([pt(p) for p in leaf_outline()], fill=LEAF)
    w = int(1.8 * k)
    for a, b in (((16, 11), (16, 25)), ((16, 17), (12, 14)), ((16, 20), (20, 17))):
        d.line([pt(a), pt(b)], fill=BG, width=w)
        for e in (a, b):
            x, y = pt(e)
            d.ellipse([x - w / 2, y - w / 2, x + w / 2, y + w / 2], fill=BG)
    return img.resize((size, size), Image.LANCZOS)


OUT.mkdir(parents=True, exist_ok=True)
draw(192, 0.12, True).save(OUT / "icon-192.png")
draw(512, 0.12, True).save(OUT / "icon-512.png")
draw(512, 0.26, False).save(OUT / "icon-maskable-512.png")   # the OS crops this one to its own shape
draw(180, 0.12, False).save(OUT / "apple-touch-icon.png")    # iOS rounds the corners itself
print("wrote", *sorted(p.name for p in OUT.glob("*.png")))
