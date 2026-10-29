"""
Item and tab icons for The People's Bitcoin, drawn procedurally with
pixelkit (original art). Each item model id maps to an archetype (hat, jacket,
gun, staff, drink, document...) with its own palette and details taken from
the item's name and examine text.

Run: python3 tools/ui-art/icons.py
Writes src/assets/icons/px/<model>.png (32×32) and src/assets/ui/tab_<id>.png (26×26,
one per working side-panel tab).
"""
from __future__ import annotations

import json
import os
import sys

from pixelkit import Sprite, ramp, sheet

ROOT = os.path.join(os.path.dirname(__file__), '..', '..')
ICON_DIR = os.path.join(ROOT, 'src', 'assets', 'icons', 'px')
UI_DIR = os.path.join(ROOT, 'src', 'assets', 'ui')

ICONS: dict[str, callable] = {}
TABS: dict[str, callable] = {}


def icon(*names):
    def deco(fn):
        for n in names:
            ICONS[n] = fn
        return fn
    return deco


# ── palette names ─────────────────────────────────────────────────────────
GOLD, SILVER, STEEL, IRON, RUST = '#d9a520', '#b8c2cc', '#8d99a6', '#6f7378', '#9a5a2a'
OAK, DARKWOOD, LEATHER = '#8a5a2e', '#5a3a1e', '#7a4a26'
NAVY, RED, GREEN, BLUE, PURPLE, WHITE, BLACK = '#2f3f6b', '#b0302a', '#3f9a3a', '#2f6fd1', '#7a3fa8', '#e8e4d8', '#2a2a30'
DIAMOND, HASH, PAPER = '#7fd8f0', '#f2a03a', '#e6dcc0'


# ── archetypes ────────────────────────────────────────────────────────────
def cap(c, band=None, brim=None):
    s = Sprite(32)
    s.ellipse(16, 15, 10, 9, c)
    s.poly([(4, 18), (28, 18), (30, 21), (20, 23), (4, 21)], brim or c)
    if band:
        s.rect(7, 16, 25, 17, band, flat=True)
    s.px(16, 6, band or c)  # button on the crown
    return s


def fedora(c, band='#2a2018'):
    s = Sprite(32)
    s.ellipse(16, 21, 14, 5, c)
    s.poly([(8, 20), (9, 10), (13, 7), (16, 9), (19, 7), (23, 10), (24, 20)], c)
    s.rect(8, 16, 24, 19, band)
    return s


def top_hat(c='#25252c', band='#a02828'):
    s = Sprite(32)
    s.ellipse(16, 24, 14, 4, c)
    s.rect(9, 4, 23, 23, c)
    s.ellipse(16, 4, 7, 2, c)
    s.rect(9, 18, 23, 21, band)
    return s


def hard_hat(c='#f0c020'):
    s = Sprite(32)
    s.ellipse(16, 16, 11, 10, c, gloss=True)
    s.rect(3, 19, 29, 23, c)
    s.rect(13, 7, 19, 19, ramp(c)[3], flat=True)
    return s


def helmet(c, visor=None, crest=None):
    s = Sprite(32)
    s.ellipse(16, 15, 11, 11, c, gloss=True)
    s.rect(5, 15, 27, 26, c)
    if visor:
        s.rect(8, 15, 24, 19, visor, gloss=True)
    if crest:
        s.rect(15, 3, 17, 12, crest)
    return s


def dome_helm(c, gem):
    s = helmet(c)
    s.ellipse(16, 8, 4, 4, c, gloss=True)
    s.ellipse(16, 18, 3, 3, gem, gloss=True)
    return s


def wizard_hat(c, trim, stars='#f2e070', spirals=False):
    s = Sprite(32)
    s.ellipse(16, 25, 14, 4, c)
    s.poly([(7, 25), (13, 12), (17, 3), (22, 8), (19, 12), (25, 25)], c)
    s.rect(7, 21, 25, 24, trim)
    if spirals:
        s.line([(12, 18), (14, 16), (16, 17), (15, 19)], stars)
        s.line([(18, 13), (20, 12), (20, 14)], stars)
    else:
        s.dots([(13, 16), (18, 12), (20, 18), (16, 9)], stars)
    return s


def headset(c='#30333a', mic='#d0d0d0'):
    s = Sprite(32)
    s.ring(16, 15, 11, 11, 3, c)
    s.rrect(3, 14, 8, 23, 2, c)
    s.rrect(24, 14, 29, 23, 2, c)
    s.thick([(6, 22), (9, 27), (15, 28)], 2, mic)
    s.ellipse(16, 28, 2, 2, '#202020')
    return s


def aviators(frame=GOLD, lens='#3a4a5a'):
    s = Sprite(32)
    s.poly([(3, 12), (14, 12), (14, 18), (10, 22), (5, 20)], lens, gloss=True)
    s.poly([(18, 12), (29, 12), (27, 20), (22, 22), (18, 18)], lens, gloss=True)
    s.line([(3, 12), (29, 12)], '#c89a20')
    s.line([(14, 13), (18, 13)], '#c89a20')
    s.px(7, 14, '#c8e0f0').px(21, 14, '#c8e0f0')
    return s


def clown_nose():
    s = Sprite(32)
    s.thick([(4, 14), (12, 13)], 2, BLACK)
    s.thick([(20, 13), (28, 14)], 2, BLACK)
    s.ellipse(16, 15, 7, 7, '#e02a20', gloss=True)
    s.px(13, 11, '#ffe0d8').px(14, 11, '#ffe0d8').px(13, 12, '#ffe0d8')
    return s


def jacket(c, lapel=None, shirt=WHITE, tie=None, buttons=None, stripe=None):
    s = Sprite(32)
    s.poly([(9, 4), (23, 4), (29, 9), (29, 22), (25, 22), (25, 28), (7, 28), (7, 22), (3, 22), (3, 9)], c)
    s.poly([(12, 4), (20, 4), (16, 14)], shirt, flat=True)
    if tie:
        s.poly([(15, 6), (17, 6), (18, 15), (16, 18), (14, 15)], tie)
    if lapel:
        s.poly([(11, 4), (16, 15), (12, 12), (10, 7)], lapel)
        s.poly([(21, 4), (16, 15), (20, 12), (22, 7)], lapel)
    if stripe:
        s.rect(7, 18, 25, 20, stripe, flat=True)
        s.rect(3, 18, 6, 20, stripe, flat=True)
        s.rect(26, 18, 29, 20, stripe, flat=True)
    for y in buttons or []:
        s.px(16, y, '#d8c060')
    return s


def vest(c, plate=None):
    s = Sprite(32)
    s.poly([(9, 3), (13, 3), (16, 8), (19, 3), (23, 3), (27, 9), (26, 28), (6, 28), (5, 9)], c)
    if plate:
        s.rrect(9, 12, 23, 25, 2, plate)
    s.line([(16, 10), (16, 27)], '#1a1a1a')
    return s


