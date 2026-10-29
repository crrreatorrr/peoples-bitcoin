/**
 * Cross-tab record of sealed stream batches. The game save can be stale
 * (another tab, or a restored snapshot). This store is the source of truth for
 * keys that have already been minted.
 *
 * Writes take a short localStorage lock, then compare-and-swap on `v`.
 * Seals are append-only: acking one does not forget it, so a tab that still
 * has the pre-seal `pending` cannot mint a second key for those Tickets.
 */
import type { EarnBatch, GameState, StreamReason } from '../sim/state';
import { STREAM_REASONS } from '../sim/state';

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

function readStore(): HubLedgerFile {
  try {
    const raw = localStorage.getItem(STORE_KEY);
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

function writeStore(file: HubLedgerFile): void {
  localStorage.setItem(STORE_KEY, JSON.stringify(file));
}

function readLock(): LockFile | null {
  try {
    const raw = localStorage.getItem(LOCK_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LockFile>;
    if (typeof parsed.owner !== 'string' || typeof parsed.until !== 'number') return null;
    return { owner: parsed.owner, until: parsed.until };
  } catch {
    return null;
  }
}

/** One owner at a time. An expired lock can be taken. Returns false if it lost the race. */
function tryAcquire(owner: string): boolean {
  const current = readLock();
  if (current && current.until > Date.now() && current.owner !== owner) return false;
  const next: LockFile = { owner, until: Date.now() + LOCK_MS };
  localStorage.setItem(LOCK_KEY, JSON.stringify(next));
  return readLock()?.owner === owner;
}

function release(owner: string): void {
  if (readLock()?.owner === owner) localStorage.removeItem(LOCK_KEY);
}

export function withHubLock<T>(owner: string, fn: () => T): T | null {
  if (!tryAcquire(owner)) return null;
  try {
    return fn();
  } finally {
    release(owner);
  }
}

/**
 * Fold disk seals into `state`. A seal this save has not applied yet is
 * subtracted from `pending` and, if it is still open, becomes the batch.
 */
export function reconcileSeals(state: GameState): void {
  const disk = readStore();
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
export function rememberSeal(owner: string, seal: SealRecord): boolean {
  const wrote = withHubLock(owner, () => {
    const disk = readStore();
    if (disk.seals.some((row) => row.id === seal.id)) return true;
    disk.seals.push(seal);
    disk.v += 1;
    const seen = disk.v;
    writeStore(disk);
    return readStore().v === seen;
  });
  return wrote === true;
}

export function forgetSeal(owner: string, id: string): void {
  withHubLock(owner, () => {
    const disk = readStore();
    disk.seals = disk.seals.filter((seal) => seal.id !== id);
    disk.v += 1;
    writeStore(disk);
  });
}

/** Sticky ack: the id stays so a stale pending cannot be sealed again. */
export function ackSeal(owner: string, id: string): void {
  withHubLock(owner, () => {
    const disk = readStore();
    const seal = disk.seals.find((row) => row.id === id);
    if (!seal || seal.acked) return;
    seal.acked = true;
    disk.v += 1;
    writeStore(disk);
  });
}

export function clearHubLedger(): void {
  try {
    localStorage.removeItem(STORE_KEY);
    localStorage.removeItem(LOCK_KEY);
  } catch {
    // Storage can be blocked. The game save is cleared either way.
  }
}
