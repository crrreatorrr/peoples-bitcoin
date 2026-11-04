/**
 * A self-contained world benchmark for the server runtime (the hub's dev-only
 * `pb.bench` RPC runs it inside Nakama's goja): N players in one world, some
 * walking each tick, with phase timings. In-memory I/O; no storage.
 */
import { NET } from '../config/balance';
import { createWorldHost, type HostIO } from './host';
import { OP, PROTOCOL_VERSION } from '../net/protocol';
import { SIM_VERSION } from '../net/simVersion';

export function benchWorld(
  players: number,
  ticks: number,
  walkShare: number,
  now: () => number,
): Record<string, number> {
  const io: HostIO = {
    nowMs: now,
    loadCharacters: (ids) => Object.fromEntries(ids.map((id) => [id, null])),
    saveCharacters: (rows) => ({
      ok: true,
      versions: Object.fromEntries(rows.map((r) => [r.userId, '1'])),
    }),
    loadWorld: () => null,
    saveWorld: () => undefined,
    earnTickets: () => ({ balance: 0 }),
    spendTickets: () => ({ error: 'bench' }),
    sellItem: () => ({ error: 'bench' }),
    ticketBalance: () => ({ balance: 0 }),
    readOnline: (ids) => Object.fromEntries(ids.map((id) => [id, null])),
    writeOnline: () => undefined,
    signalWorld: () => null,
    resolveUsername: () => null,
    log: () => undefined,
  };
  const profile: Record<string, number> = {};
  const host = createWorldHost({ worldNo: 0, matchId: 'bench', seed: 1, io, profile });
  const ps = [];
  for (let i = 0; i < players; i++) {
    const p = { userId: `u${i}`, sessionId: `s${i}`, username: `Bench${i}` };
    host.joinAttempt(p, { scope: 'game', game: 'peoples-bitcoin', sid: `sid${i}` });
    host.join([p]);
    host.message(p, OP.HELLO, JSON.stringify({ proto: PROTOCOL_VERSION, sim: SIM_VERSION }));
    ps.push(p);
  }
  let seed = 7;
  const rand = (n: number) => {
    seed = (seed * 1103515245 + 12345) >>> 0;
    return seed % n;
  };
  for (const k of Object.keys(profile)) delete profile[k];
  let bytes = 0;
  const t0 = now();
  for (let t = 0; t < ticks; t++) {
    for (const p of ps) {
      if (rand(1000) >= walkShare * 1000) continue;
      const walk = { type: 'walk', x: 12 + rand(30), y: 20 + rand(20) };
      host.message(p, OP.INTENTS, JSON.stringify({ seq: t, intents: [walk] }));
    }
    for (let l = 0; l < NET.loopsPerTick; l++) {
      for (const m of host.loop().messages) bytes += m.data.length * (m.to ? m.to.length : 1);
    }
  }
  const total = now() - t0;
  const out: Record<string, number> = {
    msPerTick: total / ticks,
    kbPerClientTick: bytes / ticks / players / 1024,
  };
  for (const [k, v] of Object.entries(profile)) out[`${k}MsPerTick`] = v / ticks;
  return out;
}
