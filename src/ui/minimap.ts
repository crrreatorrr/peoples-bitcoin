/**
 * Minimap: a top-down 2D render of the zone's tile grid that turns with the
 * camera. Yellow dots are NPCs, red dots ground items, the white square is the
 * player and the red pin is the walk destination. Pressing the map walks there;
 * the wheel zooms it; clicking the compass turns the camera north.
 */
import { UI } from '../config/balance';
import type { Content } from '../sim/content';
import type { ZoneDef } from '../sim/schemas';
import type { Tile } from '../sim/state';

export interface MinimapAssets {
  entry(id: string): { color: string };
  glyph(id: string): string;
}

export interface MinimapView {
  /** Player position in world units (tile x + 0.5, tile y + 0.5). */
  playerX: number;
  playerZ: number;
  /** Camera yaw in radians; 0 = looking north. */
  yaw: number;
  npcs: Tile[];
  groundItems: Tile[];
  destination: Tile | null;
}

const COMPASS_SIZE = 30;
const DOT = 3;
const OBJECT_INSET = 0.5;

export class Minimap {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly compass: CanvasRenderingContext2D;
  private base: HTMLCanvasElement | null = null;
  private icons: { glyph: string; x: number; y: number }[] = [];
  private view: MinimapView | null = null;
  /** Current zoom, in pixels per tile. */
  private px: number = UI.minimapPxPerTile;

