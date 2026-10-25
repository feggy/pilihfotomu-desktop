#!/usr/bin/env python3
"""
Adds the bundled templates for the occasions the community set is thin on:
prewedding, lamaran, bayi & maternity, aqiqah & khitan, ulang tahun anak and
keluarga. Each design is a layout (below) dressed in a theme and the words
of its occasion, written into public/kreasi/templates.json as the engine's
own documents.

Run again after changing a layout: the templates it made before (ids `g…`)
are replaced, the community ones stay.

    python3 scripts/make-templates.py

Example names and dates are the ones `src/kreasi/personalize.ts` knows, so
Data klien swaps them for the client's.
"""

import json
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "public/kreasi/templates.json"

# Height of each format in slide widths (story 9:16, feed and carousel 4:5).
HEIGHT = {"story": 16 / 9, "feed": 1.25, "square": 1.0, "carousel": 1.25}

# Community templates that belong to a new category.
MOVES = {"t012": "bayi", "t013": "bayi"}

NO_SHADOW = {"on": False, "color": "#000000", "blur": 0.35, "distance": 0.05, "opacity": 0.45}


def empty_file(i):
    return {
        "id": f"kosong-{i}", "fileId": f"kosong-{i}", "fileName": f"Foto {i}", "fileNumber": None,
        "thumbnailUrl": None, "previewUrl": None, "webViewUrl": None, "downloadUrl": None, "order": 0,
    }


def fade_stops(color, a0, a1):
    return {
        "stops": [{"color": color, "alpha": a0, "at": 0}, {"color": color, "alpha": a1, "at": 1}],
        "from": {"color": color, "alpha": a0},
        "to": {"color": color, "alpha": a1},
    }


class Doc:
    """One design. Positions are shares of the whole canvas (x across every
    slide), sizes are slide widths, as the engine keeps them."""

    def __init__(self, fmt, background, slides=1):
        self.fmt, self.slides, self.bg = fmt, slides, background
        self.H = HEIGHT[fmt]
        self.slots, self.cells, self.texts, self.stickers, self.order = [], [], [], [], []
        self.n = 0

    def _id(self, p):
        self.n += 1
        return f"{p}{self.n}"

    def X(self, slide, x):
        """`x` within `slide` (0–1) as a share of the whole canvas."""
        return (slide + x) / self.slides

    def photo(self, x, y, w, h, *, slide=0, rotate=0, **look):
        """A photo place; x, y, w, h within `slide`, top-left corner."""
        cid = self._id("f")
        self.cells.append({"id": cid, "rotate": rotate, "x": round(self.X(slide, x), 4), "y": y, "w": round(w / self.slides, 4), "h": h})
        slot = {"file": empty_file(len(self.slots) + 1), "zoom": 1, "ox": 0, "oy": 0, "rotate": 0, "flip": False}
        slot.update(look)
        self.slots.append(slot)
        self.order.append(f"photo:{cid}")

    def text(self, text, x, y, size, color, font, *, slide=0, weight=400, case="asli", spacing=0, align="center", width=None, **more):
        tid = self._id("t")
        layer = {
            "id": tid, "weight": weight, "italic": False, "color": color, "align": align, "width": width,
            "textCase": case, "spacing": spacing, "shadow": dict(NO_SHADOW), "text": text, "font": font,
            "size": size, "x": round(self.X(slide, x), 4), "y": y,
        }
        layer.update(more)
        self.texts.append(layer)
        self.order.append(f"text:{tid}")

    def sticker(self, sticker, x, y, size, color, *, slide=0, rotate=0, **more):
        sid = self._id("s")
        layer = {"id": sid, "sticker": sticker, "rotate": rotate, "color": color, "x": round(self.X(slide, x), 4), "y": y, "size": size}
        layer.update(more)
        self.stickers.append(layer)
        self.order.append(f"sticker:{sid}")

    def rect(self, x, y, w, h, color, *, slide=0, corner=None, **more):
        """A plain box, x, y, w, h within `slide` (top-left corner, shares of the slide)."""
        if corner is not None:
            more["corner"] = corner
        self.sticker("bentuk:kotak-bulat" if corner else "bentuk:kotak", x + w / 2, y + h / 2, w, color, slide=slide, ratio=round(h * self.H / w, 4), **more)

    def fade(self, y0, y1, color, a0, a1, *, slide=0, w=1.0, x=0.0):
        """A band from y0 to y1 melting from alpha a0 (top) to a1 (bottom)."""
        self.rect(x, y0, w, y1 - y0, color, slide=slide, gradient={"type": "linear", "angle": 0, **fade_stops(color, a0, a1)})

    def line(self, x, y, length, color, *, slide=0, width=0.003, rotate=0, kind="garis"):
        self.sticker(f"bentuk:{kind}", x, y, length, color, slide=slide, rotate=rotate, lineWidth=width)

    def build(self):
        return {
            "format": self.fmt, "slides": self.slides, "templateId": "bebas",
            "slots": self.slots, "freeCells": self.cells, "freeFrame": "none",
            "style": {"gap": 0.012, "padding": 0.024, "radius": 0, "background": self.bg, "frame": 1},
            "backdrop": {"tint": 0, "blur": 0, "filter": ""},
            "backgroundScope": "semua", "slideBackgrounds": [],
            "texts": self.texts, "stickers": self.stickers, "layerOrder": self.order, "layerMeta": {},
            "watermark": {"enabled": False, "kind": "teks", "text": "", "position": "kanan-bawah", "custom": None, "size": 0.028, "opacity": 0.85, "tone": "terang"},
        }


