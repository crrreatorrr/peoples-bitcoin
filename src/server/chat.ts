/**
 * Online chat, RuneScape mechanics with original content: public chat to the
 * players around you (with overhead text), private messages in this world or
 * another (via the other world's match signal), quick-chat filled in from the
 * speaker's real state, rate limits, mutes and the recipient's filters and
 * ignore list. PMs are never stored. Pure.
 */
import { CHAT, CHAT_NET } from '../config/balance';
import quickchat from '../data/quickchat.json';
import type { Content } from '../sim/content';
import { combatLevel } from '../sim/combat';
import type { ChatFilter, GameState } from '../sim/state';
import { levelForXp } from '../sim/xp';
import type { ChatIn, ChatOut } from '../net/protocol';
import { checkText, cleanText } from './chatfilter';

/** What chat needs to know about one player. */
export interface ChatMember {
  uid: string;
  name: string;
  view: GameState;
  chat: ChatCounters;
}

export interface ChatCounters {
  publicTicks: number[];
  pmTicks: number[];
  last: { text: string; tick: number } | null;
  strikes: number;
  mutedUntil: number;
  /** Who to answer with /r or Tab. */
  replyTo: string | null;
}

export function newChatCounters(): ChatCounters {
  return { publicTicks: [], pmTicks: [], last: null, strikes: 0, mutedUntil: 0, replyTo: null };
}

/** The world around the chat module (implemented by the host). */
export interface ChatEnv {
  tick: number;
  worldNo: number;
  content: Content;
  byName(name: string): ChatMember | undefined;
  /** Players who can hear `speaker` in public (same zone instance, in view). */
  hearers(speaker: ChatMember): ChatMember[];
  send(uid: string, out: ChatOut): void;
  /** Another world: deliver a PM there. 'offline' when nobody by that name is on. */
  remotePm(from: ChatMember, toName: string, text: string, quick: boolean): 'sent' | 'offline';
  log(level: 'info' | 'warn', msg: string): void;
}

const QUICK = new Map<string, { text: string; slot?: string }>(
  quickchat.groups.flatMap((g) => g.phrases.map((p) => [p.id, p] as const)),
);

function filterAllows(filter: ChatFilter, isFriend: boolean): boolean {
  return filter === 'on' || (filter === 'friends' && isFriend);
}

export function isFriend(of: GameState, uid: string): boolean {
  return of.player.social.friends.some((f) => f.id === uid);
}

export function ignores(of: GameState, uid: string): boolean {
  return of.player.social.ignores.some((f) => f.id === uid);
}

function system(env: ChatEnv, to: ChatMember, text: string): void {
  env.send(to.uid, { ch: 'system', text });
}

/** Keeps the last `windowTicks` of sends; false when this one would exceed `limit`. */
function rateOk(ticks: number[], now: number, limit: number): boolean {
  while (ticks.length > 0 && now - ticks[0] >= CHAT_NET.windowTicks) ticks.shift();
  if (ticks.length >= limit) return false;
  ticks.push(now);
  return true;
}

function strike(env: ChatEnv, who: ChatMember, why: string): void {
  who.chat.strikes += 1;
  env.log('warn', `chat strike ${who.uid} ${why} (${who.chat.strikes})`);
  if (who.chat.strikes >= CHAT_NET.strikesToMute) {
    who.chat.strikes = 0;
    who.chat.mutedUntil = env.tick + CHAT_NET.muteStrikeTicks;
    system(env, who, 'You have been muted for a minute. Quick-chat still works.');
  }
}

/** Builds a quick-chat line from the speaker's real state, or null for an unknown phrase. */
export function quickText(env: ChatEnv, who: ChatMember, phrase: string): string | null {
  const [id, arg] = phrase.split(':');
  const def = QUICK.get(id);
  if (!def) return null;
  const p = who.view.player;
  const level = (skill: string) => levelForXp(p.skills[skill] ?? 0);
  switch (def.slot) {
    case undefined:
      return def.text;
    case 'combat':
      return def.text.replace('{combat}', String(combatLevel(p.skills)));
    case 'world':
      return def.text.replace('{world}', String(env.worldNo));
    case 'total': {
      const total = [...env.content.skills.keys()].reduce((sum, s) => sum + level(s), 0);
      return def.text.replace('{total}', String(total));
    }
    case 'tickets':
      return def.text.replace('{tickets}', p.currencies.tickets.toLocaleString('en-US'));
    case 'skill': {
      const skill = arg ? env.content.skills.get(arg) : undefined;
      if (!skill) return null;
      return def.text.replace('{skill}', skill.name).replace('{level}', String(level(skill.id)));
    }
    default:
      return null;
  }
}

