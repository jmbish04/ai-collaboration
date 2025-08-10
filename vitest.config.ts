import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  // The 'resolve' block from the main branch is crucial for
  // mocking the Cloudflare Workers environment during testing.
  resolve: {
    alias: {
      'cloudflare:workers': path.resolve(__dirname, './tests/worker-shim.ts')
    }
  },
  test: {
    // Both branches agreed on using the 'node' environment for tests.
    environment: 'node'
  }
});