def plate(c, trim, gem=None, star=False):
    s = Sprite(32)
    s.poly([(8, 3), (24, 3), (29, 7), (28, 14), (25, 14), (25, 28), (7, 28), (7, 14), (4, 14), (3, 7)], c, gloss=True)
    s.poly([(12, 3), (20, 3), (16, 8)], trim)
    s.line([(16, 9), (16, 26)], ramp(c)[1])
    if star:
        s.poly([(16, 11), (18, 16), (23, 16), (19, 19), (21, 24), (16, 21), (11, 24), (13, 19), (9, 16), (14, 16)], trim, gloss=True)
    if gem:
        s.ellipse(16, 17, 2, 2, gem, gloss=True)
    return s


def robe(c, trim):
    s = Sprite(32)
    s.poly([(10, 3), (22, 3), (28, 9), (26, 14), (24, 13), (27, 29), (5, 29), (8, 13), (6, 14), (4, 9)], c)
    s.poly([(14, 3), (18, 3), (17, 29), (15, 29)], trim)
    s.rect(9, 26, 23, 28, trim)
    return s


def hoodie(c, front='#f0e060'):
    s = jacket(c, shirt=c)
    s.ellipse(16, 6, 6, 4, ramp(c)[1])
    s.rrect(11, 17, 21, 23, 2, ramp(c)[1])
    s.line([(14, 9), (14, 14)], front).line([(18, 9), (18, 14)], front)
    return s


def tailcoat(c='#25252c'):
    s = jacket(c, lapel='#3a3a44', shirt=WHITE, tie=None)
    s.poly([(7, 22), (11, 31), (14, 26)], c)
    s.poly([(25, 22), (21, 31), (18, 26)], c)
    s.poly([(13, 6), (16, 8), (19, 6), (19, 9), (16, 8), (13, 9)], '#a02828')
    return s


def trousers(c, belt=None, stripe=None, plates=False, pockets=False):
    s = Sprite(32)
    s.poly([(8, 3), (24, 3), (26, 29), (18, 29), (16, 12), (14, 29), (6, 29)], c, gloss=plates)
    if belt:
        s.rect(8, 3, 24, 5, belt, flat=True)
        s.px(16, 4, '#e0c040')
    if stripe:
        s.line([(8, 7), (7, 28)], stripe).line([(24, 7), (25, 28)], stripe)
    if plates:
        s.rrect(8, 12, 14, 18, 2, ramp(c)[3], gloss=True)
        s.rrect(18, 12, 24, 18, 2, ramp(c)[3], gloss=True)
    if pockets:
        s.rect(7, 15, 11, 20, ramp(c)[1]).rect(21, 15, 25, 20, ramp(c)[1])
    return s


def gloves(c, cuff=None, fingerless=False, gem=None, mitten=False):
    s = Sprite(32)
    for dx, flip in ((0, 1), (14, -1)):
        x = 3 + dx
        if mitten:
            s.rrect(x, 8, x + 11, 22, 5, c)
            s.ellipse(x + (0 if flip > 0 else 11), 15, 2, 3, c)
        else:
            s.rrect(x, 11, x + 11, 23, 3, c)
            for f in range(4):
                fx = x + 1 + f * 3 - (0 if flip > 0 else 1)
                top = 9 if fingerless else 5 + (abs(f - 1.5) > 1) * 2
                s.rect(fx, top, fx + 2, 13, c)
            if fingerless:
                for f in range(4):
                    fx = x + 1 + f * 3 - (0 if flip > 0 else 1)
                    s.rect(fx, 6, fx + 2, 8, '#e0b090')
        s.rect(x, 22, x + 11, 27, cuff or ramp(c)[1])
        if gem:
            s.ellipse(x + 5, 17, 2, 2, gem, gloss=True)
    return s


def boots(c, sole='#2a2018', laces=None, tall=True, shine=False, stripe=None):
    s = Sprite(32)
    top = 6 if tall else 14
    for x in (3, 16):
        s.poly([(x + 1, top), (x + 8, top), (x + 8, 21), (x + 13, 23), (x + 13, 27), (x, 27), (x, 21)], c, gloss=shine)
        s.rect(x, 26, x + 13, 28, sole, flat=True)
        if laces:
            for y in range(top + 2, 21, 3):
                s.line([(x + 3, y), (x + 6, y)], laces)
        if stripe:
            s.line([(x + 2, 22), (x + 10, 22)], stripe)
    return s


def lanyard(card='#e8e4d8', strap='#2f6fd1'):
    s = Sprite(32)
    s.thick([(9, 3), (13, 16)], 3, strap)
    s.thick([(23, 3), (19, 16)], 3, strap)
    s.rrect(10, 15, 22, 29, 2, card, flat=True)
    s.rect(12, 18, 16, 22, '#7a8a9a', flat=True)
    s.line([(12, 25), (20, 25)], '#555555').line([(17, 19), (20, 19)], '#555555')
    return s


def pendant(chain=GOLD, charm='gavel', color=OAK, gem=None):
    s = Sprite(32)
    s.ring(16, 11, 10, 9, 1, chain)
    if charm == 'gavel':
        s.thick([(14, 19), (20, 28)], 2, color)
        s.rrect(9, 15, 21, 20, 2, color)
    elif charm == 'candle':
        s.ellipse(16, 22, 7, 7, chain, gloss=True)
        s.ellipse(16, 22, 5, 5, '#203020')
        s.rect(15, 18, 17, 26, '#40d040', gloss=True)
        s.line([(16, 16), (16, 27)], '#40d040')
    elif charm == 'medallion':
        s.ellipse(16, 22, 7, 7, chain, gloss=True)
        s.ellipse(16, 22, 4, 4, color, gloss=True)
    elif charm == 'whistle':
        s.rrect(10, 19, 24, 25, 3, color, gloss=True)
        s.rect(8, 20, 11, 23, color)
        s.ellipse(19, 22, 2, 2, '#202020')
    elif charm == 'tag':
        s.ellipse(16, 23, 5, 5, color, gloss=True)
        s.line([(14, 21), (14, 25)], '#303030').line([(17, 21), (18, 21), (18, 25), (17, 25), (17, 21)], '#303030')
    if gem:
        s.ellipse(16, 22, 2, 2, gem, gloss=True)
    return s


def collar(c=RED, tag=GOLD):
    s = Sprite(32)
    s.ring(16, 14, 12, 8, 4, c)
    s.ellipse(16, 24, 5, 5, tag, gloss=True)
    s.line([(14, 22), (14, 26)], '#3a2a10').line([(17, 22), (19, 22), (19, 26), (17, 26), (17, 22)], '#3a2a10')
    return s


def tie(c='#7a3fa8', stain='#4a5a2a'):
    s = Sprite(32)
    s.poly([(13, 3), (19, 3), (18, 7), (14, 7)], c)
    s.poly([(14, 7), (18, 7), (22, 24), (16, 30), (10, 24)], c)
    s.ellipse(17, 20, 3, 4, stain)
    s.px(14, 25, stain).px(19, 13, stain)
    return s


def gavel(head=OAK, handle=DARKWOOD, band=GOLD, big=False):
    s = Sprite(32)
    s.thick([(7, 27), (19, 12)], 3, handle)
    w = 7 if big else 5
    s.poly([(12, 9), (19, 2), (28, 11), (21, 18)] if big else [(13, 8), (19, 3), (26, 10), (20, 15)], head, gloss=True)
    s.line([(15, 6), (23, 14)] if big else [(15, 6), (22, 12)], band)
    return s


