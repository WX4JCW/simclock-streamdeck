"""Generate the plugin PNG icons. Stream Deck requires PNG for the plugin/category
icon (action icons may be SVG). Drawn at 4x and downsampled for anti-aliasing."""

from __future__ import annotations

import pathlib

from PIL import Image, ImageDraw

SS = 4  # supersample factor
BG = (16, 18, 20, 255)
FG = (232, 234, 237, 255)
OUT = pathlib.Path(__file__).resolve().parent.parent / "com.acms.simclock.sdPlugin" / "imgs"


def draw_clock(size: int) -> Image.Image:
    s = size * SS
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    radius = int(s * 0.167)
    d.rounded_rectangle([0, 0, s - 1, s - 1], radius=radius, fill=BG)

    cx = cy = s / 2
    r = s * 0.32
    ring = max(1, int(s * 0.042))
    d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=FG, width=ring)

    # Hands at roughly 10:10, the conventional display setting.
    hand = max(1, int(s * 0.042))
    d.line([cx, cy, cx, cy - r * 0.58], fill=FG, width=hand)
    d.line([cx, cy, cx + r * 0.44, cy + r * 0.21], fill=FG, width=hand)
    hub = s * 0.031
    d.ellipse([cx - hub, cy - hub, cx + hub, cy + hub], fill=FG)

    return img.resize((size, size), Image.LANCZOS)


def write(path: pathlib.Path, size: int) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    draw_clock(size).save(path, "PNG")
    print(f"{path.relative_to(OUT.parent)}  {size}x{size}")


def main() -> None:
    for name in ("icon", "category"):
        write(OUT / "plugin" / f"{name}.png", 288)
        write(OUT / "plugin" / f"{name}@2x.png", 576)


if __name__ == "__main__":
    main()
