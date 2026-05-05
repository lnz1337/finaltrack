import { describe, it, expect } from 'vitest';
import { parseUserAgent, isBot } from '../src/lib/ua';

describe('parseUserAgent', () => {
  it('Chrome desktop em macOS', () => {
    const ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
    expect(parseUserAgent(ua)).toEqual({ device_type: 'desktop', os: 'macOS', browser: 'Chrome' });
  });

  it('Safari iPhone (mobile)', () => {
    const ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1';
    expect(parseUserAgent(ua)).toEqual({ device_type: 'mobile', os: 'iOS', browser: 'Safari' });
  });

  it('Chrome em Android tablet', () => {
    const ua = 'Mozilla/5.0 (Linux; Android 13; SM-X700) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
    const r = parseUserAgent(ua);
    expect(r.os).toBe('Android');
    expect(r.browser).toBe('Chrome');
    // tablet detection é best-effort; aceita mobile ou tablet
    expect(['mobile', 'tablet']).toContain(r.device_type);
  });

  it('Edge em Windows', () => {
    const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0';
    expect(parseUserAgent(ua)).toEqual({ device_type: 'desktop', os: 'Windows', browser: 'Edge' });
  });

  it('UA vazio retorna defaults', () => {
    expect(parseUserAgent('')).toEqual({ device_type: 'desktop', os: 'Other', browser: 'Other' });
    expect(parseUserAgent(undefined)).toEqual({ device_type: 'desktop', os: 'Other', browser: 'Other' });
  });
});

describe('isBot', () => {
  it.each([
    'Googlebot/2.1 (+http://www.google.com/bot.html)',
    'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)',
    'Mozilla/5.0 (compatible; AhrefsBot/7.0; +http://ahrefs.com/robot/)',
    'Mozilla/5.0 (compatible; SemrushBot/7~bl; +http://www.semrush.com/bot.html)',
    'DuckDuckBot/1.1; (+http://duckduckgo.com/duckduckbot.html)',
    'Mozilla/5.0 (compatible; YandexBot/3.0; +http://yandex.com/bots)',
    'Mozilla/5.0 (compatible; some-crawler/1.0)',
    'My Custom Spider 1.0',
  ])('detecta bot: %s', (ua) => {
    expect(isBot(ua)).toBe(true);
  });

  it.each([
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1',
  ])('não detecta humano como bot: %s', (ua) => {
    expect(isBot(ua)).toBe(false);
  });

  it('UA vazio é considerado bot', () => {
    expect(isBot('')).toBe(true);
    expect(isBot(undefined)).toBe(true);
  });
});