def mace(head=IRON, handle=DARKWOOD, spikes=True):
    s = Sprite(32)
    s.thick([(6, 28), (18, 14)], 3, handle)
    s.ellipse(21, 11, 7, 7, head, gloss=True)
    if spikes:
        for x, y in ((21, 2), (30, 11), (21, 20), (12, 11), (27, 5), (27, 17), (15, 5)):
            s.px(x, y, '#d0d4d8')
    return s


def briefcase(c=LEATHER):
    s = Sprite(32)
    s.rrect(4, 10, 28, 27, 3, c)
    s.ring(16, 9, 5, 4, 2, '#3a2410')
    s.rect(4, 15, 28, 16, ramp(c)[1], flat=True)
    s.rect(9, 14, 11, 17, GOLD).rect(21, 14, 23, 17, GOLD)
    return s


def pistol(body=IRON, grip='#5a3a1e', accent=None, long=False, big=False, barrel=None):
    s = Sprite(32)
    if long:
        s.rect(3, 12, 29, 15, body, gloss=True)
        s.poly([(3, 12), (12, 12), (12, 18), (5, 19)], grip)
        s.poly([(14, 15), (19, 15), (17, 24), (13, 24)], grip)
        s.rect(10, 9, 18, 11, '#2a2a2a')
    else:
        s.rect(5, 9, 27 if big else 25, 15, body, gloss=True)
        s.poly([(7, 14), (14, 14), (12, 27), (5, 27)], grip)
        s.thick([(15, 16), (17, 19), (15, 20)], 1, '#2a2a2a')
    if barrel:
        s.ellipse(27, 12, 3, 3, barrel, gloss=True)
    if accent:
        s.rect(8, 10, 22, 11, accent, flat=True)
    return s


def shotgun(body='#d04090', grip=OAK, confetti=True):
    s = Sprite(32)
    s.rect(9, 11, 30, 15, body, gloss=True)
    s.poly([(2, 13), (11, 11), (13, 17), (4, 21)], grip)
    s.rect(14, 15, 22, 17, ramp(grip)[1])
    if confetti:
        s.dots([(29, 8), (27, 6), (30, 5), (26, 9)], '#f0e040')
        s.dots([(28, 7), (25, 5), (30, 9)], '#40c0f0')
    return s


def smg(body='#3a3a44', mag='#d9a520'):
    s = Sprite(32)
    s.rect(6, 10, 26, 16, body, gloss=True)
    s.rect(26, 12, 30, 14, body)
    s.poly([(8, 15), (13, 15), (12, 25), (7, 25)], body)
    s.rect(16, 16, 20, 27, mag)
    s.rrect(17, 5, 23, 10, 1, '#e8e4d8', flat=True)
    return s


def cannon(body='#4a4a50', mouth=HASH, gold=False):
    s = Sprite(32)
    c = GOLD if gold else body
    s.poly([(4, 18), (24, 6), (29, 13), (9, 25)], c, gloss=True)
    s.ellipse(27, 9, 4, 4, ramp(c)[1])
    s.ellipse(27, 9, 2, 2, mouth)
    s.ellipse(9, 24, 5, 5, '#5a3a1e')
    s.ellipse(9, 24, 2, 2, '#2a1a10')
    return s


def railgun(body='#6a7a8a', glow='#50f0ff'):
    s = Sprite(32)
    s.rect(2, 11, 30, 13, body, gloss=True)
    s.rect(2, 17, 30, 19, body, gloss=True)
    s.rect(6, 13, 30, 17, glow, flat=True)
    s.poly([(4, 19), (11, 19), (9, 27), (3, 27)], '#3a3a44')
    return s


def minigun(body=DIAMOND):
    s = Sprite(32)
    for y in (9, 12, 15):
        s.rect(12, y, 30, y + 2, '#8d99a6', gloss=True)
    s.rrect(4, 8, 14, 19, 3, body, gloss=True)
    s.poly([(6, 19), (12, 19), (10, 27), (5, 27)], '#3a3a44')
    return s


def blaster(body=GREEN, tip='#40f040', candle=False):
    s = Sprite(32)
    s.rrect(5, 9, 24, 16, 3, body, gloss=True)
    s.rect(24, 11, 29, 14, '#5a5a60')
    s.poly([(8, 15), (14, 15), (12, 26), (6, 26)], '#3a3a44')
    if candle:
        s.rect(15, 3, 18, 9, '#40d040', gloss=True)
        s.line([(16, 1), (16, 10)], '#2a9a2a')
    else:
        s.ellipse(14, 12, 2, 2, tip)
    return s


def staff(wood=OAK, orb='#e0e0f0', crook=False, spiral=False, crystal=False, moon=False):
    s = Sprite(32)
    s.thick([(5, 29), (22, 9)], 3, wood)
    if crook:
        s.thick([(22, 9), (25, 5), (22, 2), (19, 4)], 2, wood)
    if spiral:
        s.thick([(8, 25), (11, 24), (11, 21), (14, 20), (14, 17), (17, 16)], 1, '#e0c050')
    if crystal:
        s.poly([(24, 1), (28, 6), (25, 13), (21, 8)], orb, gloss=True)
    elif moon:
        s.ellipse(24, 7, 6, 6, orb, gloss=True)
        s.ellipse(26, 5, 4, 4, '#1d2038')
    else:
        s.ellipse(24, 7, 5, 5, orb, gloss=True)
    return s


def pick(head=IRON, handle=OAK, glow=None):
    s = Sprite(32)
    s.thick([(6, 28), (20, 10)], 3, handle)
    s.poly([(8, 6), (17, 3), (26, 4), (31, 10), (25, 8), (18, 8), (10, 10)], head, gloss=True)
    if glow:
        s.line([(14, 6), (24, 6)], glow)
    return s


def toolkit(c=RED, latch=SILVER, tools=None):
    s = Sprite(32)
    s.rrect(3, 12, 29, 27, 2, c)
    s.thick([(11, 11), (12, 7), (20, 7), (21, 11)], 2, '#3a3a3a')
    s.rect(3, 17, 29, 18, ramp(c)[1], flat=True)
    s.rect(14, 16, 18, 19, latch)
    for i, t in enumerate(tools or []):
        s.rect(6 + i * 4, 9, 8 + i * 4, 13, t)
    return s


def cards(c=WHITE, ink='#404040', edge=None, n=3):
    s = Sprite(32)
    for i in range(n):
        o = (n - 1 - i) * 2
        s.rrect(4 + o, 9 - o + 2, 26 + o, 23 - o + 2, 1, c, gloss=True)
    if edge:
        s.rect(4, 11, 26, 12, edge, flat=True)
    s.line([(7, 17), (16, 17)], ink).line([(7, 20), (13, 20)], ink)
    s.rect(19, 16, 23, 21, ramp(c)[1], flat=True)
    return s


