import type { Entry } from './parser';
import { ERAS, type Era } from './ccamc';
import { renderHTML, type MatchResult, type Stats } from './generator';

export type CharResult = { char: string; eras: Record<Era, string[]> };

// 把 entry + 抓到的 URL 字典装配成 MatchResult
// 主字 miss 时尝试异体字（取第一个有图的）
export function assembleMatches(entries: Entry[], byChar: Map<string, CharResult>): MatchResult[] {
  return entries.map((entry) => {
    const candidates = [entry.main, ...entry.variants];
    const images: Record<Era, string | null> = { oracle: null, bronze: null, chujian: null, qinjian: null };
    for (const era of ERAS) {
      for (const c of candidates) {
        const list = byChar.get(c)?.eras?.[era];
        if (list && list.length > 0) {
          images[era] = list[0];
          break;
        }
      }
    }
    return { entry, images };
  });
}

export function computeStats(matches: MatchResult[]): Stats {
  const eraHits: Record<Era, number> = { oracle: 0, bronze: 0, chujian: 0, qinjian: 0 };
  let anyHit = 0;
  let allMiss = 0;
  for (const m of matches) {
    let any = false;
    for (const era of ERAS) {
      if (m.images[era]) { eraHits[era]++; any = true; }
    }
    if (any) anyHit++;
    else allMiss++;
  }
  return { total: matches.length, anyHit, allMiss, eraHits };
}

export { renderHTML };
