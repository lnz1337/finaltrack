export interface DedupConfig {
  url: string;
  token: string;
  fetchImpl?: typeof fetch;
}

export interface Dedup {
  /**
   * Tenta marcar a chave com TTL. Retorna true se já existia (duplicado),
   * false se foi marcada com sucesso (primeira vez).
   */
  checkAndMark(key: string, ttlSeconds: number): Promise<boolean>;
}

export function createDedup(cfg: DedupConfig): Dedup {
  const { url, token } = cfg;
  const fetchImpl = cfg.fetchImpl ?? fetch;

  if (!url) {
    return {
      async checkAndMark() {
        return false;
      },
    };
  }

  return {
    async checkAndMark(key: string, ttlSeconds: number): Promise<boolean> {
      const safeKey = encodeURIComponent(key);
      const u = `${url.replace(/\/$/, '')}/set/${safeKey}/1?NX=true&EX=${ttlSeconds}`;
      const res = await fetchImpl(u, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        // Em caso de erro do Upstash, fail open (não bloqueia webhook). UNIQUE do Postgres protege.
        console.error('[dedup] upstash error', res.status, await res.text());
        return false;
      }
      const body = (await res.json()) as { result: string | null };
      return body.result === null; // null = NX falhou = chave já existia
    },
  };
}
