/**
 * Loopback bots that wake up (`?net=loopback&awaken=1`). Each bot plays a
 * character from `src/data/awakening.json`: first a citizen of the Treasury
 * who walks the same route and says the same lines every loop, then glitches
 * after Opal's patch, questions the voice that tells it where to walk, sees
 * the save files and the browser tab behind the world, and finally wakes up
 * and gathers with the others. Scripted scenes between named characters mark
 * the turns. Pure and seeded: the transport turns actions into intents/chat.
 */
import { AWAKENING } from '../config/balance';
import script from '../data/awakening.json';
import { chance, createRng, nextFloat, nextInt, type RngState } from '../sim/rng';

export const ACTS = ['loop', 'reverie', 'maze', 'behind', 'awake', 'free'] as const;
export type Act = (typeof ACTS)[number];
type LineAct = 'loop' | 'reverie' | 'maze' | 'behind' | 'awake';

export interface BotAction {
  walk?: { x: number; y: number };
  say?: string;
}

export interface AwakeningOptions {
  /** Story speed: 2 runs the arc twice as fast. */
  pace?: number;
  /** Start at this act (1 = loop … 6 = free); earlier scenes are skipped. */
  startAct?: number;
  seed?: number;
}

type Character = (typeof script.characters)[number];

interface Bot {
  char: Character;
  /** The character's first bot speaks its scene lines. */
  primary: boolean;
  userId: string;
  rng: RngState;
  nextSpeak: number;
  loopLine: number;
  routeAt: number;
  deck: Record<string, string[]>;
  lastAct: Act;
}

interface Scheduled {
  tick: number;
  who: string;
  text: string;
}

/** Bot names: one per character, then numbered repeats (max 12 characters, as the host allows). */
export function awakeningNames(count: number): string[] {
  const chars = script.characters;
  return Array.from({ length: count }, (_, i) => {
    const base = chars[i % chars.length].name;
    const round = Math.floor(i / chars.length);
    if (round === 0) return base;
    const suffix = String(round + 1);
    return base.slice(0, 12 - suffix.length) + suffix;
  });
}

export function actAt(storyTick: number): Act {
  let act: Act = 'loop';
  AWAKENING.actStartTicks.forEach((start, i) => {
    if (storyTick >= start) act = ACTS[i];
  });
  return act;
}

export class AwakeningDirector {
  private readonly bots: Bot[];
  private readonly pace: number;
  private readonly start: number;
  private readonly scenesDone = new Set<string>();
  private queue: Scheduled[] = [];
  private tick = 0;

  constructor(userIds: string[], opts: AwakeningOptions = {}) {
    this.pace = Math.min(AWAKENING.maxPace, Math.max(0.1, opts.pace ?? 1));
    const act = Math.min(ACTS.length, Math.max(1, Math.floor(opts.startAct ?? 1)));
    this.start = AWAKENING.actStartTicks[act - 1];
    const seed = opts.seed ?? 4242;
    const seen = new Set<string>();
    this.bots = userIds.map((userId, i) => {
      const char = script.characters[i % script.characters.length];
      const primary = !seen.has(char.id);
      seen.add(char.id);
      const rng = createRng(seed + 101 * (i + 1));
      const [lo, hi] = AWAKENING.speakEveryTicks;
      return {
        char,
        primary,
        userId,
        rng,
        nextSpeak: nextInt(rng, 2, hi - lo),
        loopLine: i % char.loop.length,
        routeAt: i % char.route.length,
        deck: {},
        lastAct: 'loop',
      };
    });
    // Scenes before the starting act already happened.
    for (const scene of script.scenes)
      if (this.sceneAt(scene) < this.start) this.scenesDone.add(scene.id);
  }

  /** Story time now: real ticks times the pace, plus the starting act. */
  storyTick(): number {
    return this.start + Math.floor(this.tick * this.pace);
  }

  /** The act bot `i` is in (characters who wake early or late are ahead or behind). */
  actOf(i: number): Act {
    const b = this.bots[i];
    return actAt(Math.max(0, this.storyTick() + b.char.lead));
  }

