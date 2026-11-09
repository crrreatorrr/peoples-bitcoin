/**
 * Settings → Test world: start a world that runs in this page with AI
 * players (the loopback transport), choosing how many and how they behave,
 * without typing URL parameters. Starting reloads the page with
 * `?net=loopback&bots=N` plus `&awaken=1` (the awakening story) or `&chat=0`.
 */
import { AWAKENING } from '../config/balance';

export type BotMode = 'awaken' | 'quick' | 'silent';

export interface TestWorldChoice {
  bots: number;
  mode: BotMode;
  /** Story speed for the awakening (1 = about 10 minutes). */
  pace: number;
}

const PARAMS = ['net', 'bots', 'awaken', 'chat', 'pace', 'act'];
const STORE_KEY = 'pb.testworld';
export const MAX_TEST_BOTS = 99;

export const DEFAULT_CHOICE: TestWorldChoice = {
  bots: AWAKENING.defaultBots,
  mode: 'awaken',
  pace: 1,
};

function clampBots(n: number): number {
  return Math.min(MAX_TEST_BOTS, Math.max(0, Math.floor(Number.isFinite(n) ? n : 0)));
}

/** The page URL for a test world with this choice (other parameters are kept). */
export function testWorldUrl(href: string, choice: TestWorldChoice): string {
  const url = new URL(href);
  for (const p of PARAMS) url.searchParams.delete(p);
  url.searchParams.set('net', 'loopback');
  url.searchParams.set('bots', String(clampBots(choice.bots)));
  if (choice.mode === 'awaken') {
    url.searchParams.set('awaken', '1');
    if (choice.pace !== 1) url.searchParams.set('pace', String(choice.pace));
  } else if (choice.mode === 'silent') url.searchParams.set('chat', '0');
  return url.toString();
}

/** The page URL without any test-world parameters (back to normal play). */
export function leaveTestWorldUrl(href: string): string {
  const url = new URL(href);
  for (const p of PARAMS) url.searchParams.delete(p);
  return url.toString();
}

/** The choice the current URL describes, or null when this isn't a test world. */
export function choiceFromUrl(href: string): TestWorldChoice | null {
  const q = new URL(href).searchParams;
  if (q.get('net') !== 'loopback') return null;
  const awaken = q.get('awaken') === '1';
  const fallback = awaken ? AWAKENING.defaultBots : 3;
  return {
    bots: clampBots(Number(q.get('bots') ?? fallback)),
    mode: awaken ? 'awaken' : q.get('chat') === '0' ? 'silent' : 'quick',
    pace: Number(q.get('pace') ?? 1) || 1,
  };
}

function remembered(): TestWorldChoice {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return { ...DEFAULT_CHOICE, ...(JSON.parse(raw) as Partial<TestWorldChoice>) };
  } catch {
    // Storage blocked or bad JSON: use the defaults.
  }
  return { ...DEFAULT_CHOICE };
}

function remember(choice: TestWorldChoice): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(choice));
  } catch {
    // Not saved; the panel still works.
  }
}

function labelled(text: string, control: HTMLElement): HTMLLabelElement {
  const label = document.createElement('label');
  label.className = 'testworld-row';
  const span = document.createElement('span');
  span.textContent = text;
  label.append(span, control);
  return label;
}

function select<T extends string | number>(options: [T, string][], value: T): HTMLSelectElement {
  const el = document.createElement('select');
  for (const [v, text] of options) {
    const o = document.createElement('option');
    o.value = String(v);
    o.textContent = text;
    o.selected = v === value;
    el.append(o);
  }
  return el;
}

/**
 * The Test world box. `online` is true in a real (hub) world: starting a test
 * world leaves it, so we ask first.
 */
export function buildTestWorldPanel(online: boolean): HTMLElement {
  const current = choiceFromUrl(location.href);
  const choice = current ?? remembered();

  const box = document.createElement('fieldset');
  box.className = 'testworld';
  const legend = document.createElement('legend');
  legend.textContent = 'Test world: AI players';
  box.append(legend);

  const note = document.createElement('p');
  note.className = 'testworld-note';
  note.textContent = current
    ? `You're in a test world with ${current.bots} AI players. Nothing here is saved.`
    : 'A world in this page with AI players. Nothing in it is saved.';

  const count = document.createElement('input');
  count.type = 'number';
  count.min = '0';
  count.max = String(MAX_TEST_BOTS);
  count.value = String(choice.bots);
  count.setAttribute('aria-label', 'How many AI players');

  const mode = select<BotMode>(
    [
      ['awaken', 'Awakening story'],
      ['quick', 'Quick-chat'],
      ['silent', 'Silent'],
    ],
    choice.mode,
  );
  const pace = select<number>(
    [
      [1, 'Normal (10 min)'],
      [2, '2× faster'],
      [5, '5× faster'],
      [20, '20× faster'],
    ],
    [1, 2, 5, 20].includes(choice.pace) ? choice.pace : 1,
  );
  const paceRow = labelled('Story speed', pace);
  const syncPace = () => (paceRow.hidden = mode.value !== 'awaken');
  mode.addEventListener('change', syncPace);
  syncPace();

  const start = document.createElement('button');
  start.className = 'stone-btn';
  start.textContent = current ? 'Restart test world' : 'Start test world';
  // From a real world it asks with confirm(), which a controller can't answer: the pad skips it.
  if (online && !current) start.dataset.padSkip = '';
  start.addEventListener('click', () => {
    const picked: TestWorldChoice = {
      bots: clampBots(Number(count.value)),
      mode: mode.value as BotMode,
      pace: Number(pace.value) || 1,
    };
    if (online && !current && !confirm('Leave this world and start a test world?')) return;
    remember(picked);
    location.assign(testWorldUrl(location.href, picked));
  });

  box.append(note, labelled('AI players', count), labelled('They', mode), paceRow, start);
  if (current) {
    const leave = document.createElement('button');
    leave.className = 'stone-btn';
    leave.textContent = 'Leave test world';
    leave.addEventListener('click', () => location.assign(leaveTestWorldUrl(location.href)));
    box.append(leave);
  }
  return box;
}
