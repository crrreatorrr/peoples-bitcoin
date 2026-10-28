/**
 * Things characters hold and wear, built in code. Held models have the grip at
 * the origin and are built so that +y is up and +z is forward when the forearm
 * points straight ahead: barrels run along +z, handles along +y.
 *
 * GEAR is keyed by item id (weapons and tools the player can hold) and by
 * prop name (things NPCs and monsters carry, named in a manifest `look`).
 * ARMOR_LOOKS says how each wearable item changes a character's look.
 */
import * as THREE from 'three';
import { blob, box, cone, glow, group, lambert, shade, tube } from './kit';

/** How a held thing is carried, which picks the arm poses. */
export type HoldKind =
  'pistol' | 'rifle' | 'heavy' | 'melee' | 'item' | 'carry' | 'shield' | 'staff';

/** Name of the hidden flash mesh at a gun's muzzle. */
export const MUZZLE = 'muzzle';

interface GearDef {
  hold: HoldKind;
  build: () => THREE.Group;
}

const BLACK = '#1b1b1f';
const STEEL = '#8a929c';
const WOOD = '#7a4f2a';
const GOLD = '#e0b43a';
const DIAMOND = '#6fe3ff';

/** A mesh turned to lie along +z instead of +y. */
function alongZ(mesh: THREE.Mesh): THREE.Mesh {
  mesh.rotation.x = Math.PI / 2;
  return mesh;
}

/** A mesh turned to lie along x instead of y. */
function alongX(mesh: THREE.Mesh): THREE.Mesh {
  mesh.rotation.z = Math.PI / 2;
  return mesh;
}

function withMuzzle(g: THREE.Group, y: number, z: number, size = 0.08, color = '#ffd23f') {
  const flash = blob(size, glow(color), 0, y, z + size * 0.6);
  flash.name = MUZZLE;
  flash.visible = false;
  g.add(flash);
  return g;
}

// ── Guns ─────────────────────────────────────────────────────────────────────

function pistol(body: string, grip: string, trim?: string): THREE.Group {
  const g = group([
    box(0.06, 0.13, 0.08, lambert(grip), 0, -0.05, -0.02),
    box(0.07, 0.07, 0.28, lambert(body), 0, 0.04, 0.07),
  ]);
  if (trim) g.add(box(0.074, 0.02, 0.2, lambert(trim), 0, 0.08, 0.06));
  return withMuzzle(g, 0.04, 0.21);
}

interface RifleOptions {
  barrel?: string;
  length?: number;
  scope?: string;
  coil?: string;
  bore?: number;
}

function rifle(body: string, stock: string, opts: RifleOptions = {}): THREE.Group {
  const length = opts.length ?? 0.4;
  const bore = opts.bore ?? 0.025;
  const g = group([
    box(0.06, 0.13, 0.07, lambert(stock), 0, -0.05, 0),
    box(0.07, 0.11, 0.3, lambert(stock), 0, 0.02, -0.2),
    box(0.08, 0.1, 0.32, lambert(body), 0, 0.05, 0.12),
    alongZ(
      tube(
        bore,
        bore,
        length,
        lambert(opts.barrel ?? shade(body, 0.7)),
        0,
        0.06,
        0.28 + length / 2,
      ),
    ),
  ]);
  if (opts.scope) {
    g.add(alongZ(tube(0.035, 0.035, 0.2, lambert(opts.scope), 0, 0.14, 0.1)));
    g.add(blob(0.03, glow('#bfe8ff'), 0, 0.14, 0.21));
  }
  if (opts.coil) {
    for (let i = 0; i < 4; i++)
      g.add(box(0.1, 0.1, 0.03, glow(opts.coil), 0, 0.06, 0.34 + i * 0.09));
  }
  return withMuzzle(g, 0.06, 0.28 + length, 0.09, opts.coil ?? '#ffd23f');
}

function cannon(body: string, trim: string, shell: string, radius = 0.09): THREE.Group {
  const g = group([
    box(0.06, 0.13, 0.07, lambert(BLACK), 0, -0.05, 0),
    alongZ(tube(radius, radius * 1.15, 0.7, lambert(body), 0, 0.08, 0.12, 8)),
    alongZ(tube(radius * 1.25, radius * 1.25, 0.06, lambert(trim), 0, 0.08, 0.44, 8)),
    alongZ(tube(radius * 1.2, radius * 1.2, 0.05, lambert(trim), 0, 0.08, -0.16, 8)),
    blob(radius * 0.7, glow(shell), 0, 0.08, 0.46),
  ]);
  return withMuzzle(g, 0.08, 0.5, 0.14, '#ff8a1a');
}

