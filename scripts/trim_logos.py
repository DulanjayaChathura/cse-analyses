#!/usr/bin/env python3
"""Trim the empty margin around company logos, so a small mark doesn't sit lost in a big
white square on the site. Keeps the file name and format; leaves a thin border.

    python scripts/trim_logos.py              # every file in generated/logos
    python scripts/trim_logos.py FILE ...     # just these

Needs Pillow; without it, prints a note and changes nothing (the logos still work, untrimmed).
"""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LOGOS = ROOT / "generated" / "logos"


def trim(path):
    from PIL import Image, ImageChops
    im = Image.open(path)
    fmt = im.format
    rgba = im.convert("RGBA")
    flat = Image.alpha_composite(Image.new("RGBA", rgba.size, (255, 255, 255, 255)), rgba).convert("RGB")
    # what differs from white (or is opaque on a transparent logo) counts as the mark
    mask = ImageChops.difference(flat, Image.new("RGB", flat.size, (255, 255, 255))).convert("L").point(lambda p: 255 if p > 24 else 0)
    box = mask.getbbox()
    if not box:
        return False
    w, h = rgba.size
    if (box[2] - box[0]) * (box[3] - box[1]) > 0.6 * w * h:
        return False  # already tight
    pad = max(2, round(0.06 * max(box[2] - box[0], box[3] - box[1])))
    box = (max(0, box[0] - pad), max(0, box[1] - pad), min(w, box[2] + pad), min(h, box[3] + pad))
    if box == (0, 0, w, h) or (box[2] - box[0] >= w - 2 and box[3] - box[1] >= h - 2):
        return False  # already trimmed
    out = im.crop(box)
    if fmt == "JPEG" and out.mode not in ("RGB", "L"):
        out = out.convert("RGB")
    out.save(path, format=fmt, **({"quality": 92} if fmt == "JPEG" else {}))
    return True


def main(argv):
    try:
        import PIL  # noqa: F401
    except ImportError:
        print("Pillow isn't installed; logos left untrimmed.")
        return 0
    files = [Path(a) for a in argv] or sorted(p for p in LOGOS.glob("*") if p.is_file() and not p.name.startswith("."))
    n = 0
    for f in files:
        try:
            n += trim(f)
        except Exception as e:
            print(f"{f.name}: not trimmed ({e})")
    print(f"Trimmed {n} of {len(files)} logos.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
