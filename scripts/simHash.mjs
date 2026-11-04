/**
 * The sim version: the first 16 hex of a SHA-256 over every source file that
 * the server bundle and the client must agree on (sim, server, protocol,
 * config, data). Vite and build-sim-bundle.mjs both use it, so a client and a
 * world built from the same tree always match.
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOTS = ['src/sim', 'src/server', 'src/config', 'src/data', 'src/net/protocol.ts'];

function files(path) {
  const st = statSync(path);
  if (st.isFile()) return [path];
  return readdirSync(path)
    .sort()
    .flatMap((name) => files(join(path, name)));
}

export function simHash(root = process.cwd()) {
  const hash = createHash('sha256');
  for (const r of ROOTS) {
    for (const f of files(join(root, r))) {
      if (!/\.(ts|json)$/.test(f)) continue;
      hash.update(relative(root, f).split('\\').join('/'));
      hash.update('\0');
      hash.update(readFileSync(f));
      hash.update('\0');
    }
  }
  return hash.digest('hex').slice(0, 16);
}