def fit(text, size, room=0.86):
    """`size`, smaller when the words would not fit in `room` slide widths
    (about half an em a letter in the title fonts)."""
    longest = max(len(line) for line in text.split("\n"))
    return round(min(size, room / (0.5 * max(1, longest))), 4)


def print_look(paper, alpha=0.3):
    """A photo printed and laid on the page: a white edge and a soft shadow."""
    return {"stroke": {"width": 0.022, "color": paper}, "shadow": {"color": "#000000", "alpha": alpha, "blur": 0.03, "x": 0, "y": 0.012}}


# ── Layouts ───────────────────────────────────────────────────────
# Each takes a theme `th` and the words `w` of its occasion:
#   kicker  small spaced line   title  the big word(s)   name  who it is for
#   date    the day             body   a sentence         end   closing words (carousel)
# A theme: bg, ink (main text), soft (second text), accent, paper (prints,
# cards), title/name/body fonts, and orn: ornaments as (sticker, color).


def story_full(th, w):
    """One photo over the whole story, the words on a band melting from the theme's color."""
    d = Doc("story", th["bg"])
    d.photo(0, 0, 1, 1)
    d.fade(0, 0.16, th["bg"], 0.55, 0)
    d.fade(0.48, 1, th["bg"], 0, 0.94)
    d.text("Nama Studio", 0.5, 0.05, 0.026, th["ink"], th["body"], case="besar", spacing=0.3)
    d.text(w["kicker"], 0.5, 0.66, 0.03, th["soft"], th["body"], case="besar", spacing=0.32)
    d.text(w["title"], 0.5, 0.735, fit(w["title"], 0.15), th["ink"], th["title"])
    d.text(w["name"], 0.5, 0.82, 0.05, th["ink"], th["name"], case="besar", spacing=0.12, weight=600)
    d.line(0.5, 0.858, 0.12, th["accent"])
    d.text(w["date"], 0.5, 0.89, 0.032, th["soft"], th["body"], spacing=0.1)
    orn, color = th["orn"][0]
    d.sticker(orn, 0.84, 0.69, 0.13, color, rotate=12)
    return d


def story_arch(th, w):
    """A photo in an arch on a plain page, framed by a thin outline."""
    d = Doc("story", th["bg"])
    d.text(w["kicker"], 0.5, 0.075, 0.028, th["soft"], th["body"], case="besar", spacing=0.32)
    d.photo(0.13, 0.12, 0.74, 0.55, mask="lengkung", shadow={"color": "#000000", "alpha": 0.18, "blur": 0.04, "x": 0, "y": 0.012})
    orn, color = th["orn"][0]
    d.sticker(orn, 0.16, 0.64, 0.2, color, rotate=-18)
    d.sticker(orn, 0.85, 0.15, 0.15, color, rotate=160)
    d.text(w["title"], 0.5, 0.735, fit(w["title"], 0.13), th["ink"], th["title"])
    d.text(w["name"], 0.5, 0.805, 0.05, th["ink"], th["name"], case="besar", spacing=0.1, weight=600)
    d.text(w["date"], 0.5, 0.85, 0.032, th["soft"], th["body"], spacing=0.12)
    d.text(w["body"], 0.5, 0.905, 0.026, th["soft"], th["body"], width=0.72, lineHeight=1.45)
    d.text("@akunstudio", 0.5, 0.965, 0.022, th["soft"], th["body"], spacing=0.1)
    return d


def story_prints(th, w):
    """Three prints scattered with tape, the words written underneath."""
    d = Doc("story", th["bg"])
    look = print_look(th["paper"])
    d.photo(0.08, 0.06, 0.56, 0.3, rotate=-5, **look)
    d.photo(0.38, 0.27, 0.54, 0.29, rotate=4, **look)
    d.photo(0.1, 0.48, 0.5, 0.25, rotate=-3, **look)
    d.sticker("selotip", 0.36, 0.06, 0.2, th["accent"], rotate=-8, opacity=0.85)
    d.sticker("selotip", 0.67, 0.275, 0.18, th["accent"], rotate=10, opacity=0.85)
    orn, color = th["orn"][0]
    d.sticker(orn, 0.8, 0.62, 0.16, color, rotate=8)
    d.text(w["title"], 0.5, 0.8, fit(w["title"], 0.12), th["ink"], th["title"], rotate=-4)
    d.text(w["name"], 0.5, 0.87, 0.045, th["ink"], th["name"], case="besar", spacing=0.12, weight=600)
    d.text(w["date"], 0.5, 0.91, 0.03, th["soft"], th["body"], spacing=0.1)
    d.text("Nama Studio", 0.5, 0.965, 0.022, th["soft"], th["body"], case="besar", spacing=0.3)
    return d


