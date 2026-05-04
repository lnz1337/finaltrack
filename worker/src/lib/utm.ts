export interface ParsedPipe {
  name: string;
  id?: string;
}

export function parseUtmPipe(value: string | undefined): ParsedPipe | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;

  const lastPipe = trimmed.lastIndexOf('|');
  if (lastPipe === -1) {
    return { name: trimmed };
  }

  const name = trimmed.slice(0, lastPipe).trim();
  if (!name) return undefined;
  const id = trimmed.slice(lastPipe + 1).trim();
  return id ? { name, id } : { name };
}
