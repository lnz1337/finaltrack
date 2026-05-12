// Versão da Google Ads API pinada num lugar só — upgrade futuro = mudar aqui.
// Google moveu pra release cadence mensal em 2026; v17 foi sunsetted (retorna 404).
// v23 = current stable (lançada 2026-01-28). Revisar a cada ~6 meses (ver tech debt no spec §13).
export const GOOGLE_ADS_API_VERSION = 'v23';
export const GOOGLE_ADS_API_BASE = `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}`;
