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

// Source: crrreatorrr/metaverse-hub main @ 2a82e9e (PR #117)
describe('vendored hub SDK 0.6.4', () => {
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
    expect(pkg.version).toBe('0.6.4');
    const hash = vendoredSdkSha256();
    expect(hash, `byte hash ${hash}`).toBe(
      '8c7bdc725ddd82b6899578d2f2e514c60998110b47a20df3cf34d10f86f67198',
    );
    const manifest = vendoredSdkManifestSha256();
    expect(manifest, `manifest ${manifest}`).toBe(
      '35a9b4ba19fce5fe91872b84e25d36a2eab49aca9f1152a1bb0b91549390a770',
    );
    const iife = createHash('sha256')
      .update(readFileSync('vendor/hub-sdk/dist/hub-sdk.iife.js'))
      .digest('hex');
    expect(iife, `iife ${iife}`).toBe(
      'e7626595184dc132e72ffd707c87149b266c7b3933d40670e55eb2fb0a64eda6',
    );
    const pin = JSON.parse(
      new TextDecoder().decode(readFileSync('vendor/hub-sdk/SOURCE.pin.json')),
    ) as { version: string; iifeSha256: string; global: string };
    expect(pin.version).toBe('0.6.4');
    expect(pin.global).toBe('HubSDK');
    expect(pin.iifeSha256).toBe(iife);
  });
});
