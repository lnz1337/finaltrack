import { SELF, env } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import { createSupabaseClient } from '../src/lib/supabase';

const WS = '00000000-0000-0000-0000-000000000001';
const sb = createSupabaseClient(env);

beforeEach(async () => {
  await sb.delete('clicks', { workspace_id: `eq.${WS}`, click_id: 'like.tc_*' });
});

const HUMAN_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

describe('POST /track/click', () => {
  it('insere click válido com UTMs parsed', async () => {
    const res = await SELF.fetch('http://test/track/click', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'user-agent': HUMAN_UA,
        'cf-ipcountry': 'BR',
        'cf-region': 'SP',
        'cf-ipcity': 'São Paulo',
        'cf-connecting-ip': '189.45.12.34',
      },
      body: JSON.stringify({
        workspace_id: WS,
        click_id: 'tc_1',
        visitor_id: 'vTC',
        landing_url: 'http://lp/?gclid=ABC&utm_campaign=Foo|123&utm_content=Adset|456&utm_term=Ad|789',
        gclid: 'ABC',
        utm_source: 'google',
        utm_campaign: 'Foo|123',
        utm_content: 'Adset|456',
        utm_term: 'Ad|789',
      }),
    });
    expect(res.status).toBe(204);

    const rows = await sb.select<any>('clicks', {
      click_id: 'eq.tc_1',
      select: 'click_id,gclid,campaign_name_parsed,campaign_id_parsed,adset_name_parsed,adset_id_parsed,ad_name_parsed,ad_id_parsed,country,city,device_type,browser',
    });
    expect(rows.length).toBe(1);
    expect(rows[0]).toMatchObject({
      gclid: 'ABC',
      campaign_name_parsed: 'Foo',
      campaign_id_parsed: '123',
      adset_name_parsed: 'Adset',
      adset_id_parsed: '456',
      ad_name_parsed: 'Ad',
      ad_id_parsed: '789',
      country: 'BR',
      city: 'São Paulo',
      device_type: 'desktop',
      browser: 'Chrome',
    });
  });

  it('descarta request com UA Googlebot (204 sem insert)', async () => {
    const res = await SELF.fetch('http://test/track/click', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'user-agent': 'Googlebot/2.1 (+http://www.google.com/bot.html)',
      },
      body: JSON.stringify({ workspace_id: WS, click_id: 'tc_bot', visitor_id: 'v', landing_url: 'http://lp' }),
    });
    expect(res.status).toBe(204);
    const rows = await sb.select<any>('clicks', { click_id: 'eq.tc_bot', select: 'click_id' });
    expect(rows.length).toBe(0);
  });

  it('rejeita 400 sem workspace_id', async () => {
    const res = await SELF.fetch('http://test/track/click', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'user-agent': HUMAN_UA },
      body: JSON.stringify({ click_id: 'tc_x', visitor_id: 'v', landing_url: 'http://lp' }),
    });
    expect(res.status).toBe(400);
  });

  it('idempotente em click_id duplicado', async () => {
    const body = JSON.stringify({ workspace_id: WS, click_id: 'tc_dup', visitor_id: 'v', landing_url: 'http://lp', gclid: 'X' });
    const headers = { 'content-type': 'application/json', 'user-agent': HUMAN_UA };
    const r1 = await SELF.fetch('http://test/track/click', { method: 'POST', headers, body });
    const r2 = await SELF.fetch('http://test/track/click', { method: 'POST', headers, body });
    expect(r1.status).toBe(204);
    expect(r2.status).toBe(204);
    const rows = await sb.select<any>('clicks', { click_id: 'eq.tc_dup', select: 'click_id' });
    expect(rows.length).toBe(1);
  });
});