function minigun(barrel: string, body: string): THREE.Group {
  const g = group([
    box(0.06, 0.13, 0.07, lambert(BLACK), 0, -0.05, 0),
    box(0.16, 0.16, 0.26, lambert(body), 0, 0.07, 0.02),
    box(0.1, 0.12, 0.12, lambert('#c9a64a'), 0.12, 0.02, 0),
  ]);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    g.add(
      alongZ(
        tube(
          0.018,
          0.018,
          0.5,
          lambert(barrel),
          Math.cos(a) * 0.05,
          0.07 + Math.sin(a) * 0.05,
          0.38,
        ),
      ),
    );
  }
  return withMuzzle(g, 0.07, 0.63, 0.1);
}

// ── Melee weapons and tools (handle along +y) ────────────────────────────────

function gavel(handle: string, head: string, size = 1, band?: string): THREE.Group {
  const g = group([
    box(0.04 * size, 0.46 * size, 0.04 * size, lambert(handle), 0, 0.14 * size, 0),
    alongZ(tube(0.07 * size, 0.07 * size, 0.24 * size, lambert(head), 0, 0.38 * size, 0, 8)),
  ]);
  if (band) {
    for (const z of [-0.08, 0.08]) {
      g.add(
        alongZ(
          tube(0.075 * size, 0.075 * size, 0.03 * size, lambert(band), 0, 0.38 * size, z * size, 8),
        ),
      );
    }
  }
  return g;
}

function mace(handle: string, head: string): THREE.Group {
  const g = group([
    box(0.045, 0.5, 0.045, lambert(handle), 0, 0.16, 0),
    blob(0.11, lambert(head), 0, 0.44, 0),
  ]);
  for (const [x, y, z] of [
    [0.12, 0.44, 0],
    [-0.12, 0.44, 0],
    [0, 0.44, 0.12],
    [0, 0.44, -0.12],
    [0, 0.57, 0],
  ]) {
    const spike = cone(0.03, 0.08, lambert(shade(head, 1.3)), x, y, z);
    spike.lookAt(new THREE.Vector3(x * 3, (y - 0.44) * 3 + 0.44, z * 3));
    spike.rotateX(Math.PI / 2);
    g.add(spike);
  }
  return g;
}

function pickaxe(head: string, glowing = false): THREE.Group {
  const mat = glowing ? glow(head) : lambert(head);
  const g = group([
    box(0.04, 0.5, 0.04, lambert(WOOD), 0, 0.15, 0),
    box(0.05, 0.06, 0.34, mat, 0, 0.4, 0.02),
  ]);
  const tip = cone(0.03, 0.12, mat, 0, 0.4, 0.24);
  tip.rotation.x = Math.PI / 2;
  const back = cone(0.03, 0.08, mat, 0, 0.4, -0.18);
  back.rotation.x = -Math.PI / 2;
  g.add(tip, back);
  return g;
}

function hammer(head: string, handle = WOOD): THREE.Group {
  return group([
    box(0.035, 0.36, 0.035, lambert(handle), 0, 0.1, 0),
    box(0.05, 0.06, 0.16, lambert(head), 0, 0.3, 0.02),
  ]);
}

function drill(): THREE.Group {
  return group([
    box(0.06, 0.14, 0.07, lambert(BLACK), 0, 0, 0),
    box(0.08, 0.09, 0.22, lambert('#ff7a1a'), 0, 0.1, 0.06),
    alongZ(tube(0.015, 0.015, 0.14, lambert(STEEL), 0, 0.1, 0.24)),
  ]);
}

function wrench(metal: string): THREE.Group {
  return group([
    box(0.04, 0.4, 0.025, lambert(metal), 0, 0.14, 0),
    box(0.11, 0.07, 0.025, lambert(metal), 0, 0.36, 0),
    box(0.03, 0.06, 0.025, lambert(metal), -0.04, 0.42, 0),
  ]);
}

// ── Held items (upright, facing forward) ─────────────────────────────────────