def paper(c=PAPER, lines=5, stamp=None, fold=True, ink='#504840', title=None):
    s = Sprite(32)
    s.poly([(7, 3), (21, 3), (26, 8), (26, 29), (7, 29)], c, flat=True, rim=True)
    if fold:
        s.poly([(21, 3), (26, 8), (21, 8)], ramp(c)[1], flat=True)
    if title:
        s.rect(9, 6, 18, 7, title)
    for i in range(lines):
        y = 11 + i * 3
        s.line([(9, y), (23 - (i % 3) * 3, y)], ink)
    if stamp:
        s.ellipse(20, 24, 4, 3, stamp)
    return s


def scroll(c=PAPER, seal=RED, ribbon=None):
    s = Sprite(32)
    s.rect(7, 6, 25, 26, c, flat=True)
    s.ellipse(16, 6, 10, 2, ramp(c)[1])
    s.ellipse(16, 26, 10, 2, ramp(c)[1])
    for y in (10, 13, 16):
        s.line([(10, y), (22, y)], '#7a6a50')
    if ribbon:
        s.rect(15, 18, 17, 29, ribbon)
    s.ellipse(16, 21, 4, 4, seal, gloss=True)
    return s


def envelope(c='#9a9a98', seal='#4060a0'):
    s = Sprite(32)
    s.rect(3, 8, 29, 25, c, flat=True)
    s.line([(3, 8), (16, 18), (29, 8)], ramp(c)[1])
    s.ellipse(16, 18, 3, 3, seal, gloss=True)
    return s


def blueprint():
    s = Sprite(32)
    s.rect(4, 5, 28, 27, '#2a5aa0', flat=True)
    s.ellipse(28, 16, 2, 11, '#1e4278')
    s.line([(8, 9), (20, 9), (20, 20), (8, 20), (8, 9)], '#c0d8f0')
    s.line([(13, 9), (13, 20)], '#c0d8f0').line([(8, 14), (20, 14)], '#c0d8f0')
    s.line([(22, 22), (25, 22)], '#c0d8f0')
    return s


def book(c=BLACK, page='#e8e0c8', clasp=GOLD, mark=None):
    s = Sprite(32)
    s.rrect(6, 4, 26, 28, 2, page, flat=True)
    s.rrect(5, 3, 24, 27, 2, c)
    s.rect(7, 3, 8, 27, ramp(c)[0], flat=True)
    s.rect(22, 13, 25, 16, clasp)
    if mark:
        s.rect(12, 9, 19, 13, mark)
    return s


def rolodex(c='#606870', cardc=WHITE, gold=False):
    s = Sprite(32)
    body = GOLD if gold else c
    s.ellipse(16, 15, 9, 9, cardc, flat=True)
    for x in range(9, 24, 2):
        s.line([(x, 8), (x, 22)], '#b0aa98')
    s.poly([(4, 18), (28, 18), (26, 28), (6, 28)], body, gloss=gold)
    s.ellipse(5, 21, 2, 3, body).ellipse(27, 21, 2, 3, body)
    return s


def can(c, label=WHITE, mark=None):
    s = Sprite(32)
    s.rrect(9, 5, 23, 28, 3, c, gloss=True)
    s.ellipse(16, 5, 7, 2, SILVER)
    s.rect(9, 12, 23, 20, label, flat=True)
    if mark:
        s.poly([(14, 13), (19, 13), (16, 16), (19, 16), (13, 20), (15, 17), (13, 17)], mark)
    return s


def cup(c='#f0ece0', liquid='#5a3418', sleeve=None, steam=True, small=False):
    s = Sprite(32)
    if small:
        s.poly([(9, 14), (21, 14), (19, 26), (11, 26)], c, gloss=True)
        s.ring(23, 19, 3, 3, 2, c)
        s.ellipse(15, 14, 6, 2, liquid)
        s.ellipse(15, 27, 9, 2, c)
    else:
        s.poly([(8, 8), (24, 8), (22, 28), (10, 28)], c, gloss=True)
        s.ellipse(16, 8, 8, 2, liquid)
        if sleeve:
            s.rect(9, 14, 23, 21, sleeve)
    if steam:
        s.line([(13, 6 if small else 3), (14, 4 if small else 1)], '#d8d8d8')
        s.line([(18, 7 if small else 4), (17, 5 if small else 2)], '#d8d8d8')
    return s


def bottle(c, liquid, cork=OAK, square=False, wide=False):
    s = Sprite(32)
    if wide:
        s.poly([(10, 4), (22, 4), (24, 28), (8, 28)], c, gloss=True)
        s.rect(8, 13, 24, 28, liquid, gloss=True)
        s.rect(13, 1, 19, 4, cork)
    elif square:
        s.rect(12, 4, 20, 9, c)
        s.rrect(7, 9, 25, 28, 2, liquid, gloss=True)
        s.rect(13, 1, 19, 4, cork)
        s.rect(10, 15, 22, 21, PAPER, flat=True)
    else:
        s.rect(13, 3, 19, 11, c, gloss=True)
        s.ellipse(16, 20, 9, 9, liquid, gloss=True)
        s.rect(13, 1, 19, 3, cork)
    return s


def glass(liquid, straw='#e04040', fruit='#40c040'):
    s = Sprite(32)
    s.poly([(7, 6), (25, 6), (21, 28), (11, 28)], liquid, gloss=True)
    s.ellipse(16, 6, 9, 2, '#f0f0f0')
    s.thick([(19, 6), (24, 0)], 2, straw)
    s.ellipse(9, 6, 3, 3, fruit, gloss=True)
    return s


def vial(c='#f4f4f8', cap=SILVER, glow=None, n=1):
    s = Sprite(32)
    xs = [16] if n == 1 else [10, 18]
    for x in xs:
        s.rrect(x - 4, 7, x + 4, 28, 4, c, gloss=True)
        s.rect(x - 4, 4, x + 4, 7, cap)
        if glow:
            s.rect(x - 3, 16, x + 3, 26, glow, gloss=True)
    return s


def hash_chunk(c, glow=None, crystal=False, hexes=True):
    s = Sprite(32)
    if crystal:
        s.poly([(16, 2), (24, 10), (21, 28), (11, 28), (8, 10)], c, gloss=True)
        s.poly([(16, 2), (16, 28), (11, 28), (8, 10)], ramp(c)[3], gloss=True)
        s.line([(16, 2), (16, 27)], ramp(c)[4])
    else:
        s.poly([(5, 14), (11, 6), (22, 5), (28, 13), (25, 25), (12, 28), (4, 22)], c, gloss=True)
        if hexes:
            s.line([(10, 14), (13, 12), (16, 14), (16, 17), (13, 19), (10, 17), (10, 14)], ramp(c)[1])
            s.line([(16, 14), (19, 12), (22, 14), (22, 17), (19, 19), (16, 17)], ramp(c)[1])
            s.line([(13, 19), (13, 22), (16, 24), (19, 22), (19, 19)], ramp(c)[1])
        if glow:
            s.dots([(13, 15), (19, 15), (16, 21), (8, 12), (24, 19)], glow)
    return s


def tabloid(c=PAPER, headline=RED, steam=None):
    s = Sprite(32)
    s.poly([(4, 8), (26, 4), (28, 25), (6, 29)], c, flat=True)
    s.poly([(7, 9), (24, 6), (25, 11), (8, 14)], headline, flat=True)
    s.line([(8, 17), (24, 14)], '#605850').line([(9, 20), (18, 18)], '#605850').line([(9, 23), (24, 20)], '#605850')
    s.rect(20, 17, 24, 22, '#8a8070', flat=True)
    if steam:
        s.line([(22, 3), (23, 1)], steam).line([(26, 3), (27, 0)], steam)
    return s


