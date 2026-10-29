"""
Tiny procedural pixel-art kit for The People's Bitcoin UI (original art, no
third-party assets). Shapes are filled hard-edged (no anti-aliasing), each
layer is lit from the top-left using its own mask (a fake bevel/volume), the
colours are quantised onto a short hue-shifted ramp (limited palette), and the
finished sprite gets a 1px near-black outline plus a soft drop shadow, in the
spirit of classic MMO inventory icons.
"""
from __future__ import annotations

import colorsys
import math

import numpy as np
from PIL import Image, ImageDraw

OUTLINE = (14, 10, 7, 255)


def hexrgb(h) -> tuple[int, int, int]:
    if isinstance(h, tuple):
        return h[:3]
    h = h.lstrip('#')
    return tuple(int(h[i : i + 2], 16) for i in (0, 2, 4))  # type: ignore[return-value]


def ramp(base: str, n: int = 5, spread: float = 0.62, hue_shift: float = 0.035) -> list[tuple[int, int, int]]:
    """Dark → light ramp around `base`; shadows drift cool, lights drift warm."""
    r, g, b = (c / 255 for c in hexrgb(base))  # accepts '#rrggbb' or an (r, g, b) tuple
    h, l, s = colorsys.rgb_to_hls(r, g, b)
    out = []
    for i in range(n):
        t = i / (n - 1) - 0.5  # -0.5 .. 0.5
        hh = (h - hue_shift * t * 2) % 1.0 if s > 0.08 else h
        ll = min(0.93, max(0.05, l + t * spread * (0.95 if t < 0 else 0.62)))
        ss = min(1.0, max(0.0, s * (1.0 + 0.25 * t)))
        rr, gg, bb = colorsys.hls_to_rgb(hh, ll, ss)
        out.append((round(rr * 255), round(gg * 255), round(bb * 255)))
    return out


def _blur(a: np.ndarray, r: int) -> np.ndarray:
    if r <= 0:
        return a
    k = 2 * r + 1
    p = np.pad(a, r, mode='constant')
    c = np.cumsum(np.cumsum(p, 0), 1)
    c = np.pad(c, ((1, 0), (1, 0)))
    s = c[k:, k:] - c[:-k, k:] - c[k:, :-k] + c[:-k, :-k]
    return s / (k * k)


class Layer:
    def __init__(self, mask: np.ndarray, mat, flat: bool, soft: int, gloss: bool, rim: bool):
        self.mask, self.mat, self.flat, self.soft, self.gloss, self.rim = mask, mat, flat, soft, gloss, rim


