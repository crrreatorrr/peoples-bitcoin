"""
Side-panel frame art for The People's Bitcoin (original, procedural).

Paints, at 1:1 pixel scale for the locked 249×362 panel:
  frame.png        carved stone frame: two round stone pillars, arched top and
                   bottom tab housings, and the dark textured content backing
  tab_top_*.png    48×36 bevelled stone tab (normal / hover / active red-lit)
  tab_bot_*.png    the same, arched the other way for the bottom row
Tabs are 48×36; the top bar has 4 sockets and the bottom bar 3, spread evenly.
Run: python3 tools/ui-art/frame.py  (writes into src/assets/ui/)
"""
from __future__ import annotations

import os

import numpy as np
from PIL import Image

OUT = os.path.join(os.path.dirname(__file__), '..', '..', 'src', 'assets', 'ui')

W, H = 249, 362
TAB_W, TAB_H = 48, 36
# Tab bars: only working tabs, spread evenly (integer gaps) across x = 8..240.
ROW_X, ROW_W = 8, 232
TOP_TABS, BOT_TABS = 4, 3  # keep in sync with TAB_LAYOUT in src/ui/sidepanel.ts


def tab_xs(n: int) -> list[int]:
    gap = (ROW_W - n * TAB_W) // (n + 1)
    assert gap * (n + 1) + n * TAB_W == ROW_W, 'tab gaps must be whole pixels'
    return [ROW_X + gap + i * (TAB_W + gap) for i in range(n)]

TOP_Y, BOT_Y = 4, 322
CONTENT = (19, 42, 230, 320)  # x0, y0, x1 (excl), y1 (excl)
PILLAR_W = 18


