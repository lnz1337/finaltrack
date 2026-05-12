import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        main: './src/index.ts',
        wrangler: { configPath: './wrangler.toml.example' },
        miniflare: {
          compatibilityDate: '2024-09-01',
          compatibilityFlags: ['nodejs_compat'],
          bindings: {
            TEST_SEED_USER_ID: process.env.TEST_SEED_USER_ID ?? '00000000-0000-0000-0000-00000000000a',
            WORKER_INTERNAL_TOKEN: 'test-internal-token-default',
          },
        },
      },
    },
  },
});
