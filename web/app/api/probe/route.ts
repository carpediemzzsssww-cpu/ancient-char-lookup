import { NextRequest, NextResponse } from 'next/server';
import { fetchEra, ERAS, type Era } from '@/lib/ccamc';

export const runtime = 'nodejs';
export const maxDuration = 10;

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const char = url.searchParams.get('char') || '令';
  const counts: Record<Era, number> = { oracle: 0, bronze: 0, chujian: 0, qinjian: 0 };
  const errors: Record<string, string> = {};
  await Promise.all(
    ERAS.map(async (e) => {
      try {
        const urls = await fetchEra(char, e, 4000);
        counts[e] = urls.length;
      } catch (err) {
        errors[e] = String((err as Error).message || err);
      }
    })
  );
  const ok = Object.values(counts).some((n) => n > 0);
  return NextResponse.json({
    ok,
    char,
    counts,
    errors,
    region: process.env.VERCEL_REGION || 'local',
    ts: new Date().toISOString(),
  });
}
