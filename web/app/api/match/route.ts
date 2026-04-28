import { NextRequest, NextResponse } from 'next/server';
import { fetchCharAllEras, ERAS, type Era } from '@/lib/ccamc';
import { getCachedChar, setCachedChar, cacheStats } from '@/lib/cache';
import { withSingleflight } from '@/lib/throttle';
import { recordRequest, recordCacheHit, isAntiBotActive, healthSnapshot } from '@/lib/health';

export const runtime = 'nodejs';
export const maxDuration = 10;

const BATCH_LIMIT = 8;
const PER_ERA_TIMEOUT = 3500;

type CharResult = { char: string; eras: Record<Era, string[]>; fromCache?: boolean };

export async function POST(req: NextRequest) {
  try {
    const { chars } = await req.json();
    if (!Array.isArray(chars)) return NextResponse.json({ error: 'chars 必须是数组' }, { status: 400 });
    const list: string[] = chars.slice(0, BATCH_LIMIT).map(String);

    // 短路：如果当前实例在反爬窗口期，直接返回 degraded 信号，让前端走导航表模式
    if (isAntiBotActive()) {
      return NextResponse.json({
        results: list.map((c) => ({ char: c, eras: { oracle: [], bronze: [], chujian: [], qinjian: [] } })),
        eras: ERAS,
        degraded: true,
        reason: 'anti_bot_active',
      });
    }

    const out: CharResult[] = new Array(list.length);
    const concurrency = 3;
    let idx = 0;
    let captchaCount = 0;

    async function worker() {
      while (true) {
        const i = idx++;
        if (i >= list.length) return;
        const ch = list[i];
        if (!ch) continue;

        // 1) 缓存命中？
        const cached = await getCachedChar(ch);
        if (cached) {
          recordCacheHit();
          out[i] = { char: ch, eras: cached, fromCache: true };
          continue;
        }

        // 2) singleflight: 同字并发只打一次 ccamc
        const result = await withSingleflight(`fetch:${ch}`, () =>
          fetchCharAllEras(ch, PER_ERA_TIMEOUT)
        );

        // 3) 记录指标 + 写缓存
        if (result.captchaDetected) {
          recordRequest('captcha');
          captchaCount++;
        } else {
          const hasAny = Object.values(result.eras).some((v) => v.length > 0);
          recordRequest(hasAny ? 'ok' : 'empty');
          if (hasAny) await setCachedChar(ch, result.eras);
        }

        out[i] = { char: ch, eras: result.eras };
      }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, list.length) }, () => worker()));

    const degraded = captchaCount >= Math.ceil(list.length * 0.5);
    return NextResponse.json({
      results: out,
      eras: ERAS,
      degraded,
      reason: degraded ? 'captcha_in_batch' : undefined,
      stats: { ...cacheStats(), captchaCount },
    });
  } catch (e) {
    return NextResponse.json({ error: String((e as Error).message || e) }, { status: 500 });
  }
}

// GET 用于诊断：当前实例的健康指标
export async function GET() {
  return NextResponse.json({ health: healthSnapshot(), cache: cacheStats() });
}