function clipboard(paper: string, board = WOOD): THREE.Group {
  return group([
    box(0.2, 0.27, 0.02, lambert(board), 0, 0.08, 0.05),
    box(0.17, 0.22, 0.01, lambert(paper), 0, 0.07, 0.065),
    box(0.06, 0.03, 0.02, lambert(STEEL), 0, 0.21, 0.07),
  ]);
}

function book(cover: string): THREE.Group {
  return group([
    box(0.17, 0.23, 0.06, lambert(cover), 0, 0.06, 0.05),
    box(0.15, 0.21, 0.05, lambert('#efe6cf'), 0.012, 0.06, 0.05),
  ]);
}

function cards(color: string): THREE.Group {
  const g = new THREE.Group();
  for (let i = -1; i <= 1; i++) {
    const card = box(0.07, 0.11, 0.01, lambert(color), i * 0.03, 0.08, 0.04 + i * 0.002);
    card.rotation.z = -i * 0.3;
    g.add(card);
  }
  return g;
}

function rolodex(card = '#d8d2c4'): THREE.Group {
  const g = group([
    alongX(tube(0.07, 0.07, 0.16, lambert(card), 0, 0.08, 0.05, 8)),
    box(0.2, 0.03, 0.12, lambert(BLACK), 0, 0, 0.05),
  ]);
  return g;
}

function megaphone(body: string, trim: string): THREE.Group {
  const horn = cone(0.11, 0.3, lambert(body), 0, 0.08, 0.2, 8);
  horn.rotation.x = -Math.PI / 2;
  return group([
    box(0.05, 0.12, 0.06, lambert(BLACK), 0, 0, 0),
    horn,
    alongZ(tube(0.115, 0.115, 0.03, lambert(trim), 0, 0.08, 0.34, 8)),
  ]);
}

function tablet(): THREE.Group {
  return group([
    box(0.24, 0.17, 0.02, lambert(BLACK), 0, 0.06, 0.05),
    box(0.21, 0.14, 0.01, glow('#3fa8ff'), 0, 0.06, 0.062),
  ]);
}

function tray(): THREE.Group {
  return group([
    tube(0.19, 0.19, 0.02, lambert(STEEL), 0, 0.02, 0.12, 10),
    blob(0.05, lambert('#c97a2b'), -0.06, 0.06, 0.1),
    blob(0.05, lambert('#d94a3a'), 0.05, 0.06, 0.14),
    blob(0.04, lambert('#f2d35a'), 0.02, 0.06, 0.04),
  ]);
}

function microphone(): THREE.Group {
  return group([
    box(0.04, 0.16, 0.04, lambert(BLACK), 0, 0.06, 0),
    blob(0.05, lambert('#3a3a40'), 0, 0.17, 0.01),
  ]);
}

function plans(): THREE.Group {
  return group([
    alongX(tube(0.035, 0.035, 0.34, lambert('#dfe9f5'), 0, 0.05, 0.05)),
    alongX(tube(0.03, 0.03, 0.3, lambert('#4a78c8'), 0.02, 0.1, 0.07)),
  ]);
}

function binoculars(): THREE.Group {
  return group([
    alongZ(tube(0.035, 0.035, 0.14, lambert(BLACK), -0.04, 0.06, 0.06)),
    alongZ(tube(0.035, 0.035, 0.14, lambert(BLACK), 0.04, 0.06, 0.06)),
  ]);
}

function phone(): THREE.Group {
  return group([box(0.05, 0.12, 0.02, lambert(BLACK), 0, 0.06, 0.03)]);
}

function club(): THREE.Group {
  return group([
    tube(0.04, 0.03, 0.3, lambert('#6b4a2b'), 0, 0.08, 0),
    tube(0.08, 0.05, 0.3, lambert('#7a5530'), 0, 0.36, 0),
    cone(0.025, 0.07, lambert(STEEL), 0.08, 0.42, 0),
  ]);
}

// ── Carried at the side (arm hanging: +z points down) ────────────────────────

function briefcase(color: string): THREE.Group {
  return group([
    box(0.04, 0.03, 0.08, lambert(BLACK), 0, 0, 0.02),
    box(0.08, 0.3, 0.22, lambert(color), 0, 0, 0.15),
    box(0.085, 0.04, 0.03, lambert(GOLD), 0, 0, 0.05),
  ]);
}

