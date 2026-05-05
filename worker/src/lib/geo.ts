export interface GeoInfo {
  country?: string;
  region?: string;
  city?: string;
  ip?: string;
}

export function extractGeo(req: Request): GeoInfo {
  const h = req.headers;
  const country = h.get('cf-ipcountry') ?? undefined;
  const region = h.get('cf-region') ?? undefined;
  const city = h.get('cf-ipcity') ?? undefined;
  const ip = h.get('cf-connecting-ip') ?? undefined;
  return {
    country: country && country !== 'XX' ? country : undefined,
    region: region || undefined,
    city: city || undefined,
    ip: ip || undefined,
  };
}
