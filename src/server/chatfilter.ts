/**
 * Chat safety (DESIGN.md §0): slurs are always blocked, and so are links and
 * wallet-shaped strings (rule 1: no real-money trading, and nobody can use the
 * avatar to point off-site). Profanity is only masked, on the client.
 * Pure: runs in Nakama's JS runtime.
 */
import lists from '../data/chatfilter.json';

const LEET: Record<string, string> = {
  '0': 'o',
  '1': 'i',
  '!': 'i',
  '|': 'i',
  '3': 'e',
  '4': 'a',
  '@': 'a',
  '5': 's',
  $: 's',
  '7': 't',
  '+': 't',
  '8': 'b',
  '9': 'g',
  '6': 'g',
};

function stripAccents(text: string): string {
  return typeof text.normalize === 'function' ? text.normalize('NFD').replace(/[̀-ͯ]/g, '') : text;
}

/** Folds case, accents and leetspeak; keeps letters, digits and spaces. */
export function fold(text: string): string {
  let out = '';
  for (const ch of stripAccents(text.toLowerCase())) {
    const mapped = LEET[ch] ?? ch;
    out += /[a-z0-9]/.test(mapped) ? mapped : ' ';
  }
  return out;
}

/** The squashed form used for substring checks: no separators. */
export function squash(text: string): string {
  return fold(text).replace(/\s+/g, '');
}

/**
 * A pattern for a listed word that also catches stretched spellings: each
 * letter may repeat, and a doubled letter must stay at least doubled (so
 * "nigger" never matches the country "Niger").
 */
function stretchy(word: string): string {
  let out = '';
  for (let i = 0; i < word.length;) {
    let j = i;
    while (j < word.length && word[j] === word[i]) j++;
    out += j - i > 1 ? `${word[i]}{${j - i},}` : `${word[i]}+`;
    i = j;
  }
  return out;
}

const SLUR_RE = new RegExp(lists.slurs.map(stretchy).join('|'));
const WORD_RE = new RegExp(`^(${lists.words.map(stretchy).join('|')})$`);
// Long reserved names match anywhere; short ones ("mod", "hub") only as the whole name, plus digits.
const RESERVED_RE = new RegExp(
  lists.reserved
    .filter((r) => r.length >= 5)
    .map(stretchy)
    .join('|'),
);
const RESERVED_SHORT_RE = new RegExp(
  `^[0-9]*(${lists.reserved
    .filter((r) => r.length < 5)
    .map(stretchy)
    .join('|')})[0-9]*$`,
);

const URL_RE =
  /(https?:\/\/|www\.|\b[a-z0-9-]{2,}\s*(\.|\(dot\)|\[dot\]|\sdot\s)\s*(com|net|org|io|gg|xyz|ru|co|me|app|link|ly|to|tv|cc|biz|info|fun|site|online|eth|sol)\b|discord\s*\.?\s*gg)/i;
const WALLET_RES = [
  /\b0x[0-9a-f]{40}\b/i,
  /\bbc1[02-9ac-hj-np-z]{11,71}\b/i,
  /\b[13][a-km-zA-HJ-NP-Z1-9]{25,34}\b/,
  /\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/,
  /\b[a-z0-9-]+\.(eth|sol)\b/i,
];

export type FilterVerdict =
  { ok: true; text: string } | { ok: false; reason: 'slur' | 'link' | 'wallet' };

/** Server check for any player text (public chat, PMs, names). */
export function checkText(text: string): FilterVerdict {
  if (URL_RE.test(text)) return { ok: false, reason: 'link' };
  if (WALLET_RES.some((re) => re.test(text))) return { ok: false, reason: 'wallet' };
  if (SLUR_RE.test(squash(text))) return { ok: false, reason: 'slur' };
  const words = fold(text).split(/\s+/).filter(Boolean);
  if (words.some((w) => WORD_RE.test(w))) return { ok: false, reason: 'slur' };
  return { ok: true, text };
}

/** Collapses whitespace and trims to `max` characters. */
export function cleanText(text: string, max: number): string {
  let out = '';
  for (const ch of text) out += ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127 ? ' ' : ch;
  return out.replace(/\s+/g, ' ').trim().slice(0, max);
}

/** True for nameplates that could pass for the President, staff or a cast member. */
export function reservedName(name: string): boolean {
  const s = squash(name);
  return RESERVED_RE.test(s) || RESERVED_SHORT_RE.test(s) || !checkText(name).ok;
}

/** Client-side profanity masking (a setting, default on). */
export function maskProfanity(text: string): string {
  let out = text;
  for (const word of lists.profanity) {
    out = out.replace(
      new RegExp(word.split('').join('[^a-z]?'), 'gi'),
      (m) => m[0] + '*'.repeat(Math.max(0, m.length - 1)),
    );
  }
  return out;
}
