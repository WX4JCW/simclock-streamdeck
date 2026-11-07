# Builds the Elgato Marketplace pictures for MSFS SimClock into store/:
#   icon.png (288 x 288), thumbnail.png and gallery-1..3.png (1920 x 960, the sizes Maker Console asks for).
# Same layout as the Camera Deck for ChasePlane set. The pictures are real screenshots in docs/:
# touch-strip.png (the six dials on the owner's Stream Deck + XL) and settings.png (a clock's settings
# panel in the Stream Deck app).
# Usage: python tools/store/make_store.py   (from the repository root)
import os

from PIL import Image, ImageDraw, ImageFilter, ImageFont

OUT = "store"
W, H = 1920, 960
FONTS = "C:/Windows/Fonts/"
BG = (14, 15, 19)
INK = (236, 238, 242)
DIM = (150, 156, 168)
TEAL = (59, 206, 182)  # the LOCAL clock's band color, panelColors("local") in src/render.ts
DEEP = (15, 42, 37)
LIGHT = (165, 233, 221)


def font(size, weight="b"):
    return ImageFont.truetype(FONTS + {"b": "segoeuib.ttf", "sb": "seguisb.ttf", "r": "segoeui.ttf"}[weight], size)


def strip_shot():
    return Image.open("docs/touch-strip.png").convert("RGB")


def first_three():
    """LOCAL, ZULU and SIM, cut at the black gap after SIM and closed with the strip's own left edge, mirrored."""
    shot = strip_shot()
    left = shot.crop((0, 0, 10, shot.height)).transpose(Image.FLIP_LEFT_RIGHT)
    out = Image.new("RGB", (628 + left.width, shot.height))
    out.paste(shot.crop((0, 0, 628, shot.height)), (0, 0))
    out.paste(left, (628, 0))
    return out


def framed(canvas, shot, box_w, center):
    """Pastes the screenshot scaled to box_w wide, with rounded corners and a soft shadow."""
    scale = box_w / shot.width
    img = shot.resize((box_w, round(shot.height * scale)), Image.LANCZOS)
    mask = Image.new("L", img.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, *img.size), radius=28, fill=255)
    x, y = round(center[0] - img.width / 2), round(center[1] - img.height / 2)
    shadow = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle((x - 6, y + 18, x + img.width + 6, y + img.height + 30), radius=36, fill=(0, 0, 0, 170))
    canvas.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(28)))
    canvas.paste(img, (x, y), mask)
    return y + img.height


def base():
    c = Image.new("RGBA", (W, H), BG + (255,))
    ImageDraw.Draw(c).rectangle((0, 0, W, 10), fill=TEAL)
    return c


def headline(c, title, sub, y=70):
    d = ImageDraw.Draw(c)
    d.text((W / 2, y), title, font=font(76), fill=INK, anchor="mt")
    d.text((W / 2, y + 104), sub, font=font(38, "r"), fill=DIM, anchor="mt")


def thumbnail():
    c = base()
    d = ImageDraw.Draw(c)
    d.text((110, 300), "MSFS SimClock", font=font(100), fill=INK, anchor="ls")
    d.text((114, 390), "flight clocks", font=font(68, "sb"), fill=TEAL, anchor="ls")
    lines = ["Local, Zulu and sim time, your", "SimBrief departure and a", "countdown with reminders."]
    for i, line in enumerate(lines):
        d.text((116, 490 + i * 58), line, font=font(40, "r"), fill=DIM, anchor="ls")
    d.text((116, 820), "Microsoft Flight Simulator", font=font(32, "sb"), fill=DIM, anchor="ls")
    # The right half shows the three clocks most people start with, large enough to read.
    framed(c, first_three(), 980, (1380, 480))
    return c


def gallery_dials():
    c = base()
    headline(c, "Six clocks on the touch strip", "Local, Zulu, sim Zulu, SimBrief departure, the countdown and the next reminder.")
    bottom = framed(c, strip_shot(), 1760, (W / 2, 480))
    d = ImageDraw.Draw(c)
    jobs = [("LOCAL", "your PC's time"), ("ZULU", "real UTC"), ("SIM", "the sim's own UTC"),
            ("SOBT", "SimBrief off-block"), ("TO SOBT", "countdown, then late"), ("TIMELINE", "reminders before STD")]
    for i, (a, b) in enumerate(jobs):
        x = (W - 1760) / 2 + 1760 / 6 * (i + 0.5)
        d.text((x, bottom + 60), a, font=font(30, "sb"), fill=INK, anchor="mt")
        d.text((x, bottom + 104), b, font=font(28, "r"), fill=DIM, anchor="mt")
    return c


def gallery_alerts():
    c = base()
    headline(c, "Alerts before pushback", "The countdown changes color as departure nears; a reminder lights up when it is due.")
    framed(c, strip_shot().crop((626, 0, 1249, 122)), 1300, (W / 2, 600))
    return c


def gallery_settings():
    c = base()
    headline(c, "Set each clock your way", "Choose the time, name, font and alert minutes, in the PANEL or CLASSIC look.")
    shot = Image.open("docs/settings.png").convert("RGB")
    # Fit inside the area under the headline, whichever side bites first.
    box_w = min(1500, round(shot.width * 640 / shot.height))
    framed(c, shot, box_w, (W / 2, 600))
    return c


def icon():
    s = 4  # draw at 4x, then shrink, for smooth edges
    c = Image.new("RGB", (288 * s, 288 * s), DEEP)
    d = ImageDraw.Draw(c)
    d.rectangle((0, 0, 288 * s, 70 * s), fill=TEAL)
    d.text((144 * s, 36 * s), "MSFS", font=font(34 * s), fill=(0, 0, 0), anchor="mm")
    d.text((144 * s, 140 * s), "SIM", font=font(70 * s), fill=LIGHT, anchor="mm")
    d.text((144 * s, 212 * s), "CLOCK", font=font(70 * s), fill=LIGHT, anchor="mm")
    return c.resize((288, 288), Image.LANCZOS)


os.makedirs(OUT, exist_ok=True)
icon().save(f"{OUT}/icon.png")
pictures = [("thumbnail", thumbnail), ("gallery-1", gallery_dials), ("gallery-2", gallery_alerts), ("gallery-3", gallery_settings)]
for name, make in pictures:
    if name == "gallery-3" and not os.path.exists("docs/settings.png"):
        print("skipped gallery-3: docs/settings.png is missing")
        continue
    make().convert("RGB").save(f"{OUT}/{name}.png")
print("written", OUT)