def story_circle(th, w):
    """A round photo inside a ring of color, the title above it."""
    d = Doc("story", th["bg"])
    d.sticker("bentuk:lingkaran", 0.5, 0.47, 0.98, th["paper"], opacity=0.7)
    d.text(w["kicker"], 0.5, 0.09, 0.028, th["soft"], th["body"], case="besar", spacing=0.32)
    d.text(w["title"], 0.5, 0.165, fit(w["title"], 0.12), th["ink"], th["title"])
    d.photo(0.14, 0.27, 0.72, 0.405, mask="lingkaran")
    orn, color = th["orn"][0]
    d.sticker(orn, 0.17, 0.3, 0.17, color, rotate=-14)
    orn2, color2 = th["orn"][-1]
    d.sticker(orn2, 0.84, 0.64, 0.15, color2, rotate=12)
    d.text(w["name"], 0.5, 0.75, 0.06, th["ink"], th["name"], weight=600)
    d.text(w["date"], 0.5, 0.8, 0.032, th["soft"], th["body"], spacing=0.12)
    d.text(w["body"], 0.5, 0.87, 0.027, th["soft"], th["body"], width=0.74, lineHeight=1.45)
    d.text("Nama Studio", 0.5, 0.96, 0.022, th["soft"], th["body"], case="besar", spacing=0.3)
    return d


def feed_split(th, w):
    """The photo down the left, the words on a column of color to the right."""
    d = Doc("feed", th["bg"])
    d.photo(0, 0, 0.58, 1)
    d.text(w["kicker"], 0.79, 0.2, 0.024, th["soft"], th["body"], case="besar", spacing=0.3)
    d.text(w["title"], 0.79, 0.34, 0.1, th["ink"], th["title"], width=0.38, lineHeight=1.05)
    d.line(0.79, 0.47, 0.1, th["accent"])
    d.text(w["name"], 0.79, 0.55, 0.04, th["ink"], th["name"], width=0.36, case="besar", spacing=0.08, weight=600, lineHeight=1.3)
    d.text(w["date"], 0.79, 0.65, 0.026, th["soft"], th["body"], spacing=0.08)
    orn, color = th["orn"][0]
    d.sticker(orn, 0.79, 0.8, 0.13, color)
    d.text("Nama Studio", 0.79, 0.94, 0.02, th["soft"], th["body"], case="besar", spacing=0.3)
    return d


def feed_frame(th, w):
    """One photo inside a margin, the words below on a thin rule."""
    d = Doc("feed", th["bg"])
    d.rect(0.035, 0.028, 0.93, 0.944, th["accent"], outline=True, lineWidth=0.003)
    d.photo(0.07, 0.06, 0.86, 0.64, radius=0.02)
    d.text(w["title"], 0.5, 0.775, fit(w["title"], 0.1), th["ink"], th["title"])
    d.text(w["name"], 0.5, 0.855, 0.038, th["ink"], th["name"], case="besar", spacing=0.12, weight=600)
    d.line(0.27, 0.905, 0.2, th["accent"])
    d.line(0.73, 0.905, 0.2, th["accent"])
    d.text(w["date"], 0.5, 0.905, 0.026, th["soft"], th["body"], spacing=0.1)
    d.text("@akunstudio", 0.5, 0.955, 0.02, th["soft"], th["body"], spacing=0.1)
    orn, color = th["orn"][0]
    d.sticker(orn, 0.88, 0.69, 0.13, color, rotate=10)
    return d


def feed_duo(th, w):
    """Two prints leaning on each other, the words underneath."""
    d = Doc("feed", th["bg"])
    look = print_look(th["paper"], 0.35)
    d.photo(0.07, 0.08, 0.46, 0.46, rotate=-6, **look)
    d.photo(0.47, 0.14, 0.46, 0.46, rotate=5, **look)
    orn, color = th["orn"][0]
    d.sticker(orn, 0.87, 0.08, 0.11, color)
    orn2, color2 = th["orn"][-1]
    d.sticker(orn2, 0.1, 0.63, 0.1, color2, rotate=-10)
    d.text(w["title"], 0.5, 0.73, fit(w["title"], 0.11), th["ink"], th["title"])
    d.text(w["name"], 0.5, 0.825, 0.034, th["soft"], th["name"], case="besar", spacing=0.2)
    d.text(w["date"], 0.5, 0.89, 0.034, th["ink"], th["body"], spacing=0.08)
    d.text("Nama Studio", 0.5, 0.955, 0.02, th["soft"], th["body"], case="besar", spacing=0.3)
    return d


