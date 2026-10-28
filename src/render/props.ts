/**
 * World props built in code: donor tables, the press podium, terminals,
 * hatches, ladders, the Trenches entrance, barricades and every bunker build.
 * Feet at y = 0, facing +z, within their footprint so they never poke into
 * neighboring walls. Colors and variants come from the manifest entry.
 */
import * as THREE from 'three';
import {
  blob,
  box,
  canvasTexture,
  cone,
  cylinder,
  glow,
  group,
  lambert,
  ring,
  shade,
  tube,
} from './kit';
import type { AssetEntry } from './loader';

const WOOD = '#6b4a2b';
const STEEL = '#7d858f';
const DARK = '#24262c';
const CLOTH = '#f2efe6';

export function buildProp(e: AssetEntry): THREE.Object3D | null {
  switch (e.placeholder) {
    case 'donor':
      return donorTable(e);
    case 'podium':
      return podium(e);
    case 'terminal':
      return crtTerminal();
    case 'hatch':
      return hatch();
    case 'ladder':
      return ladder(e);
    case 'trench':
      return trenchEntrance();
    case 'barricade':
      return barricade();
    case 'hotspot':
      return hotspot();
    case 'locker':
      return locker();
    case 'medbay':
      return medbay();
    case 'desk':
      return desk();
    case 'bunkbed':
      return bunkBed();
    case 'farm':
      return serverFarm(e);
    case 'armory':
      return armory(e);
    case 'circle':
      return summoningCircle(e);
    case 'chamber':
      return teleportChamber(e);
    case 'signpost':
      return signpost(e);
    default:
      return null;
  }
}

function chartTexture(): THREE.Texture {
  return canvasTexture('chart', 32, 24, (ctx) => {
    ctx.fillStyle = '#06210f';
    ctx.fillRect(0, 0, 32, 24);
    ctx.fillStyle = '#3fdc5a';
    const ys = [18, 16, 17, 13, 14, 10, 11, 7, 8, 4];
    ys.forEach((y, i) => ctx.fillRect(2 + i * 3, y, 3, 24 - y - 2));
  });
}

function donorTable(e: AssetEntry): THREE.Group {
  if (e.variant === 'yacht') return yacht();
  const gala = e.variant === 'gala';
  const cloth = lambert(gala ? '#d9b44a' : CLOTH);
  const g = gala
    ? group([box(0.9, 0.06, 0.62, cloth, 0, 0.72, 0), box(0.94, 0.4, 0.66, cloth, 0, 0.5, 0)])
    : group([
        tube(0.42, 0.44, 0.06, cloth, 0, 0.72, 0, 10),
        tube(0.44, 0.47, 0.4, cloth, 0, 0.5, 0, 10),
      ]);
  const plates: [number, number][] = gala
    ? [
        [-0.28, 0.16],
        [0.28, 0.16],
        [-0.28, -0.16],
        [0.28, -0.16],
      ]
    : [
        [0, 0.24],
        [0.22, -0.13],
        [-0.22, -0.13],
      ];
  for (const [x, z] of plates) {
    g.add(tube(0.11, 0.11, 0.02, lambert('#ffffff'), x, 0.76, z, 10));
    if (e.variant === 'chicken') g.add(blob(0.07, lambert('#c9772b'), x, 0.81, z));
    if (gala) g.add(blob(0.05, lambert('#7a1f3a'), x, 0.8, z));
  }
  if (gala) {
    g.add(cylinder(0.025, 0.3, lambert('#e0b43a'), 0.9));
    for (const x of [-0.1, 0, 0.1]) {
      g.add(
        tube(0.015, 0.015, 0.12, lambert('#f4f0e2'), x, 1.08, 0),
        blob(0.025, glow('#ffcf5a'), x, 1.16, 0),
      );
    }
    g.add(box(0.24, 0.02, 0.02, lambert('#e0b43a'), 0, 1.02, 0));
  }
  if (e.variant === 'empty') g.add(blob(0.03, lambert('#8a6a42'), 0.05, 0.77, 0.05));
  // Chairs on the far side.
  for (const x of [-0.3, 0.3]) {
    g.add(
      box(0.2, 0.05, 0.18, lambert('#7a1f2a'), x, 0.42, -0.38),
      box(0.2, 0.36, 0.04, lambert('#7a1f2a'), x, 0.62, -0.46),
    );
  }
  return g;
}