function medkit(): THREE.Group {
  return group([
    box(0.12, 0.26, 0.18, lambert('#f2f2f2'), 0, 0, 0.12),
    box(0.125, 0.14, 0.04, lambert('#d62828'), 0, 0, 0.12),
    box(0.125, 0.04, 0.12, lambert('#d62828'), 0, 0, 0.12),
  ]);
}

// ── Shields (upright, facing forward) ────────────────────────────────────────

// ── Staffs (shaft along +y, gripped a third of the way up) ────────────────────

/** A wizard staff: a shaft and a glowing head; spells fly from the head (the muzzle). */
function staff(
  shaft: string,
  head: string,
  shape: 'crystal' | 'orb' | 'moon' | 'arrow',
  trim?: string,
): THREE.Group {
  const g = group([tube(0.028, 0.034, 1.45, lambert(shaft), 0, 0.27, 0, 6)]);
  const top = 1.0;
  const gem = glow(head);
  switch (shape) {
    case 'crystal':
      g.add(cone(0.06, 0.22, gem, 0, top + 0.11, 0, 4));
      break;
    case 'orb':
      g.add(blob(0.1, gem, 0, top + 0.1, 0));
      for (const a of [0, 2.1, 4.2]) {
        g.add(
          box(
            0.02,
            0.16,
            0.02,
            lambert(trim ?? GOLD),
            Math.cos(a) * 0.09,
            top + 0.07,
            Math.sin(a) * 0.09,
          ),
        );
      }
      break;
    case 'moon': {
      const moon = tube(0.11, 0.11, 0.035, gem, 0, top + 0.12, 0, 10);
      moon.rotation.x = Math.PI / 2;
      g.add(moon, blob(0.05, lambert(shaft), 0.05, top + 0.12, 0));
      break;
    }
    case 'arrow':
      g.add(
        cone(0.08, 0.16, gem, 0, top + 0.13, 0, 4),
        box(0.05, 0.12, 0.05, gem, 0, top + 0.01, 0),
      );
      break;
  }
  if (trim) g.add(tube(0.042, 0.042, 0.06, lambert(trim), 0, top - 0.06, 0, 6));
  // Spells leave from the head, and the head flashes as they do.
  const flash = blob(0.13, glow('#f4e9ff'), 0, top + 0.12, 0);
  flash.name = MUZZLE;
  flash.visible = false;
  g.add(flash);
  return g;
}

function shield(face: string, w: number, h: number, mark?: string): THREE.Group {
  const g = group([box(w, h, 0.04, lambert(face), 0, 0.02, 0.1)]);
  if (mark) g.add(box(w * 0.4, h * 0.4, 0.01, lambert(mark), 0, 0.02, 0.125));
  return g;
}

