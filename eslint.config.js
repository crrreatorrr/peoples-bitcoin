import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig(
  { ignores: ['dist', 'dist-sim', 'coverage', 'node_modules', 'vendor'] },
  js.configs.recommended,
  tseslint.configs.recommended,
  { languageOptions: { globals: { ...globals.browser } } },
  { files: ['scripts/**/*.mjs'], languageOptions: { globals: { ...globals.node } } },
  {
    // The simulation, server host and protocol must stay pure: they run in Nakama's JS runtime.
    files: ['src/sim/**/*.ts', 'src/server/**/*.ts', 'src/net/protocol.ts', 'src/net/simVersion.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                'three',
                'three/*',
                '**/render/**',
                '**/ui/**',
                '**/input/**',
                '**/hub/**',
                '**/game/**',
                '@metaverse/*',
              ],
              message:
                'src/sim, src/server and the protocol must not import Three.js, DOM, render, ui, input, hub or game code.',
            },
          ],
        },
      ],
    },
  },
  prettier,
);
