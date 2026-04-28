import * as cheerio from 'cheerio';
import * as OpenCC from 'opencc-js';

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

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.7',
  'Cache-Control': 'no-cache',
};

const CAPTCHA_HINTS = ['驗證碼', '验证码', 'captcha_verify.php', 'captcha_image'];
const MIN_REAL_SIZE = 5000;

/**
 * 每个 era 的查询结果细分：
 *  - ok      此 era 抓到 ≥1 张图（urls 非空）
 *  - empty   ccamc 主页正常返回但此 era 无字形数据（ccamc 没收录此字此时代）
 *  - captcha 此 era 接口被反爬（短期，~24h 自动恢复）
 *  - error   网络错误 / HTTP 错误
 */
export type EraStatus = 'ok' | 'empty' | 'captcha' | 'error';

export type FetchOutcome =
  | { kind: 'ok'; urls: string[] }
  | { kind: 'captcha'; htmlSize: number }
  | { kind: 'empty' }
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

export async function fetchEra(char: string, era: Era, timeoutMs = 4000): Promise<string[]> {
  const r = await fetchEraDetailed(char, era, timeoutMs);
  return r.kind === 'ok' ? r.urls : [];
}

function outcomeToStatus(o: FetchOutcome): EraStatus {
  if (o.kind === 'ok') return o.urls.length > 0 ? 'ok' : 'empty';
  if (o.kind === 'captcha') return 'captcha';
  if (o.kind === 'empty') return 'empty';
  return 'error';
}

export type CharImages = {
  char: string;            // 用户输入的原字
  hitChar: string;         // 实际拿到数据的字（可能是简繁转换后的）
  eras: Record<Era, string[]>;
  eraStatus: Record<Era, EraStatus>;
  captchaDetected?: boolean;
};

// opencc 转换器（懒加载缓存）
let s2t: ((s: string) => string) | null = null;
let t2s: ((s: string) => string) | null = null;
function getConverters() {
  if (!s2t) s2t = OpenCC.Converter({ from: 'cn', to: 'tw' });
  if (!t2s) t2s = OpenCC.Converter({ from: 'tw', to: 'cn' });
  return { s2t: s2t!, t2s: t2s! };
}

async function fetchOnce(char: string, perEraTimeoutMs: number): Promise<{ eras: Record<Era, string[]>; eraStatus: Record<Era, EraStatus>; anyOk: boolean; anyCaptcha: boolean }> {
  const results = await Promise.all(ERAS.map((e) => fetchEraDetailed(char, e, perEraTimeoutMs)));
  const eras: Record<Era, string[]> = { oracle: [], bronze: [], chujian: [], qinjian: [] };
  const eraStatus: Record<Era, EraStatus> = { oracle: 'error', bronze: 'error', chujian: 'error', qinjian: 'error' };
  let anyOk = false, anyCaptcha = false;
  ERAS.forEach((e, i) => {
    const r = results[i];
    if (!r) return;
    const st = outcomeToStatus(r);
    eraStatus[e] = st;
    if (r.kind === 'ok') eras[e] = r.urls;
    if (st === 'ok') anyOk = true;
    if (st === 'captcha') anyCaptcha = true;
  });
  return { eras, eraStatus, anyOk, anyCaptcha };
}

/**
 * 抓单字 4 时代图片，含简↔繁回退。
 *
 * 决策：
 * 1. 直接查 char。如果有任意 era ok 或 captcha → 用此结果（captcha 是临时，不做回退）
 * 2. 否则 char 全 empty/error → 尝试简↔繁转换后的另一种写法
 *    - 转换后 ok 命中 → 用转换字结果，hitChar 标记为转换字
 *    - 仍 miss → 返回原字结果（全 empty）
 */
export async function fetchCharAllEras(char: string, perEraTimeoutMs = 4000): Promise<CharImages> {
  // 尝试 1：直接
  const direct = await fetchOnce(char, perEraTimeoutMs);
  if (direct.anyOk || direct.anyCaptcha) {
    return {
      char,
      hitChar: char,
      eras: direct.eras,
      eraStatus: direct.eraStatus,
      captchaDetected: direct.anyCaptcha,
    };
  }

  // 尝试 2：简↔繁回退
  const { s2t, t2s } = getConverters();
  const candidates = new Set<string>();
  candidates.add(s2t(char));
  candidates.add(t2s(char));
  candidates.delete(char); // 跳过和原字一样的

  for (const alt of candidates) {
    const r = await fetchOnce(alt, perEraTimeoutMs);
    if (r.anyOk) {
      return {
        char,
        hitChar: alt,
        eras: r.eras,
        eraStatus: r.eraStatus,
        captchaDetected: r.anyCaptcha,
      };
    }
  }

  // 都 miss → 返回直接查的结果（全 empty）
  return {
    char,
    hitChar: char,
    eras: direct.eras,
    eraStatus: direct.eraStatus,
    captchaDetected: false,
  };
}
