/**
 * One tab writes the save. The newest claim wins; an older tab stops and
 * shows the overlay. M11's server lease replaces this later. Tabs do not
 * merge inventories.
 */
const LOCK_KEY = 'peoples-bitcoin.writer';
const CHANNEL = 'peoples-bitcoin-writer';

interface WriterClaim {
  id: string;
  at: number;
}

/** Claims the writer lock. Calls `onLost` if a newer tab takes over. */
export function claimWriter(onLost: () => void): void {
  const mine: WriterClaim = { id: crypto.randomUUID(), at: Date.now() };
  let writing = true;
  const lose = () => {
    if (!writing) return;
    writing = false;
    onLost();
  };
  const consider = (other: WriterClaim | null) => {
    if (other && newerThan(other, mine)) lose();
  };

  try {
    const existing = readClaim(JSON.parse(localStorage.getItem(LOCK_KEY) ?? 'null') as unknown);
    if (existing && newerThan(existing, mine)) {
      lose();
      return;
    }
    localStorage.setItem(LOCK_KEY, JSON.stringify(mine));
  } catch {
    // Storage blocked: this tab still plays. Another tab cannot see the claim.
  }

  try {
    const channel = new BroadcastChannel(CHANNEL);
    channel.onmessage = (event: MessageEvent<unknown>) => consider(readClaim(event.data));
    channel.postMessage(mine);
  } catch {
    // BroadcastChannel can be missing. The storage event still carries the claim.
  }

  window.addEventListener('storage', (event) => {
    if (event.key !== LOCK_KEY || !event.newValue) return;
    try {
      consider(readClaim(JSON.parse(event.newValue) as unknown));
    } catch {
      // A bad lock value does not take the tab away.
    }
  });

  try {
    const raw = localStorage.getItem(LOCK_KEY);
    if (raw) consider(readClaim(JSON.parse(raw) as unknown));
  } catch {
    // The claim we just wrote is enough.
  }
}

function newerThan(other: WriterClaim, mine: WriterClaim): boolean {
  if (other.id === mine.id) return false;
  return other.at > mine.at || (other.at === mine.at && other.id > mine.id);
}

function readClaim(value: unknown): WriterClaim | null {
  if (!value || typeof value !== 'object') return null;
  const claim = value as Partial<WriterClaim>;
  if (typeof claim.id !== 'string' || typeof claim.at !== 'number') return null;
  return { id: claim.id, at: claim.at };
}
