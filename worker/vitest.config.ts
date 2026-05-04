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
        },
      },
    },
  },
});
