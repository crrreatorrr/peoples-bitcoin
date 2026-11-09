import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';
import { simHash } from './scripts/simHash.mjs';

/**
 * Public path for this build. `VITE_BASE` overrides it (a path or an absolute
 * URL, with or without a trailing slash). Dev defaults to the play mount;
 * production and `vite preview` default to `/peoples-bitcoin/`.
 * Hub links stay `/hub/#from=peoples-bitcoin` and are not prefixed.
 */
function appBase(command: 'build' | 'serve', mode: string): string {
  const fromEnv = (
    loadEnv(mode, process.cwd(), '').VITE_BASE ||
    process.env.VITE_BASE ||
    ''
  ).trim();
  const chosen =
    fromEnv.length > 0
      ? fromEnv
      : command === 'serve' && mode !== 'production'
        ? '/play/peoples-bitcoin/'
        : '/peoples-bitcoin/';
  if (chosen === './' || chosen.endsWith('/')) return chosen;
  return `${chosen}/`;
}

export default defineConfig(({ command, mode }) => ({
  base: appBase(command, mode),
  // The client and the server bundle (npm run build:sim) must agree on this.
  define: { __PB_SIM_VERSION__: JSON.stringify(simHash()) },
  server: {
    proxy: {
      '/v2': { target: 'http://127.0.0.1:7350', changeOrigin: true },
      '/ws': { target: 'http://127.0.0.1:7350', ws: true, changeOrigin: true },
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    coverage: {
      include: ['src/sim/**'],
      reporter: ['text', 'html'],
    },
  },
}));