def bubble(c=WHITE, mark=None, bolt=False):
    s = Sprite(32)
    s.rrect(3, 4, 28, 21, 6, c, gloss=True)
    s.poly([(8, 20), (14, 20), (7, 28)], c)
    if bolt:
        s.poly([(17, 6), (12, 13), (16, 13), (13, 19), (20, 11), (16, 11), (19, 6)], '#f0c020')
    else:
        s.line([(8, 10), (22, 10)], mark or '#505050').line([(8, 14), (18, 14)], mark or '#505050')
    return s


def mic(head=SILVER, body='#2a2a30', gold=False):
    s = Sprite(32)
    s.thick([(9, 27), (19, 14)], 4, GOLD if gold else body)
    s.ellipse(22, 10, 6, 6, head, gloss=True)
    s.line([(19, 7), (25, 13)], ramp(head)[1]).line([(18, 10), (22, 14)], ramp(head)[1])
    s.dots([(28, 22), (29, 25), (26, 26)], '#f0e040')
    return s


def ticket(c, glyph_color='#ffffff', glyph='arrow'):
    s = Sprite(32)
    s.poly([(2, 9), (30, 9), (30, 13), (28, 15), (30, 17), (30, 23), (2, 23), (2, 17), (4, 15), (2, 13)], c)
    s.line([(22, 10), (22, 22)], ramp(c)[1])
    if glyph == 'arrow':
        s.poly([(7, 16), (13, 11), (13, 14), (18, 14), (18, 18), (13, 18), (13, 21)], glyph_color, flat=True)
    elif glyph == 'tent':
        s.poly([(6, 20), (12, 11), (18, 20)], glyph_color, flat=True)
        s.poly([(11, 20), (12, 16), (13, 20)], c, flat=True)
    elif glyph == 'door':
        s.rect(8, 12, 15, 20, glyph_color, flat=True)
        s.ellipse(11, 12, 4, 2, glyph_color, flat=True)
        s.px(13, 16, c)
    s.dots([(25, 12), (26, 15), (25, 18)], ramp(c)[4])
    return s


def rounds(c=GOLD, tip='#b06a30', n=3):
    s = Sprite(32)
    for i in range(n):
        x = 7 + i * 7
        y = 10 + (i % 2) * 3
        s.rect(x, y + 6, x + 5, y + 17, c, gloss=True)
        s.ellipse(x + 2.5, y + 5, 2.5, 5, tip, gloss=True)
        s.rect(x, y + 15, x + 5, y + 16, ramp(c)[1], flat=True)
    return s


def bag(c='#b8b0a0', label='#606060', text='#d0d0d0'):
    s = Sprite(32)
    s.poly([(6, 6), (26, 6), (28, 28), (4, 28)], c)
    s.rect(6, 4, 26, 7, ramp(c)[1])
    s.rect(9, 13, 23, 22, label, flat=True)
    s.line([(11, 16), (21, 16)], text).line([(11, 19), (18, 19)], text)
    return s


def beam(c=STEEL):
    s = Sprite(32)
    s.poly([(2, 20), (22, 4), (30, 8), (10, 26)], c, gloss=True)
    s.poly([(4, 21), (22, 7), (27, 9), (9, 24)], ramp(c)[1])
    s.dots([(8, 20), (13, 16), (18, 12), (23, 8)], ramp(c)[4])
    return s


def circuit(c='#2a7a3a'):
    s = Sprite(32)
    s.rect(3, 7, 29, 25, c, flat=False)
    s.rect(11, 12, 19, 20, '#202428')
    for x in (12, 14, 16, 18):
        s.px(x, 11, SILVER).px(x, 21, SILVER)
    s.line([(5, 10), (9, 10), (9, 14)], GOLD).line([(21, 16), (27, 16)], GOLD).line([(6, 22), (10, 22)], GOLD)
    s.ellipse(24, 11, 2, 2, '#c03030')
    return s


def tin(c='#40b0b0', label=WHITE):
    s = Sprite(32)
    s.rrect(4, 9, 28, 24, 5, c, gloss=True)
    s.rrect(4, 9, 28, 14, 4, ramp(c)[3], gloss=True)
    s.rrect(10, 16, 22, 21, 2, label, flat=True)
    return s


def lozenge(c='#e070a0'):
    s = Sprite(32)
    s.ellipse(12, 18, 7, 5, c, gloss=True)
    s.ellipse(21, 12, 7, 5, c, gloss=True)
    s.line([(18, 11), (24, 13)], ramp(c)[4])
    return s


def teleprompter():
    s = Sprite(32)
    s.thick([(16, 18), (16, 27)], 2, '#3a3a40')
    s.thick([(10, 28), (22, 28)], 2, '#3a3a40')
    s.rrect(4, 4, 28, 19, 1, '#2a2a30')
    s.rect(6, 6, 26, 17, '#1e4a7a', flat=True)
    for y in (8, 11, 14):
        s.line([(8, y), (23 - (y % 4), y)], '#c8e0f8')
    return s


def key(c=GOLD, gem=None):
    s = Sprite(32)
    s.ring(10, 11, 7, 7, 3, c)
    s.thick([(15, 15), (28, 28)], 3, c, gloss=True)
    s.thick([(24, 24), (21, 27)], 2, c).thick([(27, 21), (25, 25)], 2, c)
    if gem:
        s.ellipse(10, 11, 2, 2, gem, gloss=True)
    return s


def canister(c=SILVER, fill=None):
    s = Sprite(32)
    s.rrect(9, 5, 23, 29, 4, c, gloss=True)
    s.rect(13, 2, 19, 5, '#3a3a40')
    if fill:
        s.rect(11, 13, 21, 25, fill, gloss=True)
    else:
        s.rect(11, 13, 21, 25, '#3a3e44', flat=True)
    s.line([(11, 12), (21, 12)], ramp(c)[1])
    return s


def drive(c='#30343a', plug=SILVER, light='#40f040'):
    s = Sprite(32)
    s.rrect(6, 10, 22, 24, 2, c, gloss=True)
    s.rect(22, 13, 29, 21, plug, gloss=True)
    s.rect(25, 15, 27, 16, '#202020').rect(25, 18, 27, 19, '#202020')
    s.px(9, 13, light)
    s.rect(9, 17, 18, 21, PAPER, flat=True)
    return s


def power_cell(c='#3a4a5a', glow='#60f0d0'):
    s = Sprite(32)
    s.rrect(8, 6, 24, 29, 3, c, gloss=True)
    s.rect(13, 3, 19, 6, SILVER)
    s.rect(11, 10, 21, 25, glow, gloss=True)
    s.poly([(17, 11), (13, 18), (16, 18), (14, 24), (19, 16), (16, 16)], '#f0ffff', flat=True)
    return s


