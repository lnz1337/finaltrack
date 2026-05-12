import { describe, it, expect } from 'vitest';
import { signState, verifyState } from '../../src/lib/google-ads/oauth-state';

const SECRET = '0123456789abcdef0123456789abcdef';
const WORKSPACE_ID = '00000000-0000-0000-0000-000000000001';

describe('signState / verifyState', () => {
  it('roundtrip: sign válido → verify retorna payload', async () => {
    const state = await signState({ workspace_id: WORKSPACE_ID }, SECRET, 600);
    const payload = await verifyState(state, state, SECRET);
    expect(payload?.workspace_id).toBe(WORKSPACE_ID);
  });

  it('verify retorna null quando state da query ≠ state do cookie', async () => {
    const a = await signState({ workspace_id: WORKSPACE_ID }, SECRET, 600);
    const b = await signState({ workspace_id: WORKSPACE_ID }, SECRET, 600);
    expect(await verifyState(a, b, SECRET)).toBeNull();
  });

  it('verify retorna null quando assinatura inválida', async () => {
    const state = await signState({ workspace_id: WORKSPACE_ID }, SECRET, 600);
    const tampered = state.slice(0, -4) + 'aaaa';
    expect(await verifyState(tampered, tampered, SECRET)).toBeNull();
  });

  it('verify retorna null quando exp expirou', async () => {
    const state = await signState({ workspace_id: WORKSPACE_ID }, SECRET, -10);
    expect(await verifyState(state, state, SECRET)).toBeNull();
  });

  it('verify retorna null com secret diferente', async () => {
    const state = await signState({ workspace_id: WORKSPACE_ID }, SECRET, 600);
    expect(await verifyState(state, state, 'wrong-secret')).toBeNull();
  });

  it('verify retorna null com state malformado', async () => {
    expect(await verifyState('not.a.signed.state', 'not.a.signed.state', SECRET)).toBeNull();
    expect(await verifyState('', '', SECRET)).toBeNull();
  });
});