def noise(w, h, scale, seed, octaves=4):
    rng = np.random.default_rng(seed)
    out = np.zeros((h, w))
    amp, total = 1.0, 0.0
    s = scale
    for _ in range(octaves):
        gw, gh = max(2, int(w / s) + 2), max(2, int(h / s) + 2)
        g = rng.random((gh, gw))
        ys = np.linspace(0, gh - 1.001, h)
        xs = np.linspace(0, gw - 1.001, w)
        y0, x0 = ys.astype(int), xs.astype(int)
        fy, fx = (ys - y0)[:, None], (xs - x0)[None, :]
        fy, fx = fy * fy * (3 - 2 * fy), fx * fx * (3 - 2 * fx)
        a = g[y0][:, x0]
        b = g[y0][:, x0 + 1]
        c = g[y0 + 1][:, x0]
        d = g[y0 + 1][:, x0 + 1]
        out += amp * ((a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy)
        total += amp
        amp *= 0.5
        s /= 2
    return out / total


def stone(w, h, base, seed, grain=0.22, blotch=0.18):
    """A speckled, blotchy stone surface around an RGB base colour."""
    rng = np.random.default_rng(seed + 99)
    n = noise(w, h, 22, seed) - 0.5
    fine = rng.random((h, w)) - 0.5
    v = 1 + n * blotch * 2 + fine * grain * 0.5
    img = np.clip(np.array(base)[None, None, :] * v[..., None], 0, 255)
    return img


def quant(img, step=6):
    """Snap to a coarse colour grid so the texture reads as limited-palette pixel art."""
    return (np.round(img / step) * step).clip(0, 255)


def bevel(img, x0, y0, x1, y1, hi=1.28, lo=0.55, width=1):
    for i in range(width):
        img[y0 + i, x0 + i : x1 - i] *= hi
        img[y0 + i : y1 - i, x0 + i] *= hi
        img[y1 - 1 - i, x0 + i : x1 - i] *= lo
        img[y0 + i : y1 - i, x1 - 1 - i] *= lo


def pillar(img, x0, y0, y1, seed):
    """A round stone column: cylindrical shading, block joints, capital and base."""
    w = PILLAR_W
    h = y1 - y0
    tex = stone(w, h, (112, 104, 90), seed, grain=0.28, blotch=0.12)
    xs = np.linspace(-1, 1, w)
    # Lambert on a cylinder lit from the upper left, plus a thin specular stripe.
    nx = xs
    nz = np.sqrt(np.clip(1 - nx * nx, 0, 1))
    lit = 0.22 + 0.98 * np.clip(-nx * 0.6 + nz * 0.8, 0, 1) ** 0.9
    spec = np.exp(-((xs + 0.42) ** 2) / 0.01) * 0.22
    tex = tex * 0 + np.array((112, 104, 90))[None, None, :] * (1 + (tex.mean(-1, keepdims=True) / 104 - 1) * 0.6)
    tex *= (lit + spec)[None, :, None]
    # Block joints every ~46px, staggered by side.
    for jy in range(18 + (seed % 2) * 23, h - 10, 46):
        tex[jy] *= 0.5
        tex[jy + 1] *= 1.18
    # Fluting: two faint vertical grooves.
    for gx in (w // 3, 2 * w // 3):
        tex[:, gx] *= 0.86
    # Capital and base rings.
    for ry, rh in ((0, 7), (h - 7, 7)):
        ring = stone(w, rh, (120, 112, 96), seed + ry, grain=0.2)
        ring *= np.linspace(1.3, 0.62, rh)[:, None, None]
        ring *= (0.55 + 0.6 * np.clip(-xs * 0.5 + nz * 0.86, 0, 1))[None, :, None]
        tex[ry : ry + rh] = ring
        tex[ry + 2, :] *= 0.6  # astragal groove
        tex[ry + rh - 1, :] *= 0.5
    tex[:, 0] = (22, 19, 15)
    tex[:, -1] = (18, 15, 12)
    img[y0:y1, x0 : x0 + w] = tex


def housing(img, y0, y1, seed, top: bool):
    """Stone tab housing: a slab with arched sockets where the tabs sit."""
    h = y1 - y0
    slab = stone(W, h, (92, 85, 73), seed, grain=0.25, blotch=0.15)
    # Light from above: slab brighter toward its top edge.
    slab *= np.linspace(1.12, 0.82, h)[:, None, None]
    # Horizontal mortar line splitting the slab into two courses.
    mid = h // 2 + (2 if top else -2)
    slab[mid] *= 0.62
    # Staggered vertical joints.
    for k, jx in enumerate(range(14, W, 38)):
        jy0, jy1 = (0, mid) if k % 2 else (mid, h)
        slab[jy0:jy1, jx] *= 0.62
    img[y0:y1] = slab
    # Dark sockets behind each tab (the arch reads as a recessed housing).
    ty = TOP_Y if top else BOT_Y
    for x in tab_xs(TOP_TABS if top else BOT_TABS):
        sock = tab_mask(top, inflate=1)
        region = img[ty - 1 : ty - 1 + TAB_H + 2, x - 1 : x - 1 + TAB_W + 2]
        region[sock] = region[sock] * 0.28
    bevel(img, 0, y0, W, y1, 1.22, 0.5)


def tab_mask(top: bool, inflate: int = 0) -> np.ndarray:
    w, h = TAB_W + 2 * inflate, TAB_H + 2 * inflate
    r = 9 + inflate
    yy, xx = np.mgrid[0:h, 0:w]
    m = np.ones((h, w), bool)
    if top:
        for cx in (r, w - 1 - r):
            corner = (yy < r) & (((xx < r) & (cx == r)) | ((xx > w - 1 - r) & (cx != r)))
            m &= ~(corner & ((xx - cx) ** 2 + (yy - r) ** 2 > r * r))
    else:
        for cx in (r, w - 1 - r):
            corner = (yy > h - 1 - r) & (((xx < r) & (cx == r)) | ((xx > w - 1 - r) & (cx != r)))
            m &= ~(corner & ((xx - cx) ** 2 + (yy - (h - 1 - r)) ** 2 > r * r))
    return m


def tab(top: bool, state: str, seed: int) -> Image.Image:
    m = tab_mask(top)
    m[:, -1] = False
    h, w = m.shape
    if state == 'active':
        base = (96, 30, 18)
    elif state == 'hover':
        base = (100, 94, 82)
    else:
        base = (82, 77, 68)
    t = stone(w, h, base, seed, grain=0.22, blotch=0.12)
    # Domed face: lighter toward the arch, darker toward the open edge.
    grad = np.linspace(1.18, 0.78, h) if top else np.linspace(0.92, 1.12, h)
    t *= grad[:, None, None]
    if state == 'active':
        # Red light pooled in the middle, like a lit hearth behind the stone.
        yy, xx = np.mgrid[0:h, 0:w]
        glow = np.exp(-(((xx - w / 2) / (w * 0.42)) ** 2 + ((yy - h * 0.55) / (h * 0.45)) ** 2))
        t += glow[..., None] * np.array([70, 14, 4])[None, None, :]
    # Bevel: light top/left inside the edge, dark bottom/right.
    mp = np.pad(m, 1)
    edge = m & ~(mp[:-2, 1:-1] & mp[2:, 1:-1] & mp[1:-1, :-2] & mp[1:-1, 2:])
    inner = m & ~edge
    edge2 = inner & ~(np.roll(inner, 1, 0) & np.roll(inner, -1, 0) & np.roll(inner, 1, 1) & np.roll(inner, -1, 1))
    yy, xx = np.mgrid[0:h, 0:w]
    tl = (xx + yy) < (w + h) / 2
    hi = 1.42 if state != 'active' else 1.6
    edge3 = inner & ~edge2 & ~(np.roll(inner & ~edge2, 1, 0) & np.roll(inner & ~edge2, -1, 0) & np.roll(inner & ~edge2, 1, 1) & np.roll(inner & ~edge2, -1, 1))
    t[edge2 & tl] *= hi
    t[edge3 & tl] *= 1.12
    t[edge2 & ~tl] *= 0.55
    t[edge3 & ~tl] *= 0.8
    t = quant(t.clip(0, 255), 5)
    rgba = np.zeros((h, w, 4), np.uint8)
    rgba[..., :3] = t.astype(np.uint8)
    rgba[..., 3] = m * 255
    rgba[edge] = (16, 13, 10, 255) if state != 'active' else (40, 8, 2, 255)
    return Image.fromarray(rgba, 'RGBA')


def frame() -> Image.Image:
    img = np.zeros((H, W, 3))
    # Content backing: dark brown-grey stone with faint scuffs.
    cx0, cy0, cx1, cy1 = CONTENT
    back = stone(W, H, (70, 62, 54), 7, grain=0.2, blotch=0.2)
    scuff = noise(W, H, 60, 11, 3)
    back *= (0.92 + 0.16 * scuff)[..., None]
    img[:] = back
    # Inner shadow on the content box (top and left in shade under the frame).
    for i, f in enumerate((0.5, 0.68, 0.82, 0.92)):
        img[cy0 + i, cx0:cx1] *= f
        img[cy0:cy1, cx0 + i] *= f
        img[cy1 - 1 - i, cx0:cx1] *= 0.5 + 0.5 * (i + 1) / 4 + 0.08
        img[cy0:cy1, cx1 - 1 - i] *= 0.5 + 0.5 * (i + 1) / 4 + 0.08
    housing(img, 0, 42, 21, True)
    housing(img, 320, H, 22, False)
    pillar(img, 1, 41, 321, 3)
    pillar(img, W - 1 - PILLAR_W, 41, 321, 4)
    # Outer frame edge.
    img[0, :] = img[-1, :] = (12, 10, 8)
    img[:, 0] = img[:, -1] = (12, 10, 8)
    img[1:-1, 1] = np.minimum(img[1:-1, 1] * 1.25, 255)
    img = quant(img.clip(0, 255), 4)
    return Image.fromarray(img.astype(np.uint8), 'RGB').convert('RGBA')


def main() -> None:
    os.makedirs(OUT, exist_ok=True)
    frame().save(os.path.join(OUT, 'frame.png'), optimize=True)
    for top, name in ((True, 'top'), (False, 'bot')):
        for state in ('normal', 'hover', 'active'):
            tab(top, state, 31 if top else 37).save(os.path.join(OUT, f'tab_{name}_{state}.png'), optimize=True)


if __name__ == '__main__':
    main()
