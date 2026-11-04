#!/usr/bin/env node
/**
 * Load test for online worlds against a running hub Nakama (not part of
 * npm test). Each bot is a guest: device auth, portal.enter for
 * peoples-bitcoin, ticket redeem, then it joins a world, walks and chats.
 * The world logs "[pb_world N] P players, loop avg X ms, worst Y ms" about
 * once a minute; watch the Nakama log while this runs.
 *
 *   NAKAMA_URL=http://127.0.0.1:7350 NAKAMA_SERVER_KEY=defaultkey \
 *     BOTS=100 SECONDS=120 WALK=0.3 node scripts/pb-bots.mjs
 *
 * WORLD picks a world number (default 1). Node 22 (global fetch and WebSocket).
 */
const BASE = process.env.NAKAMA_URL ?? 'http://127.0.0.1:7350';
const KEY = process.env.NAKAMA_SERVER_KEY ?? 'defaultkey';
const BOTS = Number(process.env.BOTS ?? 50);
const SECONDS = Number(process.env.SECONDS ?? 60);
const WALK = Number(process.env.WALK ?? 0.3);
const WORLD = Number(process.env.WORLD ?? 1);
const GAME = 'peoples-bitcoin';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const basic = `Basic ${Buffer.from(`${KEY}:`).toString('base64')}`;

async function post(path, body, auth) {
  const r = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { Authorization: auth, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${path} ${r.status} ${text}`);
  return text ? JSON.parse(text) : {};
}

async function login() {
  const hub = await post(
    '/v2/account/authenticate/device?create=true',
    { id: crypto.randomUUID() },
    basic,
  );
  const opened = await post(
    '/v2/rpc/portal.enter?unwrap=true',
    { game: GAME, ranked: false },
    `Bearer ${hub.token}`,
  );
  if (!opened.ticket) throw new Error(`portal.enter: ${JSON.stringify(opened)}`);
  const game = await post(
    '/v2/account/authenticate/custom?create=false',
    { id: `t:${opened.ticket}`, vars: { game: GAME } },
    basic,
  );
  return game.token;
}

const send = (ws, matchId, op, body) =>
  ws.send(
    JSON.stringify({
      match_data_send: {
        match_id: matchId,
        op_code: String(op),
        data: Buffer.from(JSON.stringify(body)).toString('base64'),
      },
    }),
  );

const tokens = [];
for (let i = 0; i < BOTS; i++) tokens.push(await login());
const listed = await post('/v2/rpc/pb.worlds?unwrap=true', {}, `Bearer ${tokens[0]}`);
const world = listed.worlds.find((w) => w.world === WORLD) ?? listed.worlds[0];
console.log(`world ${world.world} (${world.matchId}), sim ${listed.sim}, ${BOTS} bots`);

let bytes = 0;
let kicked = 0;
const socks = [];
for (const token of tokens) {
  const ws = new WebSocket(
    `${BASE.replace(/^http/, 'ws')}/ws?lang=en&status=false&token=${encodeURIComponent(token)}`,
  );
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  ws.onmessage = (e) => {
    bytes += String(e.data).length;
    if (String(e.data).includes('"op_code":"107"')) kicked++;
  };
  ws.send(JSON.stringify({ cid: '1', match_join: { match_id: world.matchId } }));
  socks.push(ws);
}
await sleep(1000);
for (const ws of socks) send(ws, world.matchId, 1, { proto: 1, sim: listed.sim, client: 'bot' });
const start = Date.now();
let seq = 0;
while (Date.now() - start < SECONDS * 1000) {
  for (const ws of socks) {
    if (ws.readyState !== WebSocket.OPEN) continue;
    if (Math.random() < WALK) {
      const walk = {
        type: 'walk',
        x: 12 + Math.floor(Math.random() * 30),
        y: 20 + Math.floor(Math.random() * 20),
      };
      send(ws, world.matchId, 2, { seq: ++seq, intents: [walk] });
    }
    if (Math.random() < 0.01) send(ws, world.matchId, 3, { ch: 'quick', phrase: 'hi' });
  }
  await sleep(600);
}
const open = socks.filter((ws) => ws.readyState === WebSocket.OPEN).length;
console.log(
  `${open}/${BOTS} still connected, ${kicked} kicks, ${(bytes / BOTS / SECONDS / 1024).toFixed(1)} KB/s per client`,
);
for (const ws of socks) ws.close();
process.exit(0);
