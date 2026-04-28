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

// 浏览器风格 UA + Accept-Language 友好化（默认 axios/fetch UA 一眼机器人，触发反爬概率高）
const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.7',
  'Cache-Control': 'no-cache',
};

// 反爬触发的指纹：响应过小 或 含验证码字样
const CAPTCHA_HINTS = ['驗證碼', '验证码', 'captcha_verify.php', 'captcha_image'];
const MIN_REAL_SIZE = 5000; // 真实主页 ~28KB；验证码页 ~2KB

export type FetchOutcome =
  | { kind: 'ok'; urls: string[] }
  | { kind: 'captcha'; htmlSize: number }
  | { kind: 'empty' } // 200 但既非 captcha 也无 zlist 也无 charImg（数据缺失）
  | { kind: 'http_error'; status: number }
  | { kind: 'network_error'; message: string };

function detectCaptcha(html: string): boolean {
  if (html.length < MIN_REAL_SIZE) return true;
  return CAPTCHA_HINTS.some((s) => html.includes(s));
}

async function timedFetch(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

type PageResult =
  | { kind: 'token'; a: string; t: string; i: string }
  | { kind: 'captcha'; htmlSize: number }
  | { kind: 'empty' }
  | { kind: 'http_error'; status: number };

async function fetchPage(char: string, era: Era, timeoutMs: number): Promise<PageResult> {
  const url = `${PAGE}?cjkv=${encodeURIComponent(char)}&type=${era}`;
  const res = await timedFetch(url, { headers: BROWSER_HEADERS }, timeoutMs);
  if (!res.ok) return { kind: 'http_error', status: res.status };
  const html = await res.text();
  if (detectCaptcha(html)) return { kind: 'captcha', htmlSize: html.length };

  const $ = cheerio.load(html);
  let foundA = '', foundT = '', foundI = '';
  let hit = false;
  $('div.zlist').each((_, el) => {
    const a = $(el).find('span.a').text().trim();
    const t = $(el).find('span.t').text().trim();
    const i = $(el).find('span.i').text().trim();
    if (t === era && a) {
      foundA = a; foundT = t; foundI = i;
      hit = true;
      return false;
    }
  });
  if (!hit) return { kind: 'empty' };
  return { kind: 'token', a: foundA, t: foundT, i: foundI };
}

// 把 http://ccamc.org/... 包成 /api/img?u=... 走 HTTPS 代理
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
      ...BROWSER_HEADERS,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Referer': PAGE,
      'X-Requested-With': 'XMLHttpRequest',
    },
    body: body.toString(),
  }, timeoutMs);
  if (!res.ok) return [];
  const html = await res.text();
  if (detectCaptcha(html)) return [];
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

/**
 * 抓取单个字 + 单个时代。返回详细结果（用于上层判断是否触发反爬降级）。
 */
export async function fetchEraDetailed(char: string, era: Era, timeoutMs = 4000): Promise<FetchOutcome> {
  try {
    const page = await fetchPage(char, era, timeoutMs);
    if (page.kind === 'captcha') return page;
    if (page.kind === 'http_error') return page;
    if (page.kind === 'empty') return { kind: 'empty' };
    const urls = await fetchImages(page, timeoutMs);
    return { kind: 'ok', urls };
  } catch (e) {
    return { kind: 'network_error', message: String((e as Error).message || e) };
  }
}

/** 兼容旧调用方 */
export async function fetchEra(char: string, era: Era, timeoutMs = 4000): Promise<string[]> {
  const r = await fetchEraDetailed(char, era, timeoutMs);
  return r.kind === 'ok' ? r.urls : [];
}

export type CharImages = {
  char: string;
  eras: Record<Era, string[]>;
  /** 任一 era 命中 captcha 时为 true（提示上层考虑降级） */
  captchaDetected?: boolean;
};

export async function fetchCharAllEras(char: string, perEraTimeoutMs = 4000): Promise<CharImages> {
  const results = await Promise.all(ERAS.map((e) => fetchEraDetailed(char, e, perEraTimeoutMs)));
  const eras: Record<Era, string[]> = { oracle: [], bronze: [], chujian: [], qinjian: [] };
  let captchaDetected = false;
  ERAS.forEach((e, i) => {
    const r = results[i];
    if (r && r.kind === 'ok') eras[e] = r.urls;
    if (r && r.kind === 'captcha') captchaDetected = true;
  });
  return { char, eras, captchaDetected };
}
