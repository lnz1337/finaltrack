import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest';
import { env } from 'cloudflare:test';
import { createSupabaseClient } from '../src/lib/supabase';

const TEST_WORKSPACE_ID = '00000000-0000-0000-0000-000000000001';

beforeAll(() => {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY precisam estar em .dev.vars');
  }
});

describe('createSupabaseClient', () => {
  const sb = createSupabaseClient(env);

  async function cleanup() {
    await sb.delete('clicks', { workspace_id: `eq.${TEST_WORKSPACE_ID}`, click_id: 'like.test_insert_%' });
  }

  afterEach(cleanup);
  afterAll(cleanup);

  it('select retorna array', async () => {
    const rows = await sb.select<{ id: string }>('workspaces', { id: `eq.${TEST_WORKSPACE_ID}`, select: 'id' });
    expect(rows.length).toBe(1);
  });

  it('insert single row', async () => {
    await sb.insert('clicks', {
      click_id: 'test_insert_1',
      visitor_id: 'v1',
      workspace_id: TEST_WORKSPACE_ID,
      landing_url: 'http://test/lp',
    });
    const rows = await sb.select<{ click_id: string }>('clicks', { click_id: 'eq.test_insert_1', select: 'click_id' });
    expect(rows[0].click_id).toBe('test_insert_1');
  });

  it('insert idempotente em conflito (onConflict)', async () => {
    const row = {
      click_id: 'test_insert_2',
      visitor_id: 'v1',
      workspace_id: TEST_WORKSPACE_ID,
      landing_url: 'http://test/lp',
    };
    await sb.insert('clicks', row);
    // segunda inserção deve não jogar (vai retornar 200/204 silenciosa via Prefer: resolution=ignore-duplicates)
    await sb.insert('clicks', row, { onConflict: 'click_id' });
    const rows = await sb.select<{ click_id: string }>('clicks', { click_id: 'eq.test_insert_2', select: 'click_id' });
    expect(rows.length).toBe(1);
  });
});