def sproto(c='#3f6fe0', glow=None, wings=False, size=1.0):
    """A Sproto: round blue sprite-creature with big eyes and stubby ears."""
    s = Sprite(32)
    s.ellipse(16, 18, 10 * size, 9 * size, c)
    s.poly([(8, 12), (9, 3), (14, 10)], c).poly([(24, 12), (23, 3), (18, 10)], c)
    s.ellipse(16, 21, 5, 4, ramp(c)[3], flat=True)
    s.ellipse(12, 16, 2, 3, WHITE, flat=True, rim=False).ellipse(20, 16, 2, 3, WHITE, flat=True, rim=False)
    s.px(12, 17, '#101020').px(20, 17, '#101020').px(12, 16, '#101020').px(20, 16, '#101020')
    s.ellipse(11, 27, 3, 2, ramp(c)[1]).ellipse(21, 27, 3, 2, ramp(c)[1])
    if glow:
        s.dots([(5, 8), (27, 9), (4, 20), (28, 22)], glow)
    return s


def coffee_bag(c=BLUE, band='#f2c11e'):
    s = Sprite(32)
    s.poly([(7, 6), (25, 6), (27, 28), (5, 28)], c)
    s.poly([(7, 3), (25, 3), (25, 7), (7, 7)], ramp(c)[1])
    s.rect(8, 13, 24, 21, band, flat=True)
    s.ellipse(16, 17, 3, 2, '#5a3418')
    s.line([(16, 15), (16, 19)], '#3a200c')
    return s


# ── item model → icon ─────────────────────────────────────────────────────
@icon('icon_scrap_hash')
def _(): return hash_chunk('#8a8a84')
@icon('icon_warm_hash')
def _(): return hash_chunk('#d0803a', glow='#ffd070')
@icon('icon_molten_hash')
def _(): return hash_chunk('#d03a1a', glow='#ffe040')
@icon('icon_hash_crystal')
def _(): return hash_chunk('#40c8e8', crystal=True)
@icon('icon_raw_minor_scandal')
def _(): return tabloid(headline='#d0b020')
@icon('icon_raw_juicy_scandal')
def _(): return tabloid(headline='#e07020', steam='#d8d8d8')
@icon('icon_raw_mega_scandal')
def _(): return tabloid(headline='#c01818', steam='#f0f0f0')
@icon('icon_tp_soundbite')
def _(): return bubble()
@icon('icon_tp_zinger')
def _(): return bubble(bolt=True)
@icon('icon_tp_mic_drop')
def _(): return mic(gold=True)
@icon('icon_pick_rusty')
def _(): return pick(RUST)
@icon('icon_pick_steel')
def _(): return pick(STEEL)
@icon('icon_pick_quantum')
def _(): return pick('#8a50d0', glow='#d0a0ff')
@icon('icon_pick_overclocked')
def _(): return pick('#d04020', handle='#3a3a40', glow='#ffd040')
@icon('icon_donor_list')
def _(): return paper(lines=6, title='#2f6fd1')
@icon('icon_guest_list')
def _(): return paper(c='#ece4cc', lines=6, title='#a02828', stamp='#a08040')
@icon('icon_rolodex')
def _(): return rolodex()
@icon('icon_golden_rolodex')
def _(): return rolodex(gold=True)
@icon('icon_black_book')
def _(): return book()
@icon('icon_business_cards')
def _(): return cards()
@icon('icon_gold_cards')
def _(): return cards('#e0b030', ink='#6a4a10')
@icon('icon_platinum_cards')
def _(): return cards('#c8ccd4', ink='#404850', edge='#ffffff')
@icon('icon_diamond_cards')
def _(): return cards('#90e0f4', ink='#205a70', edge='#ffffff')
@icon('icon_toolkit_basic')
def _(): return toolkit(RED)
@icon('icon_toolkit_pro')
def _(): return toolkit('#d08020', tools=[SILVER, '#303030'])
@icon('icon_toolkit_elite')
def _(): return toolkit('#3a3a44', latch=GOLD, tools=[SILVER, GOLD, '#c03030'])
@icon('icon_toolkit_master')
def _(): return toolkit('#6a2a9a', latch=GOLD, tools=[GOLD, SILVER, DIAMOND, '#c03030'])
@icon('icon_gavel')
def _(): return gavel('#6a3a1a', '#3a2410', GOLD)
@icon('icon_oak_gavel')
def _(): return gavel(OAK, DARKWOOD, '#c8a060')
@icon('icon_iron_gavel')
def _(): return gavel(IRON, DARKWOOD, '#c8ccd0')
@icon('icon_veto_hammer')
def _(): return gavel('#a02828', '#3a2410', GOLD, big=True)
@icon('icon_gavel_of_order')
def _(): return gavel(GOLD, '#3a2410', '#ffffff', big=True)
@icon('icon_filibuster_mace')
def _(): return mace()
@icon('icon_briefcase_bludgeon')
def _(): return briefcase()
@icon('icon_gun_campaign_pistol')
def _(): return pistol(accent='#c02828')
@icon('icon_gun_confetti_shotgun')
def _(): return shotgun()
@icon('icon_gun_press_pass_smg')
def _(): return smg()
@icon('icon_gun_hash_cannon')
def _(): return cannon()
@icon('icon_gun_treasury_rifle')
def _(): return pistol('#4a5a4a', OAK, accent=GOLD, long=True)
@icon('icon_gun_gremlin_blaster')
def _(): return blaster()
@icon('icon_gun_diamond_minigun')
def _(): return minigun()
@icon('icon_gun_golden_veto')
def _(): return cannon(mouth='#ff6020', gold=True)
@icon('icon_gun_flippening_railgun')
def _(): return railgun()
@icon('icon_ballot_blaster')
def _(): return pistol('#2f3f6b', '#3a3a44', accent=WHITE, big=True, barrel='#e8e4d8')
@icon('icon_rounds')
def _(): return rounds()
@icon('icon_coom')
def _(): return vial()
@icon('icon_campaign_hat')
def _(): return cap('#c02828', band=WHITE, brim='#2f3f6b')
@icon('icon_aviators')
def _(): return aviators()
@icon('icon_flak_helmet')
def _(): return helmet('#5a6a3a')
@icon('icon_kevlar_fedora')
def _(): return fedora('#3a3a40')
@icon('icon_power_fedora')
def _(): return fedora('#2a2a50', band=GOLD)
@icon('icon_diamond_helm')
def _(): return helmet(DIAMOND, visor='#205a70', crest='#e0f8ff')
@icon('icon_hard_hat')
def _(): return hard_hat()
@icon('icon_gala_top_hat')
def _(): return top_hat()
@icon('icon_press_headset')
def _(): return headset()
@icon('icon_moonward_hat')
def _(): return wizard_hat('#3a4a90', SILVER, stars='#f0f0ff')
@icon('icon_campaign_jacket')
def _(): return jacket(NAVY, lapel='#24315a', tie='#c02828')
@icon('icon_flak_vest')
def _(): return vest('#5a6a3a', plate='#6a7a4a')
@icon('icon_kevlar_suit')
def _(): return jacket('#2a2a30', lapel='#3a3a44', tie='#2a2a30')
@icon('icon_diamond_plate')
def _(): return plate(DIAMOND, '#e8faff', gem='#ffffff')
@icon('icon_hi_vis_vest')
def _(): return vest('#e8d020', plate=None)
@icon('icon_gala_tailcoat')
def _(): return tailcoat()
@icon('icon_power_suit')
def _(): return jacket('#2a2a50', lapel='#1e1e3a', tie=GOLD)
@icon('icon_press_blazer')
def _(): return jacket('#7a2a2a', lapel='#5a1e1e', tie=None, buttons=[18, 22])
@icon('icon_moonward_robe')
def _(): return robe('#3a4a90', SILVER)
@icon('icon_campaign_slacks')
def _(): return trousers('#2a3456', belt='#2a1a10')
@icon('icon_flak_pants')
def _(): return trousers('#5a6a3a', plates=True)
@icon('icon_kevlar_trousers')
def _(): return trousers('#2a2a30', belt='#101010')
@icon('icon_diamond_greaves')
def _(): return trousers(DIAMOND, plates=True)
@icon('icon_work_trousers')
def _(): return trousers('#4a5a7a', belt=LEATHER, pockets=True, stripe='#e8d020')
@icon('icon_gala_trousers')
def _(): return trousers('#25252c', stripe='#4a4a54')
@icon('icon_power_trousers')
def _(): return trousers('#2a2a50', belt='#101010')
@icon('icon_press_slacks')
def _(): return trousers('#5a4a3a', belt='#2a1a10')
@icon('icon_grip_gloves')
def _(): return gloves(LEATHER)
@icon('icon_trigger_gloves')
def _(): return gloves('#2a2a30', fingerless=True)
@icon('icon_diamond_gauntlets')
def _(): return gloves(DIAMOND, cuff='#5ab0d0', gem='#ffffff')
@icon('icon_campaign_loafers')
def _(): return boots('#5a3418', tall=False)
@icon('icon_combat_boots')
def _(): return boots('#3a3a2a', laces='#c8c0a0')
@icon('icon_diamond_boots')
def _(): return boots(DIAMOND, sole='#3a6a80', shine=True)
@icon('icon_steel_toe_boots')
def _(): return boots('#8a5a2a', laces='#e0c060', sole='#3a3a3a')
@icon('icon_patent_shoes')
def _(): return boots('#1e1e24', tall=False, shine=True)
@icon('icon_power_loafers')
def _(): return boots('#4a2a1a', tall=False, shine=True, stripe=GOLD)
@icon('icon_press_sneakers')
def _(): return boots(WHITE, sole='#c03030', tall=False, stripe=BLUE)
@icon('icon_press_lanyard')
def _(): return lanyard()
@icon('icon_gavel_pendant')
def _(): return pendant()
@icon('icon_ticker_amulet')
def _(): return pendant(charm='candle')
@icon('icon_contract_recruit')
def _(): return scroll(seal='#7a7a7a')
@icon('icon_contract_medic')
def _(): return scroll(seal='#e8e8e8', ribbon='#c02828')
@icon('icon_contract_grunt')
def _(): return scroll(seal='#5a6a3a')
@icon('icon_contract_sniper')
def _(): return scroll(seal='#2f6fd1', ribbon='#203050')
@icon('icon_contract_heavy')
def _(): return scroll(seal='#c02828', ribbon=GOLD)
@icon('icon_concrete_bag')
def _(): return bag()
@icon('icon_steel_beam')
def _(): return beam()
@icon('icon_circuit_board')
def _(): return circuit()
@icon('icon_focus_soda')
def _(): return can('#2a8a9a', mark='#f0c020')
@icon('icon_protein_shake')
def _(): return bottle('#e0dcd0', '#c08050', cork='#3a3a40', wide=True)
@icon('icon_thick_skin_tonic')
def _(): return bottle('#a0b8a0', '#5aa050', square=True)
@icon('icon_victory_smoothie')
def _(): return glass('#e05a8a')
@icon('icon_miners_espresso')
def _(): return cup(small=True)
@icon('icon_charm_tea')
def _(): return cup(c='#e8f0e0', liquid='#a0a040', small=True)
@icon('icon_networking_mints')
def _(): return tin()
@icon('icon_smooth_lozenge')
def _(): return lozenge()
@icon('icon_hopium_soda')
def _(): return can(GREEN, mark='#f0c020')
@icon('icon_blue_sproto_coffee')
def _(): return coffee_bag()
@icon('icon_leaked_memo')
def _(): return paper(lines=5, stamp='#c02828', title='#c02828')
@icon('icon_sproto_pup')
def _(): return sproto(size=0.85)
@icon('icon_ticket_treasury')
def _(): return ticket('#d9a520', '#ffffff', 'arrow')
@icon('icon_ticket_trenches')
def _(): return ticket('#5a7a3a', '#f0e8c0', 'tent')
@icon('icon_ticket_bunker')
def _(): return ticket('#6a6a74', '#e0e0e0', 'door')
@icon('icon_teleprompter')
def _(): return teleprompter()
@icon('icon_chamber_key')
def _(): return key(gem='#50f0ff')
@icon('icon_empty_canister')
def _(): return canister()
@icon('icon_coolant_canister')
def _(): return canister(fill='#40a0f0')
@icon('icon_coordinates_drive')
def _(): return drive()
@icon('icon_power_cell')
def _(): return power_cell()
@icon('icon_sealed_envelope')
def _(): return envelope()
@icon('icon_blackmail_photo')
def _():
    s = Sprite(32)
    s.rect(5, 5, 27, 27, WHITE, flat=True)
    s.rect(8, 8, 24, 21, '#8a9aa0', flat=True)
    s.ellipse(16, 13, 3, 3, '#e0b090', flat=True)
    s.poly([(10, 21), (12, 16), (20, 16), (22, 21)], '#2f3f6b', flat=True)
    s.line([(9, 9), (23, 20)], '#c02828').line([(23, 9), (9, 20)], '#c02828')
    return s
