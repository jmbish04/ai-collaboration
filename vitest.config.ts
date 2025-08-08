import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      'cloudflare:workers': path.resolve(__dirname, './tests/worker-shim.ts')
    }
  },
  test: {
    environment: 'node'
  }
});
