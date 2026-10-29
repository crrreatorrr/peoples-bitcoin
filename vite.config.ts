import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: './',
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
});
