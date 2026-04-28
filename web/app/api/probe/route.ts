import { NextRequest, NextResponse } from 'next/server';
import { fetchEraDetailed, ERAS, type Era } from '@/lib/ccamc';
import { healthSnapshot } from '@/lib/health';
import { cacheStats } from '@/lib/cache';

export const runtime = 'nodejs';
export const maxDuration = 10;

type EraOutcome = {
  era: Era;
  kind: string;
  count?: number;
  htmlSize?: number;
  status?: number;
  message?: string;
};

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const char = url.searchParams.get('char') || '令';
  const outcomes: EraOutcome[] = [];

  await Promise.all(
    ERAS.map(async (e) => {
      const r = await fetchEraDetailed(char, e, 4000);
      if (r.kind === 'ok') outcomes.push({ era: e, kind: 'ok', count: r.urls.length });
      else if (r.kind === 'captcha') outcomes.push({ era: e, kind: 'captcha', htmlSize: r.htmlSize });
      else if (r.kind === 'http_error') outcomes.push({ era: e, kind: 'http_error', status: r.status });
      else if (r.kind === 'empty') outcomes.push({ era: e, kind: 'empty' });
      else outcomes.push({ era: e, kind: 'network_error', message: r.message });
    })
  );

  const ok = outcomes.some((o) => o.kind === 'ok' && (o.count ?? 0) > 0);
  const captchaSeen = outcomes.some((o) => o.kind === 'captcha');

  return NextResponse.json({
    ok,
    char,
    outcomes,
    captchaSeen,
    region: process.env.VERCEL_REGION || 'local',
    health: healthSnapshot(),
    cache: cacheStats(),
    ts: new Date().toISOString(),
  });
}