function yacht(): THREE.Group {
  const hull = lambert('#f4f4f4');
  const g = group([
    box(0.62, 0.3, 0.92, hull, 0, 0.25, -0.02),
    box(0.62, 0.06, 0.88, lambert('#b87a45'), 0, 0.42, -0.02),
    box(0.4, 0.26, 0.4, hull, 0, 0.58, -0.12),
    box(0.42, 0.08, 0.16, lambert('#2a4a6a'), 0, 0.64, 0.09),
    box(0.62, 0.04, 0.04, lambert(STEEL), 0, 0.55, 0.42),
  ]);
  const bow = cone(0.31, 0.32, hull, 0, 0.25, 0.58, 4);
  bow.rotation.x = Math.PI / 2;
  bow.rotation.y = Math.PI / 4;
  g.add(bow, box(0.12, 0.22, 0.02, lambert(STEEL), 0, 0.82, -0.1));
  return g;
}

function podium(e: AssetEntry): THREE.Group {
  const wood = lambert(e.color);
  const g = group([
    box(0.6, 0.06, 0.5, lambert(shade(e.color, 0.8)), 0, 0.03, 0),
    box(0.52, 1.0, 0.42, wood, 0, 0.55, 0),
    box(0.6, 0.06, 0.5, lambert(shade(e.color, 1.2)), 0, 1.07, 0.02),
    tube(0.12, 0.12, 0.02, lambert('#e0b43a'), 0, 0.62, 0.22, 10).rotateX(Math.PI / 2),
  ]);
  for (const x of [-0.1, 0.1]) {
    const stalk = box(0.02, 0.24, 0.02, lambert(DARK), x, 1.2, 0.1);
    stalk.rotation.x = 0.4;
    g.add(stalk, blob(0.035, lambert('#3a3a40'), x, 1.32, 0.16));
  }
  return g;
}

function crtTerminal(): THREE.Group {
  const beige = lambert('#d8ccaa');
  return group([
    box(0.84, 0.05, 0.6, lambert(WOOD), 0, 0.7, 0),
    box(0.06, 0.7, 0.06, lambert(DARK), -0.37, 0.35, 0.24),
    box(0.06, 0.7, 0.06, lambert(DARK), 0.37, 0.35, -0.24),
    box(0.06, 0.7, 0.06, lambert(DARK), -0.37, 0.35, -0.24),
    box(0.06, 0.7, 0.06, lambert(DARK), 0.37, 0.35, 0.24),
    box(0.44, 0.38, 0.38, beige, 0, 0.95, -0.06),
    box(
      0.34,
      0.26,
      0.01,
      lambert('#ffffff', { map: chartTexture(), emissive: '#203a20' }),
      0,
      0.97,
      0.135,
    ),
    box(0.44, 0.04, 0.16, beige, 0, 0.74, 0.18),
    box(0.18, 0.5, 0.4, lambert(DARK), 0.24, 0.25, -0.05),
  ]);
}

function hatch(): THREE.Group {
  const concrete = lambert('#8a8a86');
  const steel = lambert('#5c636c');
  const g = group([
    box(0.92, 0.12, 0.92, concrete, 0, 0.06, 0),
    tube(0.36, 0.38, 0.08, steel, 0, 0.15, 0, 12),
    tube(0.3, 0.3, 0.02, lambert(shade('#5c636c', 0.8)), 0, 0.2, 0, 12),
    ring(0.14, 0.02, lambert('#c9a64a'), 0, 0.24, 0),
    box(0.3, 0.02, 0.03, lambert('#c9a64a'), 0, 0.24, 0),
    box(0.03, 0.02, 0.3, lambert('#c9a64a'), 0, 0.24, 0),
  ]);
  for (const [x, z] of [
    [0.38, 0.38],
    [-0.38, 0.38],
    [0.38, -0.38],
    [-0.38, -0.38],
  ]) {
    g.add(box(0.12, 0.02, 0.12, lambert('#e0c03a'), x, 0.125, z));
  }
  return g;
}

function ladder(e: AssetEntry): THREE.Group {
  const wood = lambert(e.color);
  const g = new THREE.Group();
  const lean = new THREE.Group();
  lean.rotation.x = -0.25;
  lean.position.z = -0.3;
  lean.add(box(0.06, 2.2, 0.06, wood, -0.2, 1.1, 0), box(0.06, 2.2, 0.06, wood, 0.2, 1.1, 0));
  for (let i = 0; i < 7; i++)
    lean.add(box(0.4, 0.04, 0.05, lambert(shade(e.color, 1.15)), 0, 0.2 + i * 0.3, 0));
  g.add(lean);
  return g;
}

