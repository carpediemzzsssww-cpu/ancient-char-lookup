import { NextRequest, NextResponse } from 'next/server';
import { fetchCharAllEras, ERAS, type Era } from '@/lib/ccamc';

export const runtime = 'nodejs';
export const maxDuration = 10;

const BATCH_LIMIT = 8;

export async function POST(req: NextRequest) {
  try {
    const { chars } = await req.json();
    if (!Array.isArray(chars)) return NextResponse.json({ error: 'chars 必须是数组' }, { status: 400 });
    const list: string[] = chars.slice(0, BATCH_LIMIT).map(String);

    // 字之间并发 3，每字内 4 era 并发
    const out: { char: string; eras: Record<Era, string[]> }[] = new Array(list.length);
    const concurrency = 3;
    let idx = 0;
    async function worker() {
      while (true) {
        const i = idx++;
        if (i >= list.length) return;
        out[i] = await fetchCharAllEras(list[i], 3500);
      }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, list.length) }, () => worker()));

    return NextResponse.json({ results: out, eras: ERAS });
  } catch (e) {
    return NextResponse.json({ error: String((e as Error).message || e) }, { status: 500 });
  }
}