@icon('icon_photo_negatives')
def _():
    s = Sprite(32)
    s.poly([(2, 12), (28, 6), (30, 17), (4, 23)], '#4a3020')
    for i in range(3):
        x = 6 + i * 8
        s.poly([(x, 13 - i * 2), (x + 6, 12 - i * 2), (x + 7, 18 - i * 2), (x + 1, 19 - i * 2)], '#c07a40', flat=True)
    for i in range(6):
        s.px(4 + i * 4, 11 - i, '#1a1008').px(6 + i * 4, 21 - i, '#1a1008')
    return s
@icon('icon_exit_permit')
def _(): return paper(lines=4, stamp='#2f6fd1', title='#3a3a3a')
@icon('icon_press_release')
def _(): return paper(c='#f0ece0', lines=6, title=BLACK, stamp=GOLD)
@icon('icon_chamber_blueprints')
def _(): return blueprint()
@icon('icon_staff_apprentice')
def _(): return staff(OAK, '#9ac070', crook=True)
@icon('icon_staff_hopium')
def _(): return staff('#6a4a8a', '#60e060', crystal=True)
@icon('icon_staff_moonward')
def _(): return staff('#b8c2cc', '#f0f0ff', moon=True)
@icon('icon_staff_archmage')
def _(): return staff('#3a2a5a', '#c070ff', spiral=True)