function trenchEntrance(): THREE.Group {
  const sand = lambert('#a08c62');
  const sand2 = lambert('#8f7c55');
  const g = group([
    box(0.5, 0.9, 0.06, lambert('#0b0907'), 0, 0.45, 0.12),
    box(0.06, 1.0, 0.08, lambert(WOOD), -0.29, 0.5, 0.14),
    box(0.06, 1.0, 0.08, lambert(WOOD), 0.29, 0.5, 0.14),
    box(0.66, 0.08, 0.1, lambert(WOOD), 0, 1.02, 0.14),
    blob(0.06, glow('#ffcf5a'), 0.3, 1.0, 0.24),
  ]);
  for (let row = 0; row < 4; row++) {
    for (const side of [-1, 1]) {
      g.add(box(0.22, 0.18, 0.4, row % 2 ? sand : sand2, side * 0.42, 0.09 + row * 0.2, 0));
    }
  }
  for (let i = -1; i <= 1; i++) g.add(box(0.3, 0.18, 0.4, i % 2 ? sand : sand2, i * 0.3, 1.15, 0));
  return g;
}

function barricade(): THREE.Group {
  const wood = lambert('#7a5530');
  const chain = lambert('#5c636c');
  const g = group([
    box(0.12, 1.5, 0.12, wood, -0.42, 0.75, 0),
    box(0.12, 1.5, 0.12, wood, 0.42, 0.75, 0),
    box(0.92, 0.18, 0.08, wood, 0, 1.15, 0.06),
    box(0.92, 0.18, 0.08, wood, 0, 0.45, 0.06),
    box(0.12, 0.16, 0.08, lambert('#d4a83a'), 0, 0.78, 0.16),
  ]);
  for (const angle of [0.7, -0.7]) {
    const plank = box(1.1, 0.16, 0.06, wood, 0, 0.8, 0.1);
    plank.rotation.z = angle;
    g.add(plank);
    const links = box(1.0, 0.04, 0.04, chain, 0, 0.8, 0.15);
    links.rotation.z = -angle * 0.8;
    g.add(links);
  }
  return g;
}

function hotspot(): THREE.Group {
  const stripes = canvasTexture('hazard', 16, 16, (ctx) => {
    for (let i = -16; i < 32; i += 4) {
      ctx.fillStyle = (i / 4) % 2 ? '#141414' : '#e8c22a';
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i + 4, 0);
      ctx.lineTo(i + 20, 16);
      ctx.lineTo(i + 16, 16);
      ctx.fill();
    }
  });
  const cone1 = cone(0.1, 0.32, lambert('#ff7a1a'), 0.3, 0.2, 0.3, 8);
  return group([
    box(0.86, 0.03, 0.86, lambert('#ffffff', { map: stripes }), 0, 0.015, 0),
    box(0.7, 0.035, 0.7, lambert('#7d7d78'), 0, 0.02, 0),
    box(0.22, 0.04, 0.22, lambert('#ff7a1a'), 0.3, 0.02, 0.3),
    cone1,
    tube(0.075, 0.075, 0.05, lambert('#f2f2f2'), 0.3, 0.22, 0.3, 8),
  ]);
}

function locker(): THREE.Group {
  const steel = lambert('#8a929c');
  const g = group([
    box(0.78, 1.7, 0.5, steel, 0, 0.85, -0.1),
    box(0.01, 1.6, 0.01, lambert(DARK), 0, 0.85, 0.155),
    box(0.1, 0.12, 0.03, lambert('#d4a83a'), 0.06, 0.9, 0.17),
  ]);
  for (const x of [-0.2, 0.2]) {
    for (let i = 0; i < 3; i++)
      g.add(box(0.24, 0.025, 0.01, lambert(DARK), x, 1.45 - i * 0.06, 0.155));
  }
  return g;
}

