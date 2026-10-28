"""Generate the plugin PNG icons. Stream Deck requires PNG for the plugin icon and
accepts PNG or SVG for the category icon (action icons are SVG, written by hand).
Drawn at 4x and downsampled for anti-aliasing.

The two icons are deliberately different drawings, because the SDK asks for different
things in each slot:

- Icon          256 x 256 and 512 x 512, shown in Stream Deck's preferences. A badge:
                the clock on its own dark rounded-rect ground.
- CategoryIcon  28 x 28 and 56 x 56, shown beside the "Sim Clock" group in the actions
                list. Must be monochromatic #FFFFFF on a transparent background, so it
                is the bare clock glyph with no ground, and drawn heavier to survive
                being displayed at 28 px.
"""

from __future__ import annotations

import pathlib

from PIL import Image, ImageDraw

SS = 4  # supersample factor
BG = (16, 18, 20, 255)
FG = (232, 234, 237, 255)
WHITE = (255, 255, 255, 255)
OUT = pathlib.Path(__file__).resolve().parent.parent / "com.acms.simclock.sdPlugin" / "imgs"

# Sizes the SDK requires in each slot, as {name: (1x, 2x)}.
PLUGIN_ICON_SIZES = (256, 512)
CATEGORY_ICON_SIZES = (28, 56)


def _hands(d: ImageDraw.ImageDraw, cx: float, cy: float, r: float, width: int, fill) -> None:
    """Hands at roughly 10:10, the conventional display setting, plus the centre hub."""
    d.line([cx, cy, cx, cy - r * 0.58], fill=fill, width=width)
    d.line([cx, cy, cx + r * 0.44, cy + r * 0.21], fill=fill, width=width)
    hub = max(1.0, r * 0.1)
    d.ellipse([cx - hub, cy - hub, cx + hub, cy + hub], fill=fill)


def draw_plugin_icon(size: int) -> Image.Image:
    """The clock on a dark rounded-rect badge, for Stream Deck's preferences."""
    s = size * SS
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    d.rounded_rectangle([0, 0, s - 1, s - 1], radius=int(s * 0.167), fill=BG)

    cx = cy = s / 2
    r = s * 0.32
    stroke = max(1, int(s * 0.042))
    d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=FG, width=stroke)
    _hands(d, cx, cy, r, stroke, FG)

    return img.resize((size, size), Image.LANCZOS)


def draw_category_icon(size: int) -> Image.Image:
    """The bare clock glyph in white on transparent, for the actions-list group.

    The canvas starts as white-with-zero-alpha rather than transparent black: every
    pixel then carries white RGB, so downsampling only interpolates alpha and the
    edges stay white. On a transparent-black canvas the same resize bleeds the black
    into the antialiased edge and the glyph comes out grey and muddy.

    Proportions are heavier than the badge version. With no rounded-rect ground to sit
    in, the glyph can use the full canvas, and at 28 px a hairline ring disappears.
    """
    s = size * SS
    img = Image.new("RGBA", (s, s), (255, 255, 255, 0))
    d = ImageDraw.Draw(img)

    cx = cy = s / 2
    r = s * 0.38
    stroke = max(1, round(s * 0.085))
    d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=WHITE, width=stroke)
    _hands(d, cx, cy, r, stroke, WHITE)

    return img.resize((size, size), Image.LANCZOS)


def write(path: pathlib.Path, size: int, draw) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    draw(size).save(path, "PNG")
    print(f"{path.relative_to(OUT.parent)}  {size}x{size}")


def main() -> None:
    one_x, two_x = PLUGIN_ICON_SIZES
    write(OUT / "plugin" / "icon.png", one_x, draw_plugin_icon)
    write(OUT / "plugin" / "icon@2x.png", two_x, draw_plugin_icon)

    one_x, two_x = CATEGORY_ICON_SIZES
    write(OUT / "plugin" / "category.png", one_x, draw_category_icon)
    write(OUT / "plugin" / "category@2x.png", two_x, draw_category_icon)


if __name__ == "__main__":
    main()
