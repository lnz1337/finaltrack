import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { createSupabaseClient } from '../../src/lib/supabase';
import { encryptAesGcm, decryptAesGcm } from '../../src/lib/crypto';

const WORKSPACE_ID = '00000000-0000-0000-0000-000000000001';
const KEY_HEX = '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';

describe('oauth_pending_selections CRUD', () => {
  let sb: ReturnType<typeof createSupabaseClient>;

  beforeEach(async () => {
    sb = createSupabaseClient(env);
    await sb.delete('oauth_pending_selections', { workspace_id: `eq.${WORKSPACE_ID}` });
  });

  it('insere e seleciona pending session com encrypted_payload + payload_iv', async () => {
    const payload = JSON.stringify({
      access_token: 'fake-access',
      refresh_token: 'fake-refresh',
      customer_ids: ['1234567890', '9876543210'],
    });
    const { ciphertext, iv } = await encryptAesGcm(KEY_HEX, payload);

    await sb.insert('oauth_pending_selections', {
      workspace_id: WORKSPACE_ID,
      encrypted_payload: ciphertext,
      payload_iv: iv,
    });

    const rows = await sb.select<{ id: string; encrypted_payload: string; payload_iv: string; expires_at: string }>(
      'oauth_pending_selections',
      { workspace_id: `eq.${WORKSPACE_ID}`, select: 'id,encrypted_payload,payload_iv,expires_at' }
    );
    expect(rows.length).toBe(1);

    const decrypted = await decryptAesGcm(KEY_HEX, rows[0].encrypted_payload, rows[0].payload_iv);
    const parsed = JSON.parse(decrypted);
    expect(parsed.customer_ids).toEqual(['1234567890', '9876543210']);
  });

  it('expires_at default é ~10min no futuro', async () => {
    const before = Date.now();
    await sb.insert('oauth_pending_selections', {
      workspace_id: WORKSPACE_ID,
      encrypted_payload: 'x',
      payload_iv: 'y',
    });
    const rows = await sb.select<{ expires_at: string }>('oauth_pending_selections', {
      workspace_id: `eq.${WORKSPACE_ID}`,
      select: 'expires_at',
      order: 'created_at.desc',
      limit: '1',
    });
    const expiresAt = new Date(rows[0].expires_at).getTime();
    const tenMinFromBefore = before + 10 * 60 * 1000;
    expect(Math.abs(expiresAt - tenMinFromBefore)).toBeLessThan(5000); // tolerância 5s
  });

  it('cleanup query DELETE WHERE expires_at < NOW() pega expirados', async () => {
    // Para satisfazer CHECK (expires_at > created_at) e ainda ter expires_at no passado:
    // created_at = 3min atrás, expires_at = 1min atrás → expired mas válido na constraint
    const createdAt = new Date(Date.now() - 3 * 60 * 1000).toISOString();
    const past = new Date(Date.now() - 60000).toISOString();
    await sb.insert('oauth_pending_selections', {
      workspace_id: WORKSPACE_ID,
      encrypted_payload: 'expired',
      payload_iv: 'iv',
      created_at: createdAt,
      expires_at: past,
    });
    await sb.insert('oauth_pending_selections', {
      workspace_id: WORKSPACE_ID,
      encrypted_payload: 'valid',
      payload_iv: 'iv',
    });

    await sb.delete('oauth_pending_selections', { expires_at: `lt.${new Date().toISOString()}` });

    const remaining = await sb.select<{ encrypted_payload: string }>('oauth_pending_selections', {
      workspace_id: `eq.${WORKSPACE_ID}`,
      select: 'encrypted_payload',
    });
    expect(remaining.length).toBe(1);
    expect(remaining[0].encrypted_payload).toBe('valid');
  });
});