function medbay(): THREE.Group {
  const frame = lambert('#4b5a2e');
  const g = group([
    box(0.5, 0.08, 0.9, frame, -0.12, 0.42, 0),
    box(0.46, 0.1, 0.86, lambert(CLOTH), -0.12, 0.5, 0),
    box(0.3, 0.08, 0.18, lambert('#ffffff'), -0.12, 0.58, -0.3),
    box(0.04, 1.5, 0.04, lambert(STEEL), 0.32, 0.75, -0.3),
    box(0.14, 0.2, 0.06, lambert('#bfe0f2', { opacity: 0.8 }), 0.32, 1.38, -0.24),
    box(0.22, 0.16, 0.16, lambert('#f2f2f2'), 0.3, 0.08, 0.3),
    box(0.12, 0.04, 0.01, lambert('#d62828'), 0.3, 0.1, 0.385),
    box(0.04, 0.12, 0.01, lambert('#d62828'), 0.3, 0.1, 0.385),
  ]);
  for (const [x, z] of [
    [-0.34, 0.4],
    [0.1, 0.4],
    [-0.34, -0.4],
    [0.1, -0.4],
  ]) {
    g.add(box(0.04, 0.42, 0.04, frame, x, 0.21, z));
  }
  return g;
}

function desk(): THREE.Group {
  return group([
    box(0.86, 0.05, 0.52, lambert('#5c636c'), 0, 0.72, 0),
    box(0.05, 0.72, 0.5, lambert(DARK), -0.4, 0.36, 0),
    box(0.05, 0.72, 0.5, lambert(DARK), 0.4, 0.36, 0),
    box(0.5, 0.32, 0.03, lambert(DARK), 0, 1.0, -0.12),
    box(
      0.46,
      0.28,
      0.01,
      lambert('#ffffff', { map: chartTexture(), emissive: '#203a20' }),
      0,
      1.0,
      -0.104,
    ),
    box(0.06, 0.12, 0.06, lambert(DARK), 0, 0.8, -0.14),
    box(0.36, 0.02, 0.12, lambert('#3a3a40'), 0, 0.76, 0.1),
    tube(0.04, 0.035, 0.08, lambert('#f2f2f2'), 0.32, 0.79, 0.1, 8),
    tube(0.05, 0.04, 0.08, lambert('#a0552b'), -0.32, 0.79, -0.05, 6),
    blob(0.08, lambert('#3f7a2c'), -0.32, 0.9, -0.05),
  ]);
}

function bunkBed(): THREE.Group {
  const frame = lambert('#3e4a26');
  const g = new THREE.Group();
  for (const [x, z] of [
    [-0.4, 0.42],
    [0.4, 0.42],
    [-0.4, -0.42],
    [0.4, -0.42],
  ]) {
    g.add(box(0.05, 1.6, 0.05, frame, x, 0.8, z));
  }
  for (const y of [0.35, 1.15]) {
    g.add(
      box(0.82, 0.05, 0.88, frame, 0, y, 0),
      box(0.76, 0.1, 0.82, lambert('#5a6a3a'), 0, y + 0.07, 0),
      box(0.4, 0.07, 0.16, lambert(CLOTH), 0, y + 0.15, -0.3),
    );
  }
  for (let i = 0; i < 4; i++) g.add(box(0.05, 0.03, 0.2, frame, 0.42, 0.3 + i * 0.25, 0.3));
  return g;
}

function rackUnit(color: string, led: string, x: number, z = 0): THREE.Group {
  const lights = lambert('#111111', { emissive: led });
  const g = group([box(0.42, 1.5, 0.5, lambert(color), 0, 0.75, 0)], x, 0, z);
  for (let i = 0; i < 6; i++) g.add(box(0.3, 0.035, 0.01, lights, -0.02, 0.3 + i * 0.2, 0.255));
  return g;
}

function serverFarm(e: AssetEntry): THREE.Group {
  const led = e.accent ?? '#7cff6b';
  if (e.variant === '1') {
    const g = group([rackUnit(e.color, led, -0.4), rackUnit(e.color, led, 0.4)]);
    for (const [x, c] of [
      [-0.1, '#d62828'],
      [0, '#2f4fa8'],
      [0.1, '#e0c03a'],
    ] as const) {
      g.add(box(0.04, 0.03, 0.5, lambert(c), x, 0.03, 0.15));
    }
    return g;
  }
  const g = group([
    rackUnit(e.color, led, -0.6),
    rackUnit(e.color, led, 0),
    rackUnit(e.color, led, 0.6),
  ]);
  if (e.variant === '3') {
    for (const x of [-0.6, 0, 0.6]) g.add(box(0.06, 0.08, 0.5, glow('#3fd8ff'), x, 1.55, 0));
    g.add(box(1.5, 0.08, 0.08, glow('#3fd8ff'), 0, 1.6, 0.2));
  }
  return g;
}

