/**
 * UUIDv7 for earn batches and shop orders. UUIDv5 for quest rewards so the
 * same quest always resends the same key. The quest name format lives in
 * `questEarnName`; this file only turns that name into a UUID.
 */

/** Fixed namespace for quest earn keys. Changing it changes every key. */
export const QUEST_EARN_NAMESPACE = '6f0e2a44-9c1b-4d55-8e77-3a1b9c0d4e21';

function rotl(n: number, s: number): number {
  return ((n << s) | (n >>> (32 - s))) >>> 0;
}

function sha1(message: Uint8Array): Uint8Array {
  const ml = message.length;
  const withPad = new Uint8Array(((ml + 9 + 63) >> 6) << 6);
  withPad.set(message);
  withPad[ml] = 0x80;
  const view = new DataView(withPad.buffer);
  const bitHi = Math.floor(ml / 0x20000000);
  const bitLo = (ml << 3) >>> 0;
  view.setUint32(withPad.length - 8, bitHi, false);
  view.setUint32(withPad.length - 4, bitLo, false);

  let h0 = 0x67452301;
  let h1 = 0xefcdab89;
  let h2 = 0x98badcfe;
  let h3 = 0x10325476;
  let h4 = 0xc3d2e1f0;
  const w = new Uint32Array(80);

  for (let i = 0; i < withPad.length; i += 64) {
    for (let t = 0; t < 16; t++) w[t] = view.getUint32(i + t * 4, false);
    for (let t = 16; t < 80; t++) {
      w[t] = rotl((w[t - 3]! ^ w[t - 8]! ^ w[t - 14]! ^ w[t - 16]!) >>> 0, 1);
    }
    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    for (let t = 0; t < 80; t++) {
      let f: number;
      let k: number;
      if (t < 20) {
        f = (b & c) | (~b & d);
        k = 0x5a827999;
      } else if (t < 40) {
        f = b ^ c ^ d;
        k = 0x6ed9eba1;
      } else if (t < 60) {
        f = (b & c) | (b & d) | (c & d);
        k = 0x8f1bbcdc;
      } else {
        f = b ^ c ^ d;
        k = 0xca62c1d6;
      }
      const temp = (rotl(a, 5) + (f >>> 0) + e + k + w[t]!) >>> 0;
      e = d;
      d = c;
      c = rotl(b, 30);
      b = a;
      a = temp;
    }
    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
  }

  const out = new Uint8Array(20);
  const ov = new DataView(out.buffer);
  ov.setUint32(0, h0);
  ov.setUint32(4, h1);
  ov.setUint32(8, h2);
  ov.setUint32(12, h3);
  ov.setUint32(16, h4);
  return out;
}

function parseUuid(uuid: string): Uint8Array {
  const hex = uuid.replace(/-/g, '');
  const out = new Uint8Array(16);
  for (let i = 0; i < 16; i++) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function formatUuid(bytes: Uint8Array): string {
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Idempotency key for one quest reward. `name` comes from `questEarnName`
 * (`pb:quest:<questId>`, plus a step or choice id when the reward is not the
 * quest's only payout).
 */
export function questEarnWireKey(name: string): string {
  return uuidv5(name);
}

/** UUIDv5 of `name` under the quest namespace. */
export function uuidv5(name: string, namespace = QUEST_EARN_NAMESPACE): string {
  const ns = parseUuid(namespace);
  const nameBytes = new TextEncoder().encode(name);
  const data = new Uint8Array(ns.length + nameBytes.length);
  data.set(ns);
  data.set(nameBytes, ns.length);
  const hash = sha1(data).slice(0, 16);
  hash[6] = ((hash[6] ?? 0) & 0x0f) | 0x50;
  hash[8] = ((hash[8] ?? 0) & 0x3f) | 0x80;
  return formatUuid(hash);
}

export function uuidv7(now = Date.now()): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const ts = BigInt(now);
  bytes[0] = Number((ts >> 40n) & 0xffn);
  bytes[1] = Number((ts >> 32n) & 0xffn);
  bytes[2] = Number((ts >> 24n) & 0xffn);
  bytes[3] = Number((ts >> 16n) & 0xffn);
  bytes[4] = Number((ts >> 8n) & 0xffn);
  bytes[5] = Number(ts & 0xffn);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x70;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  return formatUuid(bytes);
}