export const GEAR: Record<string, GearDef> = {
  // Staffs: fire COOM, train Shooting
  staff_apprentice: { hold: 'staff', build: () => staff('#8a6a42', '#f4f4ff', 'crystal') },
  staff_hopium: { hold: 'staff', build: () => staff('#4a3423', '#5dff6b', 'arrow') },
  staff_moonward: { hold: 'staff', build: () => staff('#c9ced8', '#a8d8ff', 'moon', '#7d858f') },
  staff_archmage: { hold: 'staff', build: () => staff('#1d2a5a', '#ffffff', 'orb', GOLD) },
  staff_rugmancer: { hold: 'staff', build: () => staff('#2a1a12', '#6bff8a', 'orb', '#8a1d2a') },
  // Guns
  gun_campaign_pistol: { hold: 'pistol', build: () => pistol('#2b2d36', '#b3262e', '#e8e8e8') },
  gun_confetti_shotgun: {
    hold: 'rifle',
    build: () => rifle('#5a3d8a', WOOD, { barrel: '#ff5ad1', length: 0.3, bore: 0.04 }),
  },
  gun_press_pass_smg: {
    hold: 'pistol',
    build: () => {
      const g = pistol('#3a3f4a', BLACK);
      g.add(box(0.06, 0.08, 0.02, lambert('#f2f2f2'), 0.05, -0.08, 0.05));
      return g;
    },
  },
  gun_hash_cannon: { hold: 'heavy', build: () => cannon('#4a5568', '#8a929c', '#7cff6b') },
  gun_treasury_rifle: {
    hold: 'rifle',
    build: () => rifle('#2f5a3a', '#6b4a2b', { length: 0.5, scope: BLACK }),
  },
  gun_gremlin_blaster: {
    hold: 'rifle',
    build: () => rifle(GOLD, '#3a3a40', { length: 0.3, coil: '#4fd8ea', bore: 0.04 }),
  },
  gun_diamond_minigun: { hold: 'heavy', build: () => minigun(DIAMOND, '#3a4a5a') },
  gun_golden_veto: { hold: 'heavy', build: () => cannon(GOLD, '#b3262e', '#ff7a1a', 0.11) },
  gun_flippening_railgun: {
    hold: 'rifle',
    build: () => rifle('#2a2a3a', BLACK, { length: 0.55, coil: '#b85aff', scope: '#3a3a40' }),
  },
  // Melee
  item_gavel: { hold: 'melee', build: () => gavel('#8a5a2b', '#6b4a2b', 0.85) },
  item_oak_gavel: { hold: 'melee', build: () => gavel('#a8743a', '#9a6a35', 1, GOLD) },
  item_iron_gavel: { hold: 'melee', build: () => gavel(WOOD, STEEL, 1.1, BLACK) },
  item_veto_hammer: { hold: 'melee', build: () => gavel(BLACK, '#b3262e', 1.35, GOLD) },
  item_filibuster_mace: { hold: 'melee', build: () => mace('#3a2a1c', GOLD) },
  // Tools
  item_pick_rusty: { hold: 'melee', build: () => pickaxe('#a0552b') },
  item_pick_steel: { hold: 'melee', build: () => pickaxe(STEEL) },
  item_pick_quantum: { hold: 'melee', build: () => pickaxe('#4fd8ea', true) },
  item_donor_list: { hold: 'item', build: () => clipboard('#f4f0e2') },
  item_rolodex: { hold: 'item', build: () => rolodex() },
  item_black_book: { hold: 'item', build: () => book('#141414') },
  item_business_cards: { hold: 'item', build: () => cards('#f4f4f4') },
  item_gold_cards: { hold: 'item', build: () => cards(GOLD) },
  item_platinum_cards: { hold: 'item', build: () => cards('#d8e4ea') },
  item_toolkit_basic: { hold: 'melee', build: () => hammer(STEEL) },
  item_toolkit_pro: { hold: 'melee', build: () => drill() },
  item_toolkit_elite: { hold: 'melee', build: () => wrench(GOLD) },
  item_pick_overclocked: { hold: 'melee', build: () => pickaxe('#b85aff', true) },
  item_golden_rolodex: { hold: 'item', build: () => rolodex(GOLD) },
  item_diamond_cards: { hold: 'item', build: () => cards(DIAMOND) },
  item_toolkit_master: { hold: 'melee', build: () => wrench(DIAMOND) },
  item_briefcase_bludgeon: {
    hold: 'melee',
    build: () =>
      group([
        box(0.04, 0.34, 0.04, lambert(BLACK), 0, 0.1, 0),
        box(0.08, 0.24, 0.3, lambert('#6b3f22'), 0, 0.36, 0.04),
        box(0.085, 0.04, 0.05, lambert(GOLD), 0, 0.36, 0.2),
      ]),
  },
  gun_ballot_blaster: {
    hold: 'rifle',
    build: () => rifle('#2f4fa8', '#f2f2f2', { length: 0.35, bore: 0.035, barrel: '#d62828' }),
  },
  item_gavel_of_order: { hold: 'melee', build: () => gavel('#141418', GOLD, 1.5, '#b3262e') },
  // NPC and monster props
  pistol: { hold: 'pistol', build: () => pistol(BLACK, '#3a3a40') },
  sniper: {
    hold: 'rifle',
    build: () => rifle('#4b5a2e', '#3a3a2a', { length: 0.6, scope: BLACK }),
  },
  minigun: { hold: 'heavy', build: () => minigun('#3a3a40', '#4b5a2e') },
  megaphone: { hold: 'melee', build: () => megaphone('#f2f2f2', '#d62828') },
  club: { hold: 'melee', build: () => club() },
  book: { hold: 'item', build: () => book('#2f6b3a') },
  tablet: { hold: 'item', build: () => tablet() },
  tray: { hold: 'item', build: () => tray() },
  microphone: { hold: 'item', build: () => microphone() },
  playing_cards: { hold: 'item', build: () => cards('#f4f4f4') },
  plans: { hold: 'item', build: () => plans() },
  binoculars: { hold: 'item', build: () => binoculars() },
  phone: { hold: 'item', build: () => phone() },
  clipboard: { hold: 'item', build: () => clipboard('#f4f0e2') },
  envelope: {
    hold: 'item',
    build: () => group([box(0.2, 0.13, 0.02, lambert('#c9a66b'), 0, 0.06, 0.05)]),
  },
  briefcase: { hold: 'carry', build: () => briefcase('#6b3f22') },
  medkit: { hold: 'carry', build: () => medkit() },
  wood_shield: { hold: 'shield', build: () => shield('#8a5a2b', 0.34, 0.42, STEEL) },
  cardboard_shield: { hold: 'shield', build: () => shield('#b8925a', 0.4, 0.5, '#d62828') },
  stone_shield: { hold: 'shield', build: () => shield('#6a6a70', 0.42, 0.6, '#d62828') },
};

