import * as cheerio from 'cheerio';

export type Era = 'oracle' | 'bronze' | 'chujian' | 'qinjian';
export const ERAS: Era[] = ['oracle', 'bronze', 'chujian', 'qinjian'];
export const ERA_LABEL: Record<Era, string> = {
  oracle: '甲骨文',
  bronze: '金文',
  chujian: '战国文字',
  qinjian: '篆书',
};

const BASE = 'http://ccamc.org';
const PAGE = `${BASE}/cjkv_oaccgd.php`;
const AJAX = `${BASE}/controller/CJKV/get_ziyuan_images_aw.php`;
const UA = 'Mozilla/5.0 (compatible; ancient-char-lookup/0.1; +https://github.com/)';

async function timedFetch(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

async function fetchPage(char: string, era: Era, timeoutMs: number): Promise<{ a: string; t: string; i: string } | null> {
  const url = `${PAGE}?cjkv=${encodeURIComponent(char)}&type=${era}`;
  const res = await timedFetch(url, { headers: { 'User-Agent': UA } }, timeoutMs);
  if (!res.ok) return null;
  const html = await res.text();
  const $ = cheerio.load(html);
  // 取与当前 era 对应的那个 zlist（页面上有多个 tab，每个 tab 一个 zlist）
  // 简化：取第一个含 span.t 文本 == era 的
  let found: { a: string; t: string; i: string } | null = null;
  $('div.zlist').each((_, el) => {
    const a = $(el).find('span.a').text().trim();
    const t = $(el).find('span.t').text().trim();
    const i = $(el).find('span.i').text().trim();
    if (t === era && a) {
      found = { a, t, i };
      return false;
    }
  });
  return found;
}

// 把 http://ccamc.org/... 包成 /api/img?u=... 走 HTTPS 代理（避免 Vercel HTTPS 页面里的 mixed-content 拦截）
function proxify(url: string): string {
  return `/api/img?u=${encodeURIComponent(url)}`;
}

async function fetchImages(token: { a: string; t: string; i: string }, timeoutMs: number): Promise<string[]> {
  const body = new URLSearchParams();
  body.set('a', token.a);
  body.set('t', token.t);
  body.set('i', token.i);
  const res = await timedFetch(AJAX, {
    method: 'POST',
    headers: {
      'User-Agent': UA,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Referer': PAGE,
    },
    body: body.toString(),
  }, timeoutMs);
  if (!res.ok) return [];
  const html = await res.text();
  const $ = cheerio.load(html);
  const urls: string[] = [];
  $('img.charImg').each((_, el) => {
    const src = $(el).attr('src');
    if (!src) return;
    const abs = src.startsWith('http') ? src : `${BASE}/${src.replace(/^\/+/, '')}`;
    urls.push(proxify(abs));
  });
  return urls;
}

export async function fetchEra(char: string, era: Era, timeoutMs = 4000): Promise<string[]> {
  try {
    const tok = await fetchPage(char, era, timeoutMs);
    if (!tok) return [];
    return await fetchImages(tok, timeoutMs);
  } catch {
    return [];
  }
}

export type CharImages = { char: string; eras: Record<Era, string[]> };

export async function fetchCharAllEras(char: string, perEraTimeoutMs = 4000): Promise<CharImages> {
  const results = await Promise.all(ERAS.map((e) => fetchEra(char, e, perEraTimeoutMs)));
  const eras: Record<Era, string[]> = { oracle: [], bronze: [], chujian: [], qinjian: [] };
  ERAS.forEach((e, i) => { eras[e] = results[i]; });
  return { char, eras };
}