# Bitcoin gear (balance proposal): own icons so they stop borrowing other models.
@icon('icon_sproto_clown_nose')
def _(): return clown_nose()
@icon('icon_hopium_hoodie')
def _(): return hoodie('#40a040')
@icon('icon_attention_whistle')
def _(): return pendant(chain='#c02828', charm='whistle', color=SILVER)
@icon('icon_gremlin_mittens')
def _(): return gloves('#4ab040', cuff='#2a7a2a', mitten=True)
@icon('icon_bark_rock_mallet')
def _():
    s = Sprite(32)
    s.thick([(7, 27), (18, 13)], 3, OAK)
    s.ellipse(21, 10, 8, 7, '#8a8278', gloss=True)
    s.line([(18, 5), (21, 10), (19, 15)], '#3a342c')
    return s
@icon('icon_wrangler_hat')
def _(): return fedora('#9a6a3a', band='#3f6fe0')
@icon('icon_wrangler_gloves')
def _(): return gloves('#9a6a3a', cuff='#3f6fe0')
@icon('icon_wrangler_boots')
def _(): return boots('#7a4a26', laces='#3f6fe0', sole='#4a3018')
@icon('icon_sludge_stained_tie')
def _(): return tie()
@icon('icon_green_candle_blaster')
def _(): return blaster(candle=True)
@icon('icon_pump_it_staff')
def _(): return staff('#6a4a8a', '#40f040', crystal=True, spiral=True)
@icon('icon_ten_spiral_hat')
def _(): return wizard_hat('#5a2a8a', GOLD, stars=GOLD, spirals=True)
@icon('icon_spin_dash_sneakers')
def _(): return boots('#2f6fd1', sole=WHITE, tall=False, stripe='#c02828')
@icon('icon_ten_inu_collar')
def _(): return collar()
@icon('icon_never_sell_maul')
def _(): return gavel('#5a5a64', '#2a1a10', DIAMOND, big=True)
@icon('icon_boots_of_motion')
def _(): return boots('#c02828', laces=GOLD, stripe=GOLD)
@icon('icon_gremlin_cargos')
def _(): return trousers('#5a7a3a', belt=LEATHER, pockets=True)
@icon('icon_tartarian_dome_helm')
def _(): return dome_helm('#c8b890', '#3f6fe0')
@icon('icon_star_fort_plate')
def _(): return plate('#a89c80', GOLD, star=True)
@icon('icon_gate_stone_greaves')
def _(): return trousers('#9a9284', plates=True)
@icon('icon_opal_charging_gauntlets')
def _(): return gloves('#d0e0e8', cuff='#a0b0c0', gem='#e070f0')
@icon('icon_sproto_power_medallion')
def _(): return pendant(charm='medallion', color='#3f6fe0')
@icon('icon_spiral_staff')
def _(): return staff('#4a2a1a', GOLD, spiral=True)


# ── tab icons (26×26) ─────────────────────────────────────────────────────
def tab(name):
    def deco(fn):
        TABS[name] = fn
        return fn
    return deco


@tab('combat')
def _():
    s = Sprite(26)
    s.thick([(4, 21), (20, 5)], 3, SILVER, gloss=True)
    s.thick([(22, 21), (6, 5)], 3, SILVER, gloss=True)
    s.thick([(3, 17), (9, 23)], 2, GOLD).thick([(23, 17), (17, 23)], 2, GOLD)
    s.thick([(2, 24), (4, 22)], 2, OAK).thick([(24, 24), (22, 22)], 2, OAK)
    return s


@tab('skills')
def _():
    s = Sprite(26)
    s.rect(3, 13, 7, 23, '#c03030', gloss=True)
    s.rect(9, 8, 13, 23, '#3f9a3a', gloss=True)
    s.rect(15, 4, 19, 23, '#2f6fd1', gloss=True)
    s.rect(2, 23, 22, 24, '#5a5048', flat=True)
    return s


@tab('quests')
def _():
    s = Sprite(26)
    s.rect(5, 4, 20, 21, PAPER, flat=True)
    s.ellipse(12.5, 4, 8, 2, '#c8b890')
    s.ellipse(12.5, 21, 8, 2, '#c8b890')
    for y in (8, 11, 14, 17):
        s.line([(8, y), (17, y)], '#7a6a50')
    s.thick([(20, 6), (23, 2)], 1, '#e8e0f0')
    return s


@tab('inventory')
def _():
    s = Sprite(26)
    s.rrect(4, 6, 21, 23, 5, '#8a5a2b')
    s.thick([(9, 6), (10, 2), (15, 2), (16, 6)], 2, '#5a3a1c')
    s.rrect(6, 12, 19, 21, 3, '#6e4420')
    s.rect(11, 12, 14, 15, GOLD)
    return s


@tab('equipment')
def _():
    s = Sprite(26)
    s.rect(12, 18, 13, 24, OAK, flat=True)
    s.rect(7, 23, 18, 24, OAK, flat=True)
    s.ellipse(12.5, 5, 3, 3, '#a8b0b8', gloss=True)
    s.poly([(6, 9), (19, 9), (21, 13), (18, 13), (17, 19), (8, 19), (7, 13), (4, 13)], '#a8b0b8', gloss=True)
    s.line([(12, 10), (12, 18)], '#6a727a')
    return s


@tab('summoning')
def _():
    """Sproto summon sigil: a glowing ring with a Sproto face."""
    s = Sprite(26)
    s.ring(12.5, 12.5, 11, 11, 2, '#5ad0f0', gloss=True)
    s.ellipse(12.5, 14, 6, 5.5, '#3f6fe0')
    s.poly([(7, 11), (7, 4), (11, 9)], '#3f6fe0').poly([(18, 11), (18, 4), (14, 9)], '#3f6fe0')
    s.px(10, 13, WHITE).px(15, 13, WHITE).px(10, 14, '#101020').px(15, 14, '#101020')
    s.dots([(12, 0), (0, 12), (24, 12), (12, 24)], '#c0f4ff')
    return s


@tab('settings')
def _():
    s = Sprite(26)
    s.thick([(4, 22), (15, 11)], 4, '#a8b0b8', gloss=True)
    s.ellipse(18, 8, 6, 6, '#a8b0b8', gloss=True)
    s.erase_poly([(18, 8), (22, 1), (26, 1), (26, 5), (25, 6)])
    s.ellipse(5, 21, 1, 1, '#5a6068', flat=True)
    return s


def main(argv):
    os.makedirs(ICON_DIR, exist_ok=True)
    os.makedirs(UI_DIR, exist_ok=True)
    items = []
    for name, fn in ICONS.items():
        im = fn().render()
        im.save(os.path.join(ICON_DIR, f'{name}.png'), optimize=True)
        items.append((name, im))
    tabs = []
    for name, fn in TABS.items():
        im = fn().render()
        im.save(os.path.join(UI_DIR, f'tab_{name}.png'), optimize=True)
        tabs.append((name, im))
    if '--sheet' in argv:
        sheet(items, 12, 3).save('/tmp/icons_sheet.png')
        sheet(tabs, 7, 4).save('/tmp/tabs_sheet.png')
    print(len(items), 'item icons,', len(tabs), 'tab icons')


if __name__ == '__main__':
    main(sys.argv)
