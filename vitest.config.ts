import { config } from 'dotenv';
import { defineConfig } from 'vitest/config';
import path from 'node:path';

// Load base env, then let .env.test override it. Tests that hit the DB MUST run against a
// separate `docsystem_test` database so they can never delete real dev/import data.
config({ path: '.env' });
config({ path: '.env.test', override: true });

export default defineConfig({
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  test: { environment: 'node', include: ['src/**/*.test.{ts,tsx}'] },
});
