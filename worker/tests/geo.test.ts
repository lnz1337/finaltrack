import { describe, it, expect } from 'vitest';
import { extractGeo } from '../src/lib/geo';

function makeReq(headers: Record<string, string>): Request {
  return new Request('http://test', { headers });
}

describe('extractGeo', () => {
  it('lê country/region/city dos headers cf-*', () => {
    const req = makeReq({
      'cf-ipcountry': 'BR',
      'cf-region': 'SP',
      'cf-ipcity': 'São Paulo',
      'cf-connecting-ip': '189.45.12.34',
    });
    expect(extractGeo(req)).toEqual({
      country: 'BR',
      region: 'SP',
      city: 'São Paulo',
      ip: '189.45.12.34',
    });
  });

  it('retorna campos undefined quando header ausente', () => {
    const req = makeReq({});
    expect(extractGeo(req)).toEqual({
      country: undefined,
      region: undefined,
      city: undefined,
      ip: undefined,
    });
  });

  it('ignora valores XX (CF para anônimos)', () => {
    const req = makeReq({ 'cf-ipcountry': 'XX' });
    expect(extractGeo(req).country).toBeUndefined();
  });
});