/** A fresh model of a held thing, or null if there's no such gear. */
export function gearModel(id: string): { model: THREE.Group; hold: HoldKind } | null {
  const def = GEAR[id];
  return def ? { model: def.build(), hold: def.hold } : null;
}

export function holdOf(id: string | null | undefined): HoldKind | null {
  return (id && GEAR[id]?.hold) || null;
}

/** How wearing an item changes a look (see LookSchema in actors.ts). */
export const ARMOR_LOOKS: Record<string, Record<string, string>> = {
  item_campaign_hat: { hat: 'cap', hatColor: '#b3262e' },
  item_moonward_hat: { hat: 'wizard', hatColor: '#1d2a5a' },
  item_moonward_robe: { vest: '#1d2a5a' },
  item_aviators: { glasses: 'aviators' },
  item_flak_helmet: { hat: 'helmet', hatColor: '#4b5a2e' },
  item_kevlar_fedora: { hat: 'fedora', hatColor: '#1c1c22' },
  item_diamond_helm: { hat: 'helm', hatColor: DIAMOND },
  item_campaign_jacket: { top: '#b3262e', sleeves: '#b3262e' },
  item_flak_vest: { vest: '#4b5a2e' },
  item_kevlar_suit: { top: '#1c1c22', sleeves: '#1c1c22', tie: '#4a4a55' },
  item_diamond_plate: { plate: DIAMOND },
  item_campaign_slacks: { pants: '#c8b48a' },
  item_flak_pants: { pants: '#4b5a2e', pads: '#2b2b2b' },
  item_kevlar_trousers: { pants: '#1c1c22' },
  item_diamond_greaves: { greaves: DIAMOND },
  // Skilling outfits
  item_hard_hat: { hat: 'hardhat', hatColor: '#f2c11e' },
  item_hi_vis_vest: { vest: '#e8e030' },
  item_work_trousers: { pants: '#8a6a42' },
  item_steel_toe_boots: { feet: '#5a3a1c' },
  item_gala_top_hat: { hat: 'tophat', hatColor: '#141418' },
  item_gala_tailcoat: { vest: '#141418' },
  item_gala_trousers: { pants: '#141418' },
  item_patent_shoes: { feet: '#0a0a0a' },
  item_power_fedora: { hat: 'fedora', hatColor: '#3a3a44' },
  item_power_suit: { vest: '#3a3a44' },
  item_power_trousers: { pants: '#3a3a44' },
  item_power_loafers: { feet: '#6b3f22' },
  item_press_headset: { hat: 'headset', hatColor: '#202024' },
  item_press_blazer: { vest: '#1f8a8a' },
  item_press_slacks: { pants: '#2b2b33' },
  item_press_sneakers: { feet: '#f2f2f2' },
  // Neck, hands, feet
  item_press_lanyard: { neck: '#1f8a8a' },
  item_gavel_pendant: { neck: '#8a5a2b' },
  item_ticker_amulet: { neck: '#3fdc5a' },
  item_grip_gloves: { hands: '#6b4a2b' },
  item_trigger_gloves: { hands: '#141418' },
  item_diamond_gauntlets: { hands: DIAMOND },
  item_campaign_loafers: { feet: '#6b3f22' },
  item_combat_boots: { feet: '#3a3a2a' },
  item_diamond_boots: { feet: DIAMOND },
};
