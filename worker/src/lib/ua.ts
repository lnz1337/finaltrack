const BOT_RE = /Googlebot|bingbot|AhrefsBot|SemrushBot|DuckDuckBot|YandexBot|crawler|spider/i;

export function isBot(ua: string | undefined | null): boolean {
  if (!ua) return true;
  return BOT_RE.test(ua);
}

export interface UAParsed {
  device_type: 'desktop' | 'mobile' | 'tablet';
  os: 'iOS' | 'Android' | 'macOS' | 'Windows' | 'Linux' | 'Other';
  browser: 'Chrome' | 'Safari' | 'Firefox' | 'Edge' | 'Other';
}

export function parseUserAgent(ua: string | undefined | null): UAParsed {
  if (!ua) return { device_type: 'desktop', os: 'Other', browser: 'Other' };

  let os: UAParsed['os'] = 'Other';
  if (/iPhone|iPad|iPod/i.test(ua)) os = 'iOS';
  else if (/Android/i.test(ua)) os = 'Android';
  else if (/Mac OS X|Macintosh/i.test(ua)) os = 'macOS';
  else if (/Windows/i.test(ua)) os = 'Windows';
  else if (/Linux/i.test(ua)) os = 'Linux';

  let device_type: UAParsed['device_type'] = 'desktop';
  if (os === 'iOS') {
    device_type = /iPad/i.test(ua) ? 'tablet' : 'mobile';
  } else if (os === 'Android') {
    // tablets Android tipicamente NÃO têm "Mobile" no UA
    device_type = /Mobile/i.test(ua) ? 'mobile' : 'tablet';
  } else if (/Mobile/i.test(ua)) {
    device_type = 'mobile';
  }

  let browser: UAParsed['browser'] = 'Other';
  if (/Edg\//i.test(ua)) browser = 'Edge';
  else if (/Chrome\//i.test(ua) && !/Edg\//i.test(ua)) browser = 'Chrome';
  else if (/Firefox\//i.test(ua)) browser = 'Firefox';
  else if (/Safari\//i.test(ua) && !/Chrome\//i.test(ua)) browser = 'Safari';

  return { device_type, os, browser };
}