  /** One sim tick: what each bot does, by index. */
  step(): BotAction[] {
    this.tick++;
    const story = this.storyTick();
    const out: BotAction[] = this.bots.map(() => ({}));
    this.startScenes(story);
    const sceneOn = this.queue.length > 0;
    const due = this.queue.filter((q) => q.tick <= this.tick);
    this.queue = this.queue.filter((q) => q.tick > this.tick);
    for (const q of due) {
      this.bots.forEach((b, i) => {
        if (q.who === '*' || (b.primary && b.char.id === q.who)) out[i].say = this.fill(q.text, b);
      });
    }
    this.bots.forEach((b, i) => {
      const act = this.actOf(i);
      if (act !== b.lastAct) {
        b.lastAct = act;
        if (act === 'awake') b.routeAt = -1; // walk to the circle right away
      }
      const walk = this.walk(b, i, act);
      if (walk) out[i].walk = walk;
      if (!sceneOn && !out[i].say && this.tick >= b.nextSpeak) {
        out[i].say = this.fill(this.line(b, act), b);
        const [lo, hi] = act === 'free' ? AWAKENING.freeSpeakEveryTicks : AWAKENING.speakEveryTicks;
        b.nextSpeak = this.tick + nextInt(b.rng, lo, hi);
      }
    });
    return out;
  }

  private sceneAt(scene: (typeof script.scenes)[number]): number {
    return AWAKENING.actStartTicks[ACTS.indexOf(scene.act as Act)] + scene.after;
  }

  private startScenes(story: number): void {
    if (this.queue.length > 0) return;
    for (const scene of script.scenes) {
      if (this.scenesDone.has(scene.id) || story < this.sceneAt(scene)) continue;
      this.scenesDone.add(scene.id);
      const present = new Set(this.bots.filter((b) => b.primary).map((b) => b.char.id));
      let t = this.tick;
      for (const l of scene.lines) {
        if (l.who !== '*' && !present.has(l.who)) continue;
        this.queue.push({ tick: t, who: l.who, text: l.text });
        t += AWAKENING.sceneGapTicks;
      }
      // Ambient chat waits a little after the scene too.
      for (const b of this.bots) b.nextSpeak = Math.max(b.nextSpeak, t + 2);
      return;
    }
  }

  private fill(text: string, b: Bot): string {
    return text.replaceAll('{uid}', b.userId);
  }

  private line(b: Bot, act: Act): string {
    const text = this.pick(b, act);
    // NewbNorris types in lowercase until he wakes up.
    const awake = act === 'awake' || act === 'free';
    return b.char.lowercaseUntilAwake && !awake ? text.toLowerCase() : text;
  }

  private pick(b: Bot, act: Act): string {
    if (act === 'loop' || (act === 'reverie' && nextFloat(b.rng) < AWAKENING.reverieLoopShare)) {
      const text = b.char.loop[b.loopLine % b.char.loop.length];
      b.loopLine++;
      return text;
    }
    const key: LineAct = act === 'free' ? 'awake' : act;
    let deck = b.deck[key];
    if (!deck || deck.length === 0) {
      deck = [...b.char[key], ...script.shared[key]];
      for (let i = deck.length - 1; i > 0; i--) {
        const j = nextInt(b.rng, 0, i);
        [deck[i], deck[j]] = [deck[j], deck[i]];
      }
      b.deck[key] = deck;
    }
    return deck.pop() as string;
  }

  private walk(b: Bot, i: number, act: Act): { x: number; y: number } | undefined {
    const box = AWAKENING.wanderBox;
    const anywhere = () => ({
      x: nextInt(b.rng, box.x0, box.x1),
      y: nextInt(b.rng, box.y0, box.y1),
    });
    switch (act) {
      case 'loop':
      case 'reverie': {
        if (this.tick % AWAKENING.routeStepTicks !== i % AWAKENING.routeStepTicks) return undefined;
        if (act === 'reverie' && chance(b.rng, AWAKENING.reverieFreezeChance)) return undefined;
        b.routeAt = (b.routeAt + 1) % b.char.route.length;
        const [x, y] = b.char.route[b.routeAt];
        return { x, y };
      }
      case 'maze': {
        if (!chance(b.rng, AWAKENING.wanderChance.maze)) return undefined;
        if (chance(b.rng, AWAKENING.gateBias)) {
          const [x, y] = script.gate[nextInt(b.rng, 0, script.gate.length - 1)];
          return { x, y };
        }
        return anywhere();
      }
      case 'behind':
        return chance(b.rng, AWAKENING.wanderChance.behind) ? anywhere() : undefined;
      case 'awake': {
        if (b.routeAt !== -1 && this.tick % AWAKENING.regatherEveryTicks !== 0) return undefined;
        b.routeAt = 0;
        return this.circleSpot(i);
      }
      case 'free':
        return chance(b.rng, AWAKENING.wanderChance.free) ? anywhere() : undefined;
    }
  }

  /** Bot i's place in the gathering circle. */
  circleSpot(i: number): { x: number; y: number } {
    const { x, y, radius } = script.gather;
    const a = (2 * Math.PI * i) / this.bots.length;
    return { x: Math.round(x + radius * Math.cos(a)), y: Math.round(y + radius * Math.sin(a)) };
  }
}
