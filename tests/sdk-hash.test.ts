import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { isRelicId, memoryKeyValue, RELIC_IDS, type NakamaClient } from '@metaverse/hub-sdk';
import { createLiveHubSdk } from '../vendor/hub-sdk/dist/live.js';
import { describe, expect, it } from 'vitest';

function filesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = `${dir}/${name}`;
    if (statSync(path).isDirectory()) out.push(...filesUnder(path));
    else out.push(path);
  }
  return out;
}

/** sha256 of the vendored package bytes: path, NUL, bytes, NUL, path-sorted. */
export function vendoredSdkSha256(root = 'vendor/hub-sdk'): string {
  const hash = createHash('sha256');
  for (const path of filesUnder(root).sort()) {
    hash.update(path.slice(root.length + 1));
    hash.update('\0');
    hash.update(readFileSync(path));
    hash.update('\0');
  }
  return hash.digest('hex');
}

/** Drop lines that carry a source map pointer, matching `sed '/sourceMappingURL/d'`. */
function stripSourceMappingUrl(bytes: Uint8Array): Uint8Array {
  const lines = new TextDecoder().decode(bytes).split('\n');
  const kept = lines.filter((line) => !line.includes('sourceMappingURL'));
  const text = kept.join('\n');
  const ended = text.endsWith('\n') || text.length === 0 ? text : `${text}\n`;
  return new TextEncoder().encode(ended);
}

/**
 * Standard manifest: skip `.map` files, strip sourceMappingURL lines, write
 * `sha256  ./path` in byte-sorted path order, then sha256 that list.
 */
export function vendoredSdkManifestSha256(root = 'vendor/hub-sdk'): string {
  const paths = filesUnder(root)
    .filter((path) => !path.endsWith('.map'))
    .map((path) => `./${path.slice(root.length + 1)}`)
    .sort();
  const lines = paths.map((rel) => {
    const sum = createHash('sha256')
      .update(stripSourceMappingUrl(readFileSync(`${root}/${rel.slice(2)}`)))
      .digest('hex');
    return `${sum}  ${rel}`;
  });
  return createHash('sha256')
    .update(`${lines.join('\n')}\n`)
    .digest('hex');
}

// Source: crrreatorrr/metaverse-hub branch cursor/ticket-redeem-custom-auth-c054 @ 947ed4c,
// plus the local `tidebreaker_belt` RELIC_IDS patch (VENDOR.md).
describe('vendored hub SDK 0.4.0', () => {
  it('pins the package version, the byte hash, and the standard manifest', () => {
    const pkg = JSON.parse(
      new TextDecoder().decode(readFileSync('vendor/hub-sdk/package.json')),
    ) as {
      version: string;
    };
    expect(pkg.version).toBe('0.4.0');
    const hash = vendoredSdkSha256();
    expect(hash, `byte hash ${hash}`).toBe(
      '6c0886430b6d4d5376e85855d087076b27e737161c9f7648b19e167cb36ffb10',
    );
    const manifest = vendoredSdkManifestSha256();
    expect(manifest, `manifest ${manifest}`).toBe(
      '2d114f113c4109e557591539a328300ab0f485f2bd742ec0a0af1696ade2c5a5',
    );
  });
});

describe('vendored hub SDK relic ids', () => {
  it('keeps the Tidebreaker Belt, so init() does not drop it from relics', () => {
    expect(RELIC_IDS).toContain('tidebreaker_belt');
    expect(isRelicId('tidebreaker_belt')).toBe(true);
    expect(isRelicId('not_a_relic')).toBe(false);
  });
});

describe('vendored hub SDK init relics', () => {
  it('passes tidebreaker_belt through a redeemed session, and still drops unknown ids', async () => {
    const client = {
      authenticateDevice: async () => ({ token: 'device', userId: 'u1' }),
      authenticateCustom: async () => ({ token: 'auth', userId: 'u1' }),
      rpc: async (id: string) => {
        if (id !== 'session.claim') throw new Error(`unexpected rpc ${id}`);
        return {
          token: 'session',
          playerId: 'p1',
          sid: 's1',
          ranked: false,
          relics: ['tinubu_crown', 'tidebreaker_belt', 'made_up_relic'],
          effects: {},
          ticketsCapLeft: 200,
          serverTime: 1,
        };
      },
    } as unknown as NakamaClient;
    const sdk = createLiveHubSdk(
      { readHash: () => '#t=ticket-1', local: memoryKeyValue(), session: memoryKeyValue() },
      client,
    );
    const profile = await sdk.init('peoples-bitcoin');
    expect(profile.relics).toEqual(['tinubu_crown', 'tidebreaker_belt']);
  });
});
