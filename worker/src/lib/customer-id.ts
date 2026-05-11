export function parseCustomerId(input: string): string {
  const digits = input.replace(/-/g, '');
  if (!/^\d{10}$/.test(digits)) {
    throw new Error('invalid_customer_id_format');
  }
  return digits;
}

export function formatCustomerId(raw: string): string {
  if (!/^\d{10}$/.test(raw)) {
    throw new Error('invalid_customer_id_format');
  }
  return `${raw.slice(0, 3)}-${raw.slice(3, 6)}-${raw.slice(6)}`;
}