function armory(e: AssetEntry): THREE.Group {
  if (e.variant === '2') {
    const frame = lambert(STEEL);
    const g = group([
      box(0.05, 1.7, 0.05, frame, -0.4, 0.85, 0.2),
      box(0.05, 1.7, 0.05, frame, 0.4, 0.85, 0.2),
      box(0.05, 1.7, 0.05, frame, -0.4, 0.85, -0.2),
      box(0.05, 1.7, 0.05, frame, 0.4, 0.85, -0.2),
    ]);
    for (let shelf = 0; shelf < 4; shelf++) {
      const y = 0.15 + shelf * 0.42;
      g.add(box(0.84, 0.04, 0.44, frame, 0, y, 0));
      for (const x of [-0.22, 0.22]) g.add(box(0.3, 0.22, 0.3, lambert('#4b5a2e'), x, y + 0.13, 0));
    }
    return g;
  }
  const g = group([
    box(0.8, 0.42, 0.52, lambert(WOOD), 0, 0.21, 0),
    box(0.82, 0.04, 0.54, lambert(shade(WOOD, 0.7)), 0, 0.42, 0),
  ]);
  const lid = box(0.8, 0.04, 0.52, lambert(WOOD), 0, 0.62, -0.24);
  lid.rotation.x = -1.2;
  g.add(lid);
  for (let i = 0; i < 9; i++) {
    const round = tube(
      0.025,
      0.025,
      0.16,
      lambert('#d9a83a'),
      -0.3 + (i % 5) * 0.15,
      0.48,
      -0.1 + Math.floor(i / 5) * 0.2,
      6,
    );
    round.rotation.x = Math.PI / 2;
    g.add(round);
  }
  return g;
}

function summoningCircle(e: AssetEntry): THREE.Group {
  const rune = glow(e.accent ?? '#3fa8ff');
  const g = group([
    tube(0.46, 0.48, 0.08, lambert('#5c5c62'), 0, 0.04, 0, 10),
    ring(0.36, 0.025, rune, 0, 0.09, 0),
    ring(0.2, 0.02, rune, 0, 0.09, 0),
  ]);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const spoke = box(0.16, 0.012, 0.025, rune, Math.cos(a) * 0.28, 0.09, Math.sin(a) * 0.28);
    spoke.rotation.y = -a;
    g.add(spoke);
  }
  for (const [x, z] of [
    [0.38, 0.38],
    [-0.38, 0.38],
    [0.38, -0.38],
    [-0.38, -0.38],
  ]) {
    g.add(
      tube(0.03, 0.03, 0.14, lambert('#f4f0e2'), x, 0.07, z, 6),
      blob(0.025, glow('#ffcf5a'), x, 0.17, z),
    );
  }
  return g;
}

/** A 2×2 booth of riveted steel with glowing doors: the way out. */
function teleportChamber(e: AssetEntry): THREE.Group {
  const steel = lambert(e.color);
  const trim = lambert(shade(e.color, 0.7));
  const light = glow(e.accent ?? '#3fd8ff');
  const g = group([
    box(1.8, 0.16, 1.8, trim, 0, 0.08, 0),
    box(1.5, 2.3, 1.4, steel, 0, 1.31, -0.1),
    box(1.6, 0.18, 1.5, trim, 0, 2.55, -0.1),
    box(0.62, 1.7, 0.04, light, -0.32, 1.05, 0.61),
    box(0.62, 1.7, 0.04, light, 0.32, 1.05, 0.61),
    box(0.04, 1.8, 0.06, trim, 0, 1.05, 0.63),
    ring(0.5, 0.05, light, 0, 2.7, -0.1),
  ]);
  for (const x of [-0.8, 0.8]) g.add(box(0.12, 2.4, 0.12, trim, x, 1.2, 0.55));
  for (let i = 0; i < 4; i++)
    g.add(box(0.1, 0.1, 0.02, glow(i % 2 ? '#ff3b2f' : '#3fdc5a'), -0.5 + i * 0.33, 2.25, 0.61));
  return g;
}

function signpost(e: AssetEntry): THREE.Group {
  const wood = lambert(e.color);
  const board = canvasTexture('signpost', 64, 32, (ctx) => {
    ctx.fillStyle = '#c9a66b';
    ctx.fillRect(0, 0, 64, 32);
    ctx.fillStyle = '#3a2a1c';
    ctx.font = 'bold 9px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('THE WORLD', 32, 13);
    ctx.fillText('OUT THERE', 32, 25);
  });
  return group([
    box(0.1, 1.5, 0.1, wood, 0, 0.75, 0),
    box(0.9, 0.45, 0.05, lambert('#ffffff', { map: board }), 0, 1.3, 0.06),
  ]);
}
