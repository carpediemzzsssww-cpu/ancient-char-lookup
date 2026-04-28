import { NextRequest, NextResponse } from 'next/server';
import { fetchCharAllEras, ERAS, type Era, type EraStatus } from '@/lib/ccamc';
import { getCachedChar, setCachedChar, cacheStats } from '@/lib/cache';
import { withSingleflight } from '@/lib/throttle';
import { recordRequest, recordCacheHit, isAntiBotActive, healthSnapshot } from '@/lib/health';

export const runtime = 'nodejs';
export const maxDuration = 10;

const BATCH_LIMIT = 8;
const PER_ERA_TIMEOUT = 3500;

type CharResult = {
  char: string;
  hitChar: string;
  eras: Record<Era, string[]>;
  eraStatus: Record<Era, EraStatus>;
  fromCache?: boolean;
};

function emptyEras(): Record<Era, string[]> {
  return { oracle: [], bronze: [], chujian: [], qinjian: [] };
}
function unknownStatus(): Record<Era, EraStatus> {
  return { oracle: 'error', bronze: 'error', chujian: 'error', qinjian: 'error' };
}

export async function POST(req: NextRequest) {
  try {
    const { chars } = await req.json();
    if (!Array.isArray(chars)) return NextResponse.json({ error: 'chars 必须是数组' }, { status: 400 });
    const list: string[] = chars.slice(0, BATCH_LIMIT).map(String);

    if (isAntiBotActive()) {
      return NextResponse.json({
        results: list.map((c) => ({
          char: c, hitChar: c, eras: emptyEras(),
          eraStatus: { oracle: 'captcha' as EraStatus, bronze: 'captcha' as EraStatus, chujian: 'captcha' as EraStatus, qinjian: 'captcha' as EraStatus },
        })),
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

        const cached = await getCachedChar(ch);
        if (cached) {
          recordCacheHit();
          out[i] = { char: ch, hitChar: cached.hitChar, eras: cached.eras, eraStatus: cached.eraStatus, fromCache: true };
          continue;
        }

        const result = await withSingleflight(`fetch:${ch}`, () =>
          fetchCharAllEras(ch, PER_ERA_TIMEOUT)
        );

        if (result.captchaDetected) {
          recordRequest('captcha');
          captchaCount++;
        } else {
          const hasAny = Object.values(result.eras).some((v) => v.length > 0);
          recordRequest(hasAny ? 'ok' : 'empty');
          if (hasAny) {
            await setCachedChar(ch, {
              hitChar: result.hitChar,
              eras: result.eras,
              eraStatus: result.eraStatus,
            });
          }
        }

        out[i] = {
          char: ch,
          hitChar: result.hitChar,
          eras: result.eras,
          eraStatus: result.eraStatus,
        };
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

export async function GET() {
  return NextResponse.json({ health: healthSnapshot(), cache: cacheStats() });
}

// 帮 Vercel 静默兜底；防止未使用 import 警告（unknownStatus 留作未来扩展）
void unknownStatus;
