import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
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

/** sha256 of the vendored package bytes, path-sorted, so the hash is stable. */
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

describe('vendored hub SDK 0.2.0', () => {
  it('records the path-sorted sha256 of vendor/hub-sdk', () => {
    const hash = vendoredSdkSha256();
    expect(hash, `full sha256 ${hash}; Tech's prefix 634de052 does not match this tree`).toBe(
      '1ed7063c8c5e5d1428dfd202e4435d14895678a3320e72f8740167b7c4a7495c',
    );
  });
});