def feed_trio(th, w):
    """A wide photo above two small ones, the title on a band between."""
    d = Doc("feed", th["bg"])
    d.photo(0.05, 0.04, 0.9, 0.46, radius=0.03)
    d.text(w["title"], 0.5, 0.575, fit(w["title"], 0.085), th["ink"], th["title"])
    d.text(w["name"] + "  ·  " + w["date"], 0.5, 0.645, 0.026, th["soft"], th["body"], case="besar", spacing=0.14)
    d.photo(0.05, 0.69, 0.44, 0.27, radius=0.04)
    d.photo(0.51, 0.69, 0.44, 0.27, radius=0.04)
    orn, color = th["orn"][0]
    d.sticker(orn, 0.9, 0.5, 0.11, color, rotate=12)
    return d


def carousel_cover(th, w):
    """Three slides: a cover whose photo runs on into the second slide, two
    more photos, and a closing slide."""
    d = Doc("carousel", th["bg"], 3)
    # Slide 1: the words, the big photo crossing into slide 2.
    d.text(w["kicker"], 0.32, 0.2, 0.026, th["soft"], th["body"], case="besar", spacing=0.3)
    d.text(w["title"], 0.32, 0.38, 0.12, th["ink"], th["title"], width=0.56, lineHeight=1.0)
    d.line(0.32, 0.56, 0.12, th["accent"])
    d.text(w["name"], 0.32, 0.64, 0.04, th["ink"], th["name"], width=0.56, case="besar", spacing=0.08, weight=600, lineHeight=1.3)
    d.text(w["date"], 0.32, 0.74, 0.028, th["soft"], th["body"], spacing=0.08)
    d.text("Geser  →", 0.32, 0.92, 0.024, th["soft"], th["body"], spacing=0.1)
    d.photo(0.66, 0.1, 0.84, 0.8, radius=0.02)
    # Slide 2–3.
    d.photo(0.56, 0.12, 0.38, 0.42, slide=1, radius=0.02)
    d.photo(0.56, 0.56, 0.38, 0.32, slide=1, radius=0.02)
    d.photo(0.08, 0.1, 0.84, 0.58, slide=2, radius=0.02)
    d.text(w["end"], 0.5, 0.79, fit(w["end"], 0.09), th["ink"], th["title"], slide=2)
    d.text("Nama Studio", 0.5, 0.88, 0.026, th["soft"], th["body"], slide=2, case="besar", spacing=0.3)
    d.text("@akunstudio", 0.5, 0.925, 0.022, th["soft"], th["body"], slide=2, spacing=0.1)
    orn, color = th["orn"][0]
    d.sticker(orn, 0.87, 0.08, 0.13, color, slide=2, rotate=10)
    return d


def carousel_film(th, w):
    """One photo a slide, numbered, on a thin line that runs through all three."""
    d = Doc("carousel", th["bg"], 3)
    d.line(0.5, 0.86, 3, th["accent"], width=0.003)
    d.text(w["title"], 0.5, 0.1, fit(w["title"], 0.1), th["ink"], th["title"])
    d.photo(0.1, 0.18, 0.8, 0.58, radius=0.02)
    d.text(w["kicker"], 0.5, 0.92, 0.024, th["soft"], th["body"], case="besar", spacing=0.3)
    d.photo(0.1, 0.1, 0.8, 0.66, slide=1, radius=0.02)
    d.text(w["name"], 0.5, 0.92, 0.034, th["ink"], th["name"], slide=1, case="besar", spacing=0.12, weight=600)
    d.photo(0.1, 0.1, 0.8, 0.58, slide=2, radius=0.02)
    d.text(w["end"], 0.5, 0.77, fit(w["end"], 0.07), th["ink"], th["title"], slide=2)
    d.text(w["date"] + "  ·  Nama Studio", 0.5, 0.92, 0.024, th["soft"], th["body"], slide=2, spacing=0.12)
    for i, label in enumerate(["01", "02", "03"]):
        d.sticker("bentuk:lingkaran", 0.5, 0.86, 0.06, th["bg"], slide=i)
        d.sticker("bentuk:lingkaran", 0.5, 0.86, 0.06, th["accent"], slide=i, outline=True, lineWidth=0.003)
        d.text(label, 0.5, 0.86, 0.022, th["ink"], th["body"], slide=i, weight=600)
    return d


