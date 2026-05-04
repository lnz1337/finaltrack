import { describe, it, expect } from 'vitest';
import { parseUtmPipe } from '../src/lib/utm';

describe('parseUtmPipe', () => {
  it('retorna {name, id} quando há pipe', () => {
    expect(parseUtmPipe('Campanha BR|123456789')).toEqual({
      name: 'Campanha BR',
      id: '123456789',
    });
  });

  it('split no último pipe (permite pipe no nome)', () => {
    expect(parseUtmPipe('Campanha|com|pipe|999')).toEqual({
      name: 'Campanha|com|pipe',
      id: '999',
    });
  });

  it('retorna {name} sem id quando não há pipe', () => {
    expect(parseUtmPipe('NomeSimples')).toEqual({ name: 'NomeSimples' });
  });

  it('retorna undefined quando string vazia', () => {
    expect(parseUtmPipe('')).toBeUndefined();
    expect(parseUtmPipe(undefined)).toBeUndefined();
  });

  it('trim de espaços ao redor', () => {
    expect(parseUtmPipe('  Foo | 42 ')).toEqual({ name: 'Foo', id: '42' });
  });

  it('retorna undefined quando nome fica vazio (pipe inicial)', () => {
    expect(parseUtmPipe('|123')).toBeUndefined();
  });

  it('retorna undefined quando só há pipes/espaços', () => {
    expect(parseUtmPipe('  |  ')).toBeUndefined();
  });
});