/** Typed text after cleaning, limits and the filter; null when it must not go out. */
function vet(env: ChatEnv, who: ChatMember, raw: string, kind: 'public' | 'pm'): string | null {
  const text = cleanText(raw, CHAT_NET.maxLength);
  if (!text) return null;
  if (env.tick < who.chat.mutedUntil) {
    system(env, who, "You're muted. Quick-chat still works.");
    return null;
  }
  const ticks = kind === 'public' ? who.chat.publicTicks : who.chat.pmTicks;
  const limit = kind === 'public' ? CHAT_NET.publicPerWindow : CHAT_NET.pmPerWindow;
  if (!rateOk(ticks, env.tick, limit)) {
    system(env, who, "You're sending messages too quickly.");
    strike(env, who, 'flood');
    return null;
  }
  const last = who.chat.last;
  if (last && last.text === text && env.tick - last.tick < CHAT_NET.repeatBlockTicks) return null;
  who.chat.last = { text, tick: env.tick };
  const verdict = checkText(text);
  if (!verdict.ok) {
    const why =
      verdict.reason === 'link'
        ? "Links can't be posted here."
        : verdict.reason === 'wallet'
          ? "Wallet addresses can't be posted here. The game has no real money."
          : 'That message was blocked.';
    system(env, who, why);
    strike(env, who, verdict.reason);
    return null;
  }
  return verdict.text;
}

/** Public chat: overhead text, plus a chat line for everyone in view who allows it. */
function sayPublic(env: ChatEnv, who: ChatMember, text: string, quick: boolean): void {
  const p = who.view.player;
  p.overhead = { text, untilTick: env.tick + CHAT.overheadTicks };
  const line: ChatOut = { ch: 'public', from: who.name, text, id: who.view.selfId };
  if (quick) line.quick = true;
  env.send(who.uid, line);
  for (const h of env.hearers(who)) {
    if (h.uid === who.uid || ignores(h.view, who.uid)) continue;
    if (!filterAllows(h.view.player.social.publicFilter, isFriend(h.view, who.uid))) continue;
    env.send(h.uid, line);
  }
}

/**
 * Delivers a PM to a player on this world, applying their ignore list and
 * private filter. False means it was refused (the sender sees them offline).
 */
export function deliverPm(
  env: ChatEnv,
  from: { uid: string; name: string; world: number },
  to: ChatMember,
  text: string,
  quick: boolean,
): boolean {
  if (ignores(to.view, from.uid)) return false;
  if (!filterAllows(to.view.player.social.privateFilter, isFriend(to.view, from.uid))) return false;
  const line: ChatOut = { ch: 'pm_in', from: from.name, text };
  if (quick) line.quick = true;
  if (from.world !== env.worldNo) line.world = from.world;
  env.send(to.uid, line);
  to.chat.replyTo = from.name;
  return true;
}

function sendPm(env: ChatEnv, who: ChatMember, toName: string, text: string, quick: boolean): void {
  const local = env.byName(toName);
  let ok: boolean;
  let name = toName;
  if (local) {
    name = local.name;
    ok = deliverPm(env, { uid: who.uid, name: who.name, world: env.worldNo }, local, text, quick);
  } else ok = env.remotePm(who, toName, text, quick) === 'sent';
  if (!ok) {
    system(env, who, `${toName} is currently offline.`);
    return;
  }
  const echo: ChatOut = { ch: 'pm_out', to: name, text };
  if (quick) echo.quick = true;
  env.send(who.uid, echo);
  who.chat.replyTo = name;
}

export function handleChat(env: ChatEnv, who: ChatMember, msg: ChatIn): void {
  switch (msg.ch) {
    case 'public': {
      const text = vet(env, who, msg.text, 'public');
      if (text) sayPublic(env, who, text, false);
      return;
    }
    case 'pm':
    case 'reply': {
      const to = msg.ch === 'pm' ? msg.to : who.chat.replyTo;
      if (!to) {
        system(env, who, 'Nobody has messaged you yet.');
        return;
      }
      const text = vet(env, who, msg.text, 'pm');
      if (text) sendPm(env, who, to, text, false);
      return;
    }
    case 'quick': {
      const text = quickText(env, who, msg.phrase);
      if (!text) return;
      // Quick-chat is canned, so it works while muted; it still counts against the rate limit.
      if (!rateOk(who.chat.publicTicks, env.tick, CHAT_NET.publicPerWindow)) return;
      if (msg.pm) sendPm(env, who, msg.pm, text, true);
      else sayPublic(env, who, text, true);
      return;
    }
  }
}
