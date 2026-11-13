/**
 * Whose offline game this page plays, and so which localStorage keys it uses.
 *
 * - `device`: play without a hub session. The unscoped keys, including every save made
 *   before saves were kept per account. It never moves into an account.
 * - `account`: play with a live hub session. Keys end in `@<playerId>`, so a second account
 *   on the same browser starts its own game and never sees another account's.
 * - `pending`: a hub visit was starting but the hub never said who the player is. The game
 *   runs in memory and is not saved, so it cannot land under the wrong owner.
 *
 * The offline save is a whole-world snapshot (tens of KB, and it can go backwards), so it
 * stays in this browser even for an account. Online play is kept by the world server.
 */
import type { HubBridge } from './bridge';

export type SaveOwner =
  { kind: 'device' } | { kind: 'account'; playerId: string } | { kind: 'pending' };

export const DEVICE: SaveOwner = { kind: 'device' };

/**
 * How long the offline game waits for a hub visit's `init` after world select gave up on it
 * (src/game/online.ts waits 8 s first). A client-only timeout, like that one, so it stays out
 * of src/config (which is part of the sim version hash).
 */
export const SAVE_OWNER_WAIT_MS = 12_000;

/** `base` for the device, `base@<playerId>` for an account, null while pending (no storage). */
export function ownedKey(base: string, owner: SaveOwner): string | null {
  if (owner.kind === 'device') return base;
  if (owner.kind === 'account') return `${base}@${owner.playerId}`;
  return null;
}

/**
 * Decides the owner once, before the offline save is read.
 *
 * `visitStarting` is `hubVisitStarting(HUB_GAME_ID)` read at page start (a portal ticket in
 * the fragment, or a live session from earlier in this tab). Without one there is no hub
 * session to wait for. With one, this waits for `init` (started now if world select did not
 * start it) up to `waitMs`; a live session makes the owner that account, anything else the
 * device. If `init` still has not answered, the owner is `pending`.
 */
export async function resolveSaveOwner(
  bridge: HubBridge,
  visitStarting: boolean,
  waitMs: number,
): Promise<SaveOwner> {
  if (!visitStarting && !bridge.initialized) return DEVICE;
  const settled = bridge.initialized ? bridge.settled() : bridge.init();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const answered = await Promise.race([
    settled.then(() => true),
    new Promise<false>((resolve) => {
      timer = setTimeout(() => resolve(false), waitMs);
    }),
  ]);
  clearTimeout(timer);
  if (!answered) return visitStarting ? { kind: 'pending' } : DEVICE;
  const playerId = bridge.accountId();
  return playerId ? { kind: 'account', playerId } : DEVICE;
}
