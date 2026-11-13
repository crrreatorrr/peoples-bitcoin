/**
 * Cross-tab record of sealed stream batches. The game save can be stale
 * (another tab, or a restored snapshot). This store is the source of truth for
 * keys that have already been minted.
 *
 * Writes take a short localStorage lock, then compare-and-swap on `v`.
 * Seals are append-only: acking one does not forget it, so a tab that still
 * has the pre-seal `pending` cannot mint a second key for those Tickets.
 *
 * The record belongs to the same owner as the save it pairs with (src/hub/saveOwner.ts): its
 * seal ids sit in that save's `appliedSealIds`, so another owner's record would wrongly take
 * Tickets out of this save's pending balance. A pending owner has no record.
 */
import type { EarnBatch, GameState, StreamReason } from '../sim/state';
import { STREAM_REASONS } from '../sim/state';
import { DEVICE, ownedKey, type SaveOwner } from './saveOwner';

const STORE_KEY = 'peoples-bitcoin.hub-ledger';
const LOCK_KEY = 'peoples-bitcoin.hub-ledger.lock';
const LOCK_MS = 2000;

export interface SealRecord {
  id: string;
  reason: StreamReason;
  amount: number;
  acked: boolean;
}

interface HubLedgerFile {
  v: number;
  seals: SealRecord[];
}

interface LockFile {
  owner: string;
  until: number;
}

function emptyFile(): HubLedgerFile {
  return { v: 0, seals: [] };
}

function readStore(owner: SaveOwner): HubLedgerFile {
  const key = ownedKey(STORE_KEY, owner);
  if (!key) return emptyFile();
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return emptyFile();
    const parsed = JSON.parse(raw) as Partial<HubLedgerFile>;
    const seals = Array.isArray(parsed.seals) ? parsed.seals : [];
    return {
      v: typeof parsed.v === 'number' ? parsed.v : 0,
      seals: seals.filter(
        (seal): seal is SealRecord =>
          !!seal &&
          typeof seal.id === 'string' &&
          (STREAM_REASONS as readonly string[]).includes(seal.reason) &&
          typeof seal.amount === 'number' &&
          typeof seal.acked === 'boolean',
      ),
    };
  } catch {
    return emptyFile();
  }
}

function writeStore(file: HubLedgerFile, owner: SaveOwner): void {
  const key = ownedKey(STORE_KEY, owner);
  if (!key) throw new Error('pending owner has no hub ledger');
  localStorage.setItem(key, JSON.stringify(file));
}

function readLock(owner: SaveOwner): LockFile | null {
  const key = ownedKey(LOCK_KEY, owner);
  if (!key) return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LockFile>;
    if (typeof parsed.owner !== 'string' || typeof parsed.until !== 'number') return null;
    return { owner: parsed.owner, until: parsed.until };
  } catch {
    return null;
  }
}

/** One owner at a time. An expired lock can be taken. Returns false if it lost the race. */
function tryAcquire(owner: string, save: SaveOwner): boolean {
  const key = ownedKey(LOCK_KEY, save);
  if (!key) return false;
  const current = readLock(save);
  if (current && current.until > Date.now() && current.owner !== owner) return false;
  const next: LockFile = { owner, until: Date.now() + LOCK_MS };
  localStorage.setItem(key, JSON.stringify(next));
  return readLock(save)?.owner === owner;
}

function release(owner: string, save: SaveOwner): void {
  const key = ownedKey(LOCK_KEY, save);
  if (key && readLock(save)?.owner === owner) localStorage.removeItem(key);
}

/** Runs `fn` under `save`'s ledger lock, held by the tab `owner`. Null if another tab holds it. */
export function withHubLock<T>(owner: string, fn: () => T, save: SaveOwner = DEVICE): T | null {
  if (!tryAcquire(owner, save)) return null;
  try {
    return fn();
  } finally {
    release(owner, save);
  }
}

/**
 * Fold disk seals into `state`. A seal this save has not applied yet is
 * subtracted from `pending` and, if it is still open, becomes the batch.
 */
export function reconcileSeals(state: GameState, save: SaveOwner = DEVICE): void {
  const disk = readStore(save);
  const applied = new Set(state.player.ledger.appliedSealIds);
  for (const seal of disk.seals) {
    if (applied.has(seal.id)) continue;
    const pocket = state.player.ledger.streams[seal.reason];
    const memory = state.player.ledger.batches[seal.reason];
    if (!memory || memory.id !== seal.id) {
      pocket.pending = Math.max(0, pocket.pending - seal.amount);
    }
    state.player.ledger.appliedSealIds.push(seal.id);
    if (!seal.acked) {
      const batch: EarnBatch = {
        id: seal.id,
        amount: seal.amount,
        retryAtInit: memory?.id === seal.id ? memory.retryAtInit : false,
      };
      state.player.ledger.batches[seal.reason] = batch;
    } else if (memory?.id === seal.id) {
      delete state.player.ledger.batches[seal.reason];
    }
  }
}

/** Persist a newly sealed batch. Returns false if another tab holds the lock. */
export function rememberSeal(owner: string, seal: SealRecord, save: SaveOwner = DEVICE): boolean {
  const wrote = withHubLock(
    owner,
    () => {
      const disk = readStore(save);
      if (disk.seals.some((row) => row.id === seal.id)) return true;
      disk.seals.push(seal);
      disk.v += 1;
      const seen = disk.v;
      writeStore(disk, save);
      return readStore(save).v === seen;
    },
    save,
  );
  return wrote === true;
}

export function forgetSeal(owner: string, id: string, save: SaveOwner = DEVICE): void {
  withHubLock(
    owner,
    () => {
      const disk = readStore(save);
      disk.seals = disk.seals.filter((seal) => seal.id !== id);
      disk.v += 1;
      writeStore(disk, save);
    },
    save,
  );
}

/** Sticky ack: the id stays so a stale pending cannot be sealed again. */
export function ackSeal(owner: string, id: string, save: SaveOwner = DEVICE): void {
  withHubLock(
    owner,
    () => {
      const disk = readStore(save);
      const seal = disk.seals.find((row) => row.id === id);
      if (!seal || seal.acked) return;
      seal.acked = true;
      disk.v += 1;
      writeStore(disk, save);
    },
    save,
  );
}

export function clearHubLedger(save: SaveOwner = DEVICE): void {
  const storeKey = ownedKey(STORE_KEY, save);
  const lockKey = ownedKey(LOCK_KEY, save);
  if (!storeKey || !lockKey) return;
  try {
    localStorage.removeItem(storeKey);
    localStorage.removeItem(lockKey);
  } catch {
    // Storage can be blocked. The game save is cleared either way.
  }
}
