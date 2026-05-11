import { describe, it, expect } from 'vitest';
import { formatCustomerId, parseCustomerId } from '../../src/lib/customer-id';

describe('formatCustomerId', () => {
  it('formata 10 dígitos em XXX-XXX-XXXX', () => {
    expect(formatCustomerId('1234567890')).toBe('123-456-7890');
  });

  it('roundtrip format → parse', () => {
    expect(parseCustomerId(formatCustomerId('1234567890'))).toBe('1234567890');
  });

  it('throw em raw com tamanho diferente de 10', () => {
    expect(() => formatCustomerId('123')).toThrow(/invalid_customer_id_format/);
    expect(() => formatCustomerId('12345678901')).toThrow(/invalid_customer_id_format/);
  });

  it('throw em formato com não-dígitos', () => {
    expect(() => formatCustomerId('123456789a')).toThrow(/invalid_customer_id_format/);
  });
});

describe('parseCustomerId', () => {
  it('aceita formato XXX-XXX-XXXX', () => {
    expect(parseCustomerId('123-456-7890')).toBe('1234567890');
  });

  it('aceita raw 10 dígitos sem formatação (idempotente)', () => {
    expect(parseCustomerId('1234567890')).toBe('1234567890');
  });

  it('throw em formato inválido', () => {
    expect(() => parseCustomerId('12-34')).toThrow(/invalid_customer_id_format/);
    expect(() => parseCustomerId('abc-def-ghij')).toThrow(/invalid_customer_id_format/);
  });
});
