import type { Env } from '../types';

export interface InsertOptions {
  onConflict?: string; // nome da coluna pra ignorar duplicatas
}

export interface UpsertOptions {
  onConflict: string; // colunas separadas por vírgula
}

export interface SupabaseClient {
  select<T = unknown>(table: string, query: Record<string, string>): Promise<T[]>;
  insert<T = unknown>(table: string, row: T | T[], opts?: InsertOptions): Promise<void>;
  update(table: string, query: Record<string, string>, patch: Record<string, unknown>): Promise<void>;
  upsert<T = unknown>(table: string, row: T | T[], opts: UpsertOptions): Promise<void>;
  delete(table: string, query: Record<string, string>): Promise<void>;
  rpc<T = unknown>(name: string, params: Record<string, unknown>): Promise<T>;
}

export function createSupabaseClient(env: Env): SupabaseClient {
  const baseUrl = env.SUPABASE_URL.replace(/\/$/, '');
  const headers = (extra: Record<string, string> = {}): HeadersInit => ({
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
    ...extra,
  });

  function buildQuery(query: Record<string, string>): string {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) params.set(k, v);
    const s = params.toString();
    return s ? `?${s}` : '';
  }

  return {
    async select<T = unknown>(table: string, query: Record<string, string>): Promise<T[]> {
      const url = `${baseUrl}/rest/v1/${table}${buildQuery(query)}`;
      const res = await fetch(url, { method: 'GET', headers: headers() });
      if (!res.ok) throw new Error(`Supabase select falhou ${res.status}: ${await res.text()}`);
      return (await res.json()) as T[];
    },

    async insert<T = unknown>(table: string, row: T | T[], opts: InsertOptions = {}): Promise<void> {
      const url = `${baseUrl}/rest/v1/${table}`;
      const prefer = opts.onConflict
        ? 'resolution=ignore-duplicates,return=minimal'
        : 'return=minimal';
      const extraHeaders: Record<string, string> = { Prefer: prefer };
      if (opts.onConflict) extraHeaders['on-conflict'] = opts.onConflict;
      const res = await fetch(url + (opts.onConflict ? `?on_conflict=${opts.onConflict}` : ''), {
        method: 'POST',
        headers: headers(extraHeaders),
        body: JSON.stringify(Array.isArray(row) ? row : [row]),
      });
      if (!res.ok && res.status !== 201 && res.status !== 200 && res.status !== 204) {
        throw new Error(`Supabase insert falhou ${res.status}: ${await res.text()}`);
      }
    },

    async update(table: string, query: Record<string, string>, patch: Record<string, unknown>): Promise<void> {
      const url = `${baseUrl}/rest/v1/${table}${buildQuery(query)}`;
      const res = await fetch(url, {
        method: 'PATCH',
        headers: headers({ Prefer: 'return=minimal' }),
        body: JSON.stringify(patch),
      });
      if (!res.ok && res.status !== 204) {
        throw new Error(`Supabase update falhou ${res.status}: ${await res.text()}`);
      }
    },

    async upsert<T = unknown>(table: string, row: T | T[], opts: UpsertOptions): Promise<void> {
      const url = `${baseUrl}/rest/v1/${table}?on_conflict=${opts.onConflict}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: headers({
          Prefer: 'resolution=merge-duplicates,return=minimal',
        }),
        body: JSON.stringify(Array.isArray(row) ? row : [row]),
      });
      if (!res.ok && res.status !== 201 && res.status !== 200 && res.status !== 204) {
        throw new Error(`Supabase upsert falhou ${res.status}: ${await res.text()}`);
      }
    },

    async delete(table: string, query: Record<string, string>): Promise<void> {
      const url = `${baseUrl}/rest/v1/${table}${buildQuery(query)}`;
      const res = await fetch(url, { method: 'DELETE', headers: headers({ Prefer: 'return=minimal' }) });
      if (!res.ok && res.status !== 204) {
        throw new Error(`Supabase delete falhou ${res.status}: ${await res.text()}`);
      }
    },

    async rpc<T = unknown>(name: string, params: Record<string, unknown>): Promise<T> {
      const url = `${baseUrl}/rest/v1/rpc/${name}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify(params),
      });
      if (!res.ok) throw new Error(`Supabase rpc ${name} falhou ${res.status}: ${await res.text()}`);
      return (await res.json()) as T;
    },
  };
}
