import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 10;

const ALLOWED_HOSTS = new Set(['ccamc.org', 'www.ccamc.org']);

// 图片代理：把 ccamc.org 的 http 图片用 https 转出，避免 mixed-content 拦截
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const target = url.searchParams.get('u');
  if (!target) return new NextResponse('missing u', { status: 400 });

  let parsed: URL;
  try {
    parsed = new URL(target);
  } catch {
    return new NextResponse('bad url', { status: 400 });
  }
  if (!ALLOWED_HOSTS.has(parsed.hostname)) {
    return new NextResponse('host not allowed', { status: 400 });
  }

  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(parsed.toString(), {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'ancient-char-lookup/0.1' },
    });
    clearTimeout(t);
    if (!res.ok) return new NextResponse(`upstream ${res.status}`, { status: 502 });
    const ct = res.headers.get('content-type') || 'image/png';
    const buf = await res.arrayBuffer();
    return new NextResponse(buf, {
      status: 200,
      headers: {
        'Content-Type': ct,
        // 1 天浏览器缓存 + 7 天 CDN 缓存
        'Cache-Control': 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400',
      },
    });
  } catch (e) {
    return new NextResponse(`fetch error: ${(e as Error).message}`, { status: 502 });
  }
}