def carousel_mosaic(th, w):
    """A full cover photo with its title, then a mosaic of four with one
    photo across the fold."""
    d = Doc("carousel", th["bg"], 3)
    d.photo(0, 0, 1, 1)
    d.fade(0.5, 1, th["bg"], 0, 0.92)
    d.text(w["kicker"], 0.5, 0.7, 0.026, th["soft"], th["body"], case="besar", spacing=0.3)
    d.text(w["title"], 0.5, 0.78, fit(w["title"], 0.11), th["ink"], th["title"])
    d.text(w["name"], 0.5, 0.87, 0.04, th["ink"], th["name"], case="besar", spacing=0.1, weight=600)
    d.photo(0.06, 0.06, 0.5, 0.5, slide=1, radius=0.02)
    d.photo(0.06, 0.58, 0.5, 0.36, slide=1, radius=0.02)
    d.photo(0.6, 0.06, 0.8, 0.56, slide=1, radius=0.02)
    d.photo(0.44, 0.64, 0.5, 0.3, slide=2, radius=0.02)
    d.text(w["end"], 0.7, 0.3, 0.075, th["ink"], th["title"], slide=2, width=0.46, lineHeight=1.05)
    d.text(w["date"], 0.7, 0.46, 0.024, th["soft"], th["body"], slide=2, spacing=0.1)
    d.text("Nama Studio", 0.7, 0.5, 0.022, th["soft"], th["body"], slide=2, case="besar", spacing=0.3)
    orn, color = th["orn"][0]
    d.sticker(orn, 0.22, 0.79, 0.15, color, slide=2, rotate=-8)
    return d


LAYOUTS = {
    "story-penuh": (story_full, "satu foto penuh, tulisan di atas warna yang memudar"),
    "story-lengkung": (story_arch, "foto dalam bingkai lengkung di halaman polos"),
    "story-cetak": (story_prints, "tiga foto cetak berserakan dengan selotip"),
    "story-bulat": (story_circle, "foto bulat di dalam lingkaran warna"),
    "feed-belah": (feed_split, "foto di kiri, tulisan di kolom warna kanan"),
    "feed-bingkai": (feed_frame, "satu foto dengan tepi, tulisan di bawah garis tipis"),
    "feed-dua": (feed_duo, "dua foto cetak saling bersandar"),
    "feed-tiga": (feed_trio, "satu foto lebar di atas dua foto kecil"),
    "carousel-sampul": (carousel_cover, "3 slide: sampul dengan foto yang menyambung ke slide 2, lalu penutup"),
    "carousel-film": (carousel_film, "3 slide bernomor, satu foto per slide, disambung garis tipis"),
    "carousel-mosaik": (carousel_mosaic, "3 slide: sampul foto penuh lalu mosaik dengan foto yang melintasi lipatan"),
}

# ── Themes ────────────────────────────────────────────────────────


def theme(bg, ink, soft, accent, paper, title, name, body, orn):
    return dict(bg=bg, ink=ink, soft=soft, accent=accent, paper=paper, title=title, name=name, body=body, orn=orn)


