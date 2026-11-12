import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
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

// Source: crrreatorrr/metaverse-hub branch claude/nifty-einstein-ptgr08 @ 2a6a4bc (the whole-page
// feedback screenshot; not on hub main yet).
describe('vendored hub SDK 0.7.2', () => {
  // Hub main redeems with custom auth plus the server key, then profile.get. It registers
  // no session.claim RPC, so a vendor that calls one never gets a session.
  it('redeems the way the merged hub server expects', () => {
    const read = (file: string) =>
      new TextDecoder().decode(readFileSync(`vendor/hub-sdk/dist/${file}`));
    expect(read('live.js')).not.toContain('session.claim');
    expect(read('live.js')).not.toContain('session.redeem');
    expect(read('nakama.js')).toContain('Authorization: `Basic ${btoa(`${serverKey}:`)}`');
  });

  it('pins the package version, the byte hash, and the standard manifest', () => {
    const pkg = JSON.parse(
      new TextDecoder().decode(readFileSync('vendor/hub-sdk/package.json')),
    ) as {
      version: string;
    };
    expect(pkg.version).toBe('0.7.2');
    const hash = vendoredSdkSha256();
    expect(hash, `byte hash ${hash}`).toBe(
      '916ffac0b09d9f0a94c4cedf89cdea4cdcdaac660862e83eca93deedba9934c7',
    );
    const manifest = vendoredSdkManifestSha256();
    expect(manifest, `manifest ${manifest}`).toBe(
      '8cc25fc9797fe532e13ae65d44f656275089e6c84462b4caed107e88a4b44437',
    );
    const iife = createHash('sha256')
      .update(readFileSync('vendor/hub-sdk/dist/hub-sdk.iife.js'))
      .digest('hex');
    expect(iife, `iife ${iife}`).toBe(
      '25b989eb2cda2227e4395c84965c7a4bea5f937c3df442c08aad8ab8c40e5a35',
    );
    const pin = JSON.parse(
      new TextDecoder().decode(readFileSync('vendor/hub-sdk/SOURCE.pin.json')),
    ) as { version: string; iifeSha256: string; global: string };
    expect(pin.version).toBe('0.7.2');
    expect(pin.global).toBe('HubSDK');
    expect(pin.iifeSha256).toBe(iife);
  });
});
