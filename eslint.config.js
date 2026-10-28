import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig(
  { ignores: ['dist', 'coverage', 'node_modules'] },
  js.configs.recommended,
  tseslint.configs.recommended,
  { languageOptions: { globals: { ...globals.browser } } },
  {
    // The simulation must stay pure so it can run on the server (phase 5).
    files: ['src/sim/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['three', 'three/*', '**/render/**', '**/ui/**', '**/input/**'],
              message: 'src/sim must not import Three.js, DOM, render, ui or input code.',
            },
          ],
        },
      ],
    },
  },
  prettier,
);