THEMES = {
    "sage": theme("#e7e9df", "#3c4a3a", "#6f7d68", "#9aa88c", "#fbfaf6", "allura", "cinzel", "josefin", [("eukaliptus", "#8f9f84"), ("daun-ganda", "#a9b69d")]),
    "senja": theme("#2a1c19", "#f3dfc8", "#c9a88e", "#d39b6a", "#f7efe6", "ms-madi", "bodoni-moda", "josefin", [("ranting", "#d39b6a"), ("kilau-tiga", "#f3dfc8")]),
    "film": theme("#141414", "#f2efe9", "#a7a39b", "#d8d2c4", "#f2efe9", "instrument-serif", "dm-sans", "dm-sans", [("kilau", "#f2efe9"), ("bintang", "#d8d2c4")]),
    "blush": theme("#f6e7e3", "#7e3b4c", "#a8707e", "#d99aa8", "#ffffff", "script", "italiana", "josefin", [("hati-ganda", "#d98a9c"), ("bunga", "#e7a9b5")]),
    "burgundi": theme("#3a1220", "#f1dcc0", "#cfa98f", "#d6b07a", "#fbf3e8", "allura", "cinzel", "josefin", [("cincin", "#d6b07a"), ("kilau-tiga", "#f1dcc0")]),
    "navy": theme("#f3f0e8", "#1f2b4a", "#5d6a85", "#b99a5b", "#ffffff", "ms-madi", "bodoni-moda", "lora", [("sudut-hias", "#b99a5b"), ("hati-kecil", "#b99a5b")]),
    "biru-muda": theme("#e6eef4", "#2f4a62", "#6f8aa0", "#9db7cb", "#ffffff", "caveat", "fraunces", "poppins", [("bulan-tidur", "#9db7cb"), ("bintang-bintang", "#b8cbd9")]),
    "persik": theme("#fbede4", "#8a4b37", "#b47d68", "#e8a98c", "#ffffff", "script", "fraunces", "poppins", [("jejak-kaki", "#e8a98c"), ("awan", "#f3c9b5")]),
    "lavender": theme("#ece8f4", "#4b3f6b", "#7e72a0", "#b4a8d6", "#ffffff", "allura", "lora", "josefin", [("bunga", "#b4a8d6"), ("kilau-tiga", "#9d90c4")]),
    "zamrud": theme("#0f3b31", "#f0e2bf", "#c7b48a", "#d4b065", "#f7f1e1", "allura", "cinzel", "lora", [("bulan-bintang", "#d4b065"), ("lentera", "#d4b065")]),
    "krem-hijau": theme("#f2eee2", "#244a39", "#5e7a69", "#b79a55", "#ffffff", "ms-madi", "cinzel", "lora", [("bulan-bintang", "#b79a55"), ("ketupat", "#5e7a69")]),
    "malam": theme("#13203a", "#f1e3c2", "#b9ad92", "#d3ae66", "#fbf5e7", "allura", "cinzel", "josefin", [("lentera", "#d3ae66"), ("bintang-bintang", "#d3ae66")]),
    "ceria": theme("#ffd85a", "#2a2a6e", "#4b4b8f", "#ff6f61", "#ffffff", "kaushan-script", "anton", "poppins", [("balon", "#ff6f61"), ("konfeti", "#2a2a6e")]),
    "pastel": theme("#fff3e8", "#d1495b", "#5f8f8a", "#7cc6c0", "#ffffff", "yellowtail", "archivo-black", "poppins", [("kue", "#d1495b"), ("topi-pesta", "#7cc6c0")]),
    "biru-pesta": theme("#2f6be0", "#ffffff", "#d6e4ff", "#ffd34d", "#ffffff", "kaushan-script", "bebas-neue", "poppins", [("konfeti", "#ffd34d"), ("balon", "#ffd34d")]),
    "hangat": theme("#efe5d8", "#56422f", "#8a7360", "#b88e62", "#ffffff", "allura", "fraunces", "josefin", [("rumah", "#b88e62"), ("daun", "#a58a6c")]),
    "hutan": theme("#22362a", "#efe6d3", "#b9b09a", "#c2a76c", "#f5efe2", "ms-madi", "gloock", "josefin", [("ranting", "#c2a76c"), ("daun-ganda", "#c2a76c")]),
    "putih": theme("#ffffff", "#1d1d1d", "#6b6b6b", "#c9c9c9", "#ffffff", "instrument-serif", "dm-sans", "dm-sans", [("hati-garis", "#1d1d1d"), ("kilau", "#9a9a9a")]),
}

# ── Occasions ─────────────────────────────────────────────────────
# (layout, theme, words, name of the design)

DAY = "14.11.2026"
LONG = "14 November 2026"


def words(kicker, title, name, date, body, end):
    return dict(kicker=kicker, title=title, name=name, date=date, body=body, end=end)