  constructor(
    root: HTMLElement,
    private readonly content: Content,
    private readonly assets: MinimapAssets,
    handlers: { walk(tile: Tile): void; faceNorth(): void },
  ) {
    const size = UI.minimapSize;
    const map = document.createElement('canvas');
    map.className = 'minimap';
    map.width = map.height = size;
    map.title = 'Click to walk';
    this.ctx = map.getContext('2d')!;

    const compass = document.createElement('canvas');
    compass.className = 'compass';
    compass.width = compass.height = COMPASS_SIZE;
    compass.title = 'Face north';
    this.compass = compass.getContext('2d')!;

    root.replaceChildren(map, compass);

    map.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const tile = this.tileAt(e.offsetX, e.offsetY);
      if (tile) handlers.walk(tile);
    });
    map.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const [min, max] = UI.minimapZoomPx;
        this.px = Math.min(max, Math.max(min, this.px * (e.deltaY < 0 ? 1.25 : 0.8)));
      },
      { passive: false },
    );
    map.addEventListener('contextmenu', (e) => e.preventDefault());
    compass.addEventListener('click', () => handlers.faceNorth());
  }

  /** Redraws the static map for a zone (call on zone change). */
  setZone(zone: ZoneDef): void {
    this.base = renderZone(zone, this.content, this.assets);
    this.icons = zone.mapIcons.map((i) => ({ glyph: this.assets.glyph(i.icon), x: i.x, y: i.y }));
  }

  draw(view: MinimapView): void {
    this.view = view;
    const ctx = this.ctx;
    const size = UI.minimapSize;
    const half = size / 2;
    const px = this.px;

    ctx.save();
    ctx.clearRect(0, 0, size, size);
    ctx.beginPath();
    ctx.arc(half, half, half, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, size, size);
    ctx.translate(half, half);
    ctx.rotate(view.yaw);
    ctx.translate(-view.playerX * px, -view.playerZ * px);
    ctx.scale(px / UI.minimapPxPerTile, px / UI.minimapPxPerTile);
    if (this.base) ctx.drawImage(this.base, 0, 0);
    ctx.restore();

    const dot = (t: Tile, color: string) => {
      const [x, y] = this.toMap(t.x + 0.5, t.y + 0.5);
      ctx.fillStyle = '#000000';
      ctx.fillRect(Math.round(x - DOT / 2) + 1, Math.round(y - DOT / 2) + 1, DOT, DOT);
      ctx.fillStyle = color;
      ctx.fillRect(Math.round(x - DOT / 2), Math.round(y - DOT / 2), DOT, DOT);
    };
    for (const t of view.groundItems) dot(t, '#ff2a2a');
    for (const t of view.npcs) dot(t, '#ffff00');

    ctx.font = '11px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const icon of this.icons) {
      const [x, y] = this.toMap(icon.x + 0.5, icon.y + 0.5);
      if (Math.hypot(x - half, y - half) < half - 6) ctx.fillText(icon.glyph, x, y);
    }

    if (view.destination) {
      const [x, y] = this.toMap(view.destination.x + 0.5, view.destination.y + 0.5);
      ctx.fillStyle = '#ff2a2a';
      ctx.fillRect(Math.round(x), Math.round(y) - 7, 1, 7);
      ctx.fillRect(Math.round(x) + 1, Math.round(y) - 7, 4, 3);
    }

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(half - 2, half - 2, 4, 4);
    this.drawCompass(view.yaw);
  }

  /** World (tile-unit) position → minimap pixel, given the last drawn view. */
  private toMap(wx: number, wz: number): [number, number] {
    const v = this.view!;
    const px = this.px;
    const half = UI.minimapSize / 2;
    const dx = (wx - v.playerX) * px;
    const dz = (wz - v.playerZ) * px;
    const c = Math.cos(v.yaw);
    const s = Math.sin(v.yaw);
    return [half + dx * c - dz * s, half + dx * s + dz * c];
  }

  private tileAt(mx: number, my: number): Tile | null {
    const v = this.view;
    const half = UI.minimapSize / 2;
    const dx = mx - half;
    const dy = my - half;
    if (!v || Math.hypot(dx, dy) > half) return null;
    const px = this.px;
    const c = Math.cos(-v.yaw);
    const s = Math.sin(-v.yaw);
    return {
      x: Math.floor(v.playerX + (dx * c - dy * s) / px),
      y: Math.floor(v.playerZ + (dx * s + dy * c) / px),
    };
  }

  private drawCompass(yaw: number): void {
    const ctx = this.compass;
    const r = COMPASS_SIZE / 2;
    ctx.clearRect(0, 0, COMPASS_SIZE, COMPASS_SIZE);
    ctx.fillStyle = '#2a241d';
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(r, r, r - 1, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.save();
    ctx.translate(r, r);
    ctx.rotate(yaw);
    ctx.fillStyle = '#d93a2a';
    ctx.beginPath();
    ctx.moveTo(0, -r + 4);
    ctx.lineTo(4, 0);
    ctx.lineTo(-4, 0);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#e8e2d4';
    ctx.beginPath();
    ctx.moveTo(0, r - 4);
    ctx.lineTo(4, 0);
    ctx.lineTo(-4, 0);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#f2c14e';
    ctx.font = 'bold 9px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('N', 0, -r + 3);
    ctx.restore();
  }
}

/** The static part of the map: terrain colors plus blocking objects. */
function renderZone(zone: ZoneDef, content: Content, assets: MinimapAssets): HTMLCanvasElement {
  const px = UI.minimapPxPerTile;
  const canvas = document.createElement('canvas');
  canvas.width = zone.width * px;
  canvas.height = zone.height * px;
  const ctx = canvas.getContext('2d')!;
  zone.tiles.forEach((row, y) => {
    for (let x = 0; x < zone.width; x++) {
      const terrain = content.terrain.get(zone.legend[row[x]]);
      ctx.fillStyle = terrain ? assets.entry(terrain.model).color : '#000000';
      ctx.fillRect(x * px, y * px, px, px);
    }
  });
  for (const o of zone.objects) {
    const def = content.objects.get(o.objectId);
    if (!def?.blocks) continue;
    ctx.fillStyle = assets.entry(def.model).color;
    ctx.fillRect(
      o.x * px + OBJECT_INSET,
      o.y * px + OBJECT_INSET,
      def.width * px - OBJECT_INSET * 2,
      def.height * px - OBJECT_INSET * 2,
    );
  }
  return canvas;
}
