"""Draws installer/eden.ico (a green rounded square with a white house). Run: python installer/make-icon.py (needs Pillow)."""
from pathlib import Path

from PIL import Image, ImageDraw

S = 1024
img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
d = ImageDraw.Draw(img)
# background: vertical green gradient clipped to a rounded square
grad = Image.new("RGBA", (S, S))
gd = ImageDraw.Draw(grad)
for y in range(S):
    t = y / S
    gd.line([(0, y), (S, y)], fill=(int(40 + 30 * t), int(190 - 60 * t), int(120 - 20 * t), 255))
mask = Image.new("L", (S, S), 0)
ImageDraw.Draw(mask).rounded_rectangle([40, 40, S - 40, S - 40], radius=210, fill=255)
img.paste(grad, (0, 0), mask)
# house
white = (255, 255, 255, 255)
d.polygon([(512, 230), (800, 480), (224, 480)], fill=white)                 # roof
d.rectangle([300, 470, 724, 790], fill=white)                               # walls
d.rectangle([450, 590, 574, 790], fill=(30, 130, 90, 255))                  # door
d.ellipse([618, 538, 690, 610], fill=(30, 130, 90, 255))                    # window
out = Path(__file__).with_name("eden.ico")
img.save(out, sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
print("wrote", out)