OCCASIONS = {
    "prewedding": [
        ("story-penuh", "senja", words("Save the date", "Kami Menikah", "Laras & Bagas", f"Sabtu, {DAY}", "", ""), "Save the Date — Senja"),
        ("story-lengkung", "sage", words("Prewedding", "Our Story", "Laras & Bagas", LONG, "Dua hati, satu cerita — sebelum hari bahagia kami.", ""), "Our Story — Sage"),
        ("story-cetak", "film", words("", "before the day", "Maya & Yoga", DAY, "", ""), "Sebelum Hari H — Film"),
        ("feed-belah", "sage", words("Save the date", "Kami Menikah", "Maya & Yoga", LONG, "", ""), "Save the Date — Belah Sage"),
        ("feed-bingkai", "senja", words("", "Prewedding", "Nadia & Arga", DAY, "", ""), "Prewedding — Bingkai Senja"),
        ("feed-dua", "film", words("", "two of us", "Nadia & Arga", DAY, "", ""), "Two of Us — Film"),
        ("carousel-sampul", "sage", words("Prewedding session", "Our Story", "Laras & Bagas", LONG, "", "Sampai jumpa di hari H"), "Cerita Prewedding — Sage"),
        ("carousel-film", "film", words("Prewedding", "Chapter One", "Maya & Yoga", DAY, "", "to be continued"), "Chapter One — Film"),
        ("carousel-mosaik", "senja", words("Save the date", "Kami Menikah", "Nadia & Arga", LONG, "", "Doakan kami"), "Save the Date — Mosaik Senja"),
    ],
    "lamaran": [
        ("story-penuh", "burgundi", words("Lamaran", "She said yes", "Citra & Hanif", f"Sabtu, {DAY}", "", ""), "She Said Yes — Burgundi"),
        ("story-lengkung", "blush", words("Acara lamaran", "Lamaran", "Intan & Fajar", LONG, "Terima kasih atas doa dan restu keluarga yang hadir.", ""), "Lamaran — Lengkung Blush"),
        ("story-bulat", "navy", words("Engagement", "Tunangan", "Salma & Fikri", DAY, "Satu langkah lagi menuju hari bahagia.", ""), "Tunangan — Navy"),
        ("feed-belah", "burgundi", words("Lamaran", "Ikatan Janji", "Citra & Hanif", LONG, "", ""), "Ikatan Janji — Burgundi"),
        ("feed-dua", "blush", words("", "She said yes!", "Lamaran Intan & Fajar", DAY, "", ""), "She Said Yes — Blush"),
        ("feed-tiga", "navy", words("", "Lamaran", "Tiara & Reza", DAY, "", ""), "Lamaran — Tiga Foto Navy"),
        ("carousel-sampul", "blush", words("Acara lamaran", "Lamaran", "Intan & Fajar", LONG, "", "Terima kasih"), "Cerita Lamaran — Blush"),
        ("carousel-film", "navy", words("Engagement", "Tunangan", "Salma & Fikri", DAY, "", "menuju hari H"), "Tunangan — Film Navy"),
        ("carousel-mosaik", "burgundi", words("Lamaran", "She said yes", "Tiara & Reza", LONG, "", "Mohon doa restu"), "She Said Yes — Mosaik Burgundi"),
    ],
    "bayi": [
        ("story-bulat", "biru-muda", words("Assalamualaikum, dunia", "Hello World", "Arka Pradipta", f"Lahir {LONG}", "Terima kasih atas doa dan kasih sayangnya.", ""), "Hello World — Biru"),
        ("story-lengkung", "persik", words("Newborn", "Selamat Datang", "Haifa Rahmani", LONG, "Si kecil telah lahir dengan sehat.", ""), "Selamat Datang — Persik"),
        ("story-penuh", "lavender", words("Maternity", "Menanti Buah Hati", "Laras & Bagas", "November 2026", "", ""), "Menanti Buah Hati — Lavender"),
        ("feed-belah", "biru-muda", words("Newborn session", "Halo, adik kecil", "Arka Pradipta", LONG, "", ""), "Halo Adik Kecil — Biru"),
        ("feed-bingkai", "lavender", words("", "Baby on the way", "Maya & Yoga", "November 2026", "", ""), "Baby on the Way — Lavender"),
        ("feed-tiga", "persik", words("", "1 Bulan", "Haifa Rahmani", LONG, "", ""), "Satu Bulan — Persik"),
        ("carousel-sampul", "persik", words("Newborn session", "Selamat Datang", "Haifa Rahmani", LONG, "", "Tumbuh sehat ya, Nak"), "Selamat Datang — Carousel Persik"),
        ("carousel-film", "biru-muda", words("Newborn", "Hello World", "Arka Pradipta", DAY, "", "welcome home"), "Hello World — Film Biru"),
        ("carousel-mosaik", "lavender", words("Maternity session", "Menanti Buah Hati", "Laras & Bagas", "November 2026", "", "Sampai jumpa, Nak"), "Menanti Buah Hati — Mosaik"),
    ],
    "syukuran": [
        ("story-lengkung", "zamrud", words("Tasyakuran", "Aqiqah", "Arka Pradipta", f"Sabtu, {DAY}", "Semoga menjadi anak yang sholeh, sehat dan berbakti.", ""), "Aqiqah — Zamrud"),
        ("story-bulat", "krem-hijau", words("Tasyakuran", "Khitanan", "Rizky Hidayat", LONG, "Mohon doa agar ananda tumbuh menjadi anak yang sholeh.", ""), "Khitanan — Krem Hijau"),
        ("story-penuh", "malam", words("Tasyakuran aqiqah", "Aqiqah", "Haifa Rahmani", f"Sabtu, {DAY}", "", ""), "Aqiqah — Malam"),
        ("feed-belah", "zamrud", words("Tasyakuran", "Khitanan", "Rizky Hidayat", LONG, "", ""), "Khitanan — Zamrud"),
        ("feed-bingkai", "krem-hijau", words("", "Aqiqah", "Arka Pradipta", DAY, "", ""), "Aqiqah — Bingkai Krem"),
        ("feed-tiga", "malam", words("", "Tasyakuran", "Rizky Hidayat", DAY, "", ""), "Tasyakuran — Tiga Foto"),
        ("carousel-sampul", "krem-hijau", words("Tasyakuran aqiqah", "Aqiqah", "Haifa Rahmani", LONG, "", "Jazakumullah khairan"), "Aqiqah — Carousel Krem"),
        ("carousel-film", "zamrud", words("Tasyakuran", "Khitanan", "Rizky Hidayat", DAY, "", "terima kasih"), "Khitanan — Film Zamrud"),
        ("carousel-mosaik", "malam", words("Tasyakuran aqiqah", "Aqiqah", "Arka Pradipta", LONG, "", "Terima kasih atas doanya"), "Aqiqah — Mosaik Malam"),
    ],
    "ulang-tahun": [
        ("story-bulat", "ceria", words("Ulang tahun ke-5", "Happy Birthday", "Salsa Putri", LONG, "Terima kasih sudah datang ke pestaku!", ""), "Happy Birthday — Ceria"),
        ("story-cetak", "pastel", words("", "Hari Spesial", "Salsa Putri", DAY, "", ""), "Hari Spesial — Pastel"),
        ("story-penuh", "biru-pesta", words("Ulang tahun ke-7", "Happy Birthday", "Rizky Hidayat", f"Sabtu, {DAY}", "", ""), "Happy Birthday — Biru Pesta"),
        ("feed-belah", "pastel", words("Ulang tahun ke-3", "Yeay, 3 tahun!", "Arka Pradipta", LONG, "", ""), "Tiga Tahun — Pastel"),
        ("feed-dua", "ceria", words("", "Happy Birthday", "Salsa Putri", DAY, "", ""), "Happy Birthday — Dua Foto"),
        ("feed-tiga", "biru-pesta", words("", "Birthday Party", "Rizky Hidayat", DAY, "", ""), "Birthday Party — Biru"),
        ("carousel-sampul", "ceria", words("Ulang tahun ke-5", "Happy Birthday", "Salsa Putri", LONG, "", "Terima kasih sudah datang"), "Pesta Ulang Tahun — Ceria"),
        ("carousel-film", "pastel", words("Ulang tahun", "Hari Spesial", "Arka Pradipta", DAY, "", "sampai tahun depan"), "Hari Spesial — Film Pastel"),
        ("carousel-mosaik", "biru-pesta", words("Ulang tahun ke-7", "Happy Birthday", "Rizky Hidayat", LONG, "", "Makin hebat ya!"), "Happy Birthday — Mosaik Biru"),
    ],
    "keluarga": [
        ("story-penuh", "hutan", words("Family session", "Keluarga", "Keluarga Bima Aditya", "2026", "", ""), "Keluarga — Hutan"),
        ("story-lengkung", "hangat", words("Potret keluarga", "Bersama Selalu", "Keluarga Bima Aditya", LONG, "Rumah adalah tempat kita kembali.", ""), "Bersama Selalu — Hangat"),
        ("story-cetak", "putih", words("", "our little family", "Keluarga Dimas Saputra", DAY, "", ""), "Our Little Family — Putih"),
        ("feed-belah", "hangat", words("Family session", "Keluarga Kecil Kami", "Keluarga Dimas Saputra", "2026", "", ""), "Keluarga Kecil — Hangat"),
        ("feed-bingkai", "putih", words("", "Family", "Keluarga Bima Aditya", "2026", "", ""), "Family — Bingkai Putih"),
        ("feed-dua", "hutan", words("", "Bersama", "Keluarga Rizky Hidayat", DAY, "", ""), "Bersama — Hutan"),
        ("carousel-sampul", "hangat", words("Potret keluarga", "Bersama Selalu", "Keluarga Bima Aditya", LONG, "", "Terima kasih"), "Bersama Selalu — Carousel"),
        ("carousel-film", "putih", words("Family session", "Family", "Keluarga Dimas Saputra", "2026", "", "home is us"), "Family — Film Putih"),
        ("carousel-mosaik", "hutan", words("Family session", "Keluarga", "Keluarga Rizky Hidayat", "2026", "", "Selalu bersama"), "Keluarga — Mosaik Hutan"),
    ],
}

LABEL = {
    "prewedding": "prewedding",
    "lamaran": "lamaran",
    "bayi": "bayi atau maternity",
    "syukuran": "aqiqah atau khitan",
    "ulang-tahun": "ulang tahun anak",
    "keluarga": "foto keluarga",
}


def main():
    templates = [t for t in json.loads(OUT.read_text()) if not t["id"].startswith("g")]
    for t in templates:
        if t["id"] in MOVES:
            t["category"] = MOVES[t["id"]]
    n = 0
    for category, designs in OCCASIONS.items():
        for layout, th, w, name in designs:
            make, how = LAYOUTS[layout]
            doc = make(THEMES[th], w).build()
            n += 1
            templates.append({
                "id": f"g{n:03d}",
                "name": name,
                "description": f"Untuk {LABEL[category]}: {how}.",
                "category": category,
                "format": doc["format"],
                "slides": doc["slides"],
                "document": json.dumps({"doc": doc}, ensure_ascii=False, separators=(",", ":")),
            })
    OUT.write_text(json.dumps(templates, ensure_ascii=False, separators=(",", ":")))
    print(f"{n} template dibuat, {len(templates)} semuanya.")


if __name__ == "__main__":
    main()