class Sprite:
    """Draw with shape calls, then render(). Coordinates are pixels."""

    def __init__(self, w: int, h: int | None = None, light=(-0.62, -0.78)):
        self.w, self.h = w, h or w
        self.layers: list[Layer | tuple] = []
        self.light = light

    # ── masks ───────────────────────────────────────────────────────────────
    def _mask(self, fn) -> np.ndarray:
        im = Image.new('1', (self.w, self.h), 0)
        fn(ImageDraw.Draw(im))
        return np.array(im, dtype=bool)

    def _add(self, mask, mat, flat=False, soft=2, gloss=False, rim=True):
        if isinstance(mat, str) or (isinstance(mat, tuple) and isinstance(mat[0], int)):
            mat = ramp(mat)
        self.layers.append(Layer(mask, mat, flat, soft, gloss, rim))
        return self

    def poly(self, pts, mat, **kw):
        return self._add(self._mask(lambda d: d.polygon([tuple(p) for p in pts], fill=1)), mat, **kw)

    def rect(self, x0, y0, x1, y1, mat, **kw):
        return self._add(self._mask(lambda d: d.rectangle([x0, y0, x1, y1], fill=1)), mat, **kw)

    def rrect(self, x0, y0, x1, y1, r, mat, **kw):
        return self._add(self._mask(lambda d: d.rounded_rectangle([x0, y0, x1, y1], r, fill=1)), mat, **kw)

    def ellipse(self, cx, cy, rx, ry, mat, **kw):
        return self._add(self._mask(lambda d: d.ellipse([cx - rx, cy - ry, cx + rx, cy + ry], fill=1)), mat, **kw)

    def ring(self, cx, cy, rx, ry, width, mat, **kw):
        return self._add(
            self._mask(lambda d: d.ellipse([cx - rx, cy - ry, cx + rx, cy + ry], outline=1, width=width)), mat, **kw
        )

    def thick(self, pts, width, mat, **kw):
        """A thick polyline as a shaded shape (handles, straps, blades)."""
        def fn(d):
            d.line([tuple(p) for p in pts], fill=1, width=width)
            for x, y in pts:
                r = (width - 1) / 2
                d.ellipse([x - r, y - r, x + r, y + r], fill=1)
        return self._add(self._mask(fn), mat, **kw)

    def erase_poly(self, pts):
        """Cut a hole (e.g. a wrench jaw) through everything drawn so far."""
        self.layers.append(('erase', self._mask(lambda d: d.polygon([tuple(p) for p in pts], fill=1))))
        return self

    def mask(self, m: np.ndarray, mat, **kw):
        return self._add(m.astype(bool), mat, **kw)

    # ── unshaded details (drawn on top, after lighting) ────────────────────
    def line(self, pts, color, width=1):
        self.layers.append(('line', [tuple(p) for p in pts], color, width))
        return self

    def px(self, x, y, color):
        self.layers.append(('px', x, y, color))
        return self

    def dots(self, pts, color):
        for x, y in pts:
            self.px(x, y, color)
        return self

    # ── render ──────────────────────────────────────────────────────────────
    def _shade(self, layer: Layer) -> np.ndarray:
        m = layer.mask.astype(float)
        n = len(layer.mat)
        if layer.flat:
            idx = np.full(m.shape, n // 2, dtype=int)
        else:
            hgt = _blur(m, layer.soft)
            gy, gx = np.gradient(hgt)
            lx, ly = self.light
            # Surfaces facing the light (top-left) brighten; far edges darken.
            lam = -(gx * lx + gy * ly) * 2.4
            ys = np.linspace(0.25, -0.25, self.h)[:, None]  # gentle top→bottom falloff
            val = 0.5 + lam + ys * 0.6 + (hgt - 0.5) * 0.25
            idx = np.clip(np.round(val * (n - 1)), 0, n - 1).astype(int)
            if layer.gloss:
                g = (lam > 0.18) & (hgt > 0.55)
                idx[g] = n - 1
        if layer.rim:
            # Selective inner outline: own-mask edges on the shadow side go darkest.
            mm = layer.mask
            edge_br = mm & ~(np.roll(mm, -1, 0) & np.roll(mm, -1, 1))
            idx[edge_br & (idx > 0)] = np.maximum(idx[edge_br & (idx > 0)] - 1, 0)
        return idx

    def render(self, outline=True, shadow=True) -> Image.Image:
        rgba = np.zeros((self.h, self.w, 4), dtype=np.uint8)
        filled = np.zeros((self.h, self.w), dtype=bool)
        for layer in self.layers:
            if isinstance(layer, Layer):
                idx = self._shade(layer)
                pal = np.array([(*c, 255) for c in layer.mat], dtype=np.uint8)
                rgba[layer.mask] = pal[idx[layer.mask]]
                filled |= layer.mask
            elif layer[0] == 'erase':
                rgba[layer[1]] = 0
                filled &= ~layer[1]
            else:
                im = Image.fromarray(rgba, 'RGBA')
                d = ImageDraw.Draw(im)
                if layer[0] == 'line':
                    _, pts, color, width = layer
                    d.line(pts, fill=(*hexrgb(color), 255), width=width)
                else:
                    _, x, y, color = layer
                    d.point((x, y), fill=(*hexrgb(color), 255))
                rgba = np.array(im)
                filled = rgba[..., 3] > 0
        out = rgba.copy()
        if outline:
            f = filled
            near = np.zeros_like(f)
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                near |= np.roll(np.roll(f, dy, 0), dx, 1)
            ol = near & ~f
            out[ol] = OUTLINE
            filled = f | ol
        if shadow:
            sh = np.roll(np.roll(filled, 1, 0), 1, 1) & ~filled
            out[sh] = (0, 0, 0, 90)
        return Image.fromarray(out, 'RGBA')


def upscale(im: Image.Image, k: int) -> Image.Image:
    return im.resize((im.width * k, im.height * k), Image.NEAREST)


def sheet(images: list[tuple[str, Image.Image]], cols: int, scale: int = 3, bg=(62, 53, 41)) -> Image.Image:
    cw = max(i.width for _, i in images) * scale + 8
    ch = max(i.height for _, i in images) * scale + 8
    rows = math.ceil(len(images) / cols)
    s = Image.new('RGBA', (cols * cw, rows * ch), (*bg, 255))
    for k, (_, im) in enumerate(images):
        s.alpha_composite(upscale(im, scale), ((k % cols) * cw + 4, (k // cols) * ch + 4))
    return s
