'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Entry } from '@/lib/parser';
import { buildRefLinks } from '@/lib/links';
import { ERAS, ERA_LABEL, type Era, type EraStatus } from '@/lib/ccamc';
import { renderHTML } from '@/lib/generator';
import { renderNavHTML } from '@/lib/nav-generator';
import { HERO_IMGS, HERO_CHAR } from '@/lib/heroImgs';

type Phase = 'idle' | 'parsing' | 'matching' | 'done' | 'error';
type Mode = 'images' | 'nav';

const MAX_CHARS_IMAGES = 200;
const MAX_CHARS_NAV = 2000;
const BATCH = 8;

const EXAMPLE_TEXT = `令\n鬼\n龍\n俯（頫）\n爽（奭）`;

type ApiCharResult = {
  char: string;
  hitChar: string;
  eras: Record<Era, string[]>;
  eraStatus: Record<Era, EraStatus>;
  fromCache?: boolean;
};

type DisplayRow = {
  entry: Entry;
  hitChar: string;
  fromCache: boolean;
  eras: Record<Era, { url: string | null; status: EraStatus }>;
};

export default function Home() {
  const [text, setText] = useState(EXAMPLE_TEXT);
  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>('images');
  const [actualMode, setActualMode] = useState<Mode>('images');
  const [degradedReason, setDegradedReason] = useState<string | null>(null);
  const [rows, setRows] = useState<DisplayRow[] | null>(null);
  const [navEntries, setNavEntries] = useState<Entry[] | null>(null);
  const [stats, setStats] = useState<{
    total: number; eraHit: Record<Era, number>;
    captchaCount: number; cacheHits: number; notInDb: number;
  } | null>(null);
  const [serverHealth, setServerHealth] = useState<{ antiBotActive: boolean; cacheHits: number; memSize: number } | null>(null);
  const [heroIdx, setHeroIdx] = useState(0); // 0..4，0=现代字
  const fileRef = useRef<HTMLInputElement>(null);

  // Hero 4 时代演化循环：现代 → 甲骨 → 金文 → 战国 → 篆书 → 现代
  useEffect(() => {
    const t = setInterval(() => setHeroIdx((i) => (i + 1) % 5), 1800);
    return () => clearInterval(t);
  }, []);

  // 拉一次服务端健康状态（用来在顶部显示状态徽章）
  useEffect(() => {
    let alive = true;
    fetch('/api/match')
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return;
        setServerHealth({
          antiBotActive: !!d.health?.antiBotActive,
          cacheHits: d.health?.totalCacheHits ?? 0,
          memSize: d.cache?.memSize ?? 0,
        });
      })
      .catch(() => { /* 静默 */ });
    return () => { alive = false; };
  }, []);

  const onFile = useCallback(async (f: File) => {
    setText('');
    const ext = f.name.toLowerCase().split('.').pop();
    if (ext === 'txt') {
      setText(await f.text());
      return;
    }
    if (ext !== 'docx') {
      setErrMsg('仅支持 .docx 或 .txt');
      setPhase('error');
      return;
    }
    try {
      setPhase('parsing');
      const fd = new FormData();
      fd.set('file', f);
      const r = await fetch('/api/parse', { method: 'POST', body: fd });
      const d = await r.json();
      if (!r.ok || d.error) throw new Error(d.error || 'parse failed');
      const es: Entry[] = d.entries;
      setText(es.map((e) => e.main + (e.variants.length ? `（${e.variants.join('')}）` : '')).join('\n'));
      setPhase('idle');
    } catch (e) {
      setErrMsg(String((e as Error).message || e));
      setPhase('error');
    }
  }, []);

  const onDrop = useCallback((e: React.DragEvent<HTMLElement>) => {
    e.preventDefault();
    const f = e.dataTransfer.files?.[0];
    if (f) onFile(f);
  }, [onFile]);

  const handleGenerate = useCallback(async () => {
    setErrMsg(null);
    setRows(null);
    setNavEntries(null);
    setStats(null);
    setDegradedReason(null);
    setProgress({ done: 0, total: 0 });

    try {
      // 1. parse
      setPhase('parsing');
      const r = await fetch('/api/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      const d = await r.json();
      if (!r.ok || d.error) throw new Error(d.error || 'parse failed');
      const entries: Entry[] = d.entries;
      if (entries.length === 0) {
        setPhase('error'); setErrMsg('未识别到任何汉字'); return;
      }
      const limit = mode === 'images' ? MAX_CHARS_IMAGES : MAX_CHARS_NAV;
      if (entries.length > limit) {
        setPhase('error');
        setErrMsg(
          mode === 'images'
            ? `字数超过 ${limit}（当前 ${entries.length}）。可切到「导航表」模式查最多 ${MAX_CHARS_NAV} 字，或用本地 CLI 处理大批量。`
            : `字数超过 ${limit}（当前 ${entries.length}），请用本地 CLI`
        );
        return;
      }

      if (mode === 'nav') {
        setActualMode('nav');
        setNavEntries(entries);
        setStats({ total: entries.length, eraHit: { oracle: 0, bronze: 0, chujian: 0, qinjian: 0 }, captchaCount: 0, cacheHits: 0, notInDb: 0 });
        setPhase('done');
        return;
      }

      // 2. 抓图
      const uniq: string[] = [];
      const seen = new Set<string>();
      for (const e of entries) {
        for (const c of [e.main, ...e.variants]) {
          if (!seen.has(c)) { seen.add(c); uniq.push(c); }
        }
      }

      setPhase('matching');
      setProgress({ done: 0, total: uniq.length });
      const byChar = new Map<string, ApiCharResult>();
      let cacheHits = 0;
      let captchaCount = 0;
      let degradedFromServer = false;
      let degradeReason: string | null = null;

      for (let i = 0; i < uniq.length; i += BATCH) {
        const batch = uniq.slice(i, i + BATCH);
        const r2 = await fetch('/api/match', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chars: batch }),
        });
        const d2 = await r2.json();
        if (!r2.ok || d2.error) throw new Error(d2.error || 'match failed');

        for (const item of d2.results as ApiCharResult[]) {
          byChar.set(item.char, item);
          if (item.fromCache) cacheHits++;
        }
        if (typeof d2.stats?.captchaCount === 'number') captchaCount += d2.stats.captchaCount;

        if (d2.degraded) {
          degradedFromServer = true;
          degradeReason = d2.reason || 'degraded';
          break;
        }
        setProgress({ done: Math.min(i + BATCH, uniq.length), total: uniq.length });
      }

      // 3. 装配每个 entry → DisplayRow
      const out: DisplayRow[] = entries.map((entry) => {
        // 候选字：主字 + 异体字
        const candidates = [entry.main, ...entry.variants];
        const eras: Record<Era, { url: string | null; status: EraStatus }> = {
          oracle: { url: null, status: 'error' },
          bronze: { url: null, status: 'error' },
          chujian: { url: null, status: 'error' },
          qinjian: { url: null, status: 'error' },
        };
        let hitChar = entry.main;
        let fromCache = false;

        for (const era of ERAS) {
          for (const c of candidates) {
            const r = byChar.get(c);
            if (!r) continue;
            const list = r.eras[era];
            if (list && list.length > 0) {
              eras[era] = { url: list[0]!, status: 'ok' };
              hitChar = r.hitChar;
              if (r.fromCache) fromCache = true;
              break;
            }
            // 没图但状态是 captcha/empty/error，记下来（先不 break，可能后续候选字 ok）
            if (eras[era].status === 'error') {
              eras[era] = { url: null, status: r.eraStatus[era] || 'error' };
            }
          }
        }
        return { entry, hitChar, fromCache, eras };
      });

      // 4. 决策：是否降级到导航表
      const fetched = Array.from(byChar.values());
      const anyOkCount = fetched.filter((r) =>
        ERAS.some((e) => (r.eras[e]?.length ?? 0) > 0)
      ).length;
      const okRate = fetched.length > 0 ? anyOkCount / fetched.length : 0;
      const shouldDegrade = degradedFromServer || (fetched.length >= 5 && okRate < 0.3);

      if (shouldDegrade) {
        setActualMode('nav');
        const friendlyReason =
          degradeReason === 'anti_bot_active' ? '数据源暂时不可用'
          : degradeReason === 'captcha_in_batch' ? '数据源响应异常'
          : okRate < 0.3 ? `命中率仅 ${(okRate * 100).toFixed(0)}%`
          : '服务端切换';
        setDegradedReason(friendlyReason);
        setNavEntries(entries);
        setStats({ total: entries.length, eraHit: { oracle: 0, bronze: 0, chujian: 0, qinjian: 0 }, captchaCount, cacheHits, notInDb: 0 });
        setPhase('done');
        return;
      }

      setActualMode('images');
      // 统计
      const eraHit: Record<Era, number> = { oracle: 0, bronze: 0, chujian: 0, qinjian: 0 };
      let notInDb = 0;
      for (const row of out) {
        let allEmptyOrError = true;
        for (const era of ERAS) {
          if (row.eras[era].status === 'ok') {
            eraHit[era]++;
            allEmptyOrError = false;
          } else if (row.eras[era].status === 'captcha') {
            allEmptyOrError = false;
          }
        }
        if (allEmptyOrError) notInDb++;
      }
      setRows(out);
      setStats({ total: entries.length, eraHit, captchaCount, cacheHits, notInDb });
      setPhase('done');
    } catch (e) {
      setErrMsg(String((e as Error).message || e));
      setPhase('error');
    }
  }, [text, mode]);

  // 下载/打印 → 复用 cli generator（image 模式）或 nav generator
  const buildHtmlForExport = useCallback((): string => {
    if (actualMode === 'nav' && navEntries) return renderNavHTML(navEntries);
    if (actualMode === 'images' && rows) {
      const matches = rows.map((r) => ({
        entry: r.entry,
        images: {
          oracle: r.eras.oracle.url,
          bronze: r.eras.bronze.url,
          chujian: r.eras.chujian.url,
          qinjian: r.eras.qinjian.url,
        },
      }));
      const eraHits: Record<Era, number> = { oracle: 0, bronze: 0, chujian: 0, qinjian: 0 };
      let anyHit = 0, allMiss = 0;
      for (const m of matches) {
        let any = false;
        for (const e of ERAS) { if (m.images[e]) { eraHits[e]++; any = true; } }
        if (any) anyHit++; else allMiss++;
      }
      return renderHTML(matches, { total: matches.length, anyHit, allMiss, eraHits });
    }
    return '<!doctype html><html><body>未生成内容</body></html>';
  }, [actualMode, navEntries, rows]);

  const downloadHtml = useCallback(() => {
    const html = buildHtmlForExport();
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = actualMode === 'images' ? '古文字對照表.html' : '古文字字源導航表.html';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, [actualMode, buildHtmlForExport]);

  const printHtml = useCallback(() => {
    const html = buildHtmlForExport();
    const w = window.open('', '_blank');
    if (!w) return;
    w.document.write(html);
    w.document.close();
    setTimeout(() => w.print(), 800);
  }, [buildHtmlForExport]);

  const busy = phase === 'parsing' || phase === 'matching';
  const hero = HERO_IMGS;

  // 5 段演化带的固定标签
  const ERA_LABELS = ['甲骨', '金文', '战国', '小篆', '楷书'] as const;

  return (
    <main className="min-h-screen relative overflow-hidden">
      <div className="max-w-5xl mx-auto px-6 lg:px-8 py-8 relative">

        {/* 顶栏：印章 logo + 工具名（中英） + 状态徽章 */}
        <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <span className="seal" aria-label="印章 logo">字</span>
            <div>
              <div className="font-display text-[17px] font-bold leading-tight" style={{ color: 'var(--ink)' }}>古文字对照表</div>
              <div className="font-mono text-[10px] tracking-widest" style={{ color: 'var(--ink-muted)' }}>ancient char lookup</div>
            </div>
          </div>
          <ServerStatusPill health={serverHealth} />
        </div>

        {/* 演化带（≤120px） */}
        <section className="mb-8">
          <div className="evo-strip">
            {hero.map((h, i) => (
              <div
                key={h.era}
                className="evo-cell"
                style={{
                  outline: heroIdx === i ? '1.5px solid var(--vermilion)' : 'none',
                  outlineOffset: 1,
                  transition: 'outline 0.4s ease',
                }}
              >
                <img src={h.src} alt={ERA_LABELS[i]} />
              </div>
            ))}
            <div
              className="evo-cell modern"
              style={{
                outline: heroIdx === 4 ? '1.5px solid var(--vermilion)' : 'none',
                outlineOffset: 1,
                transition: 'outline 0.4s ease',
              }}
            >
              {HERO_CHAR}
            </div>
          </div>
          <div className="evo-strip mt-2">
            {ERA_LABELS.map((label, i) => (
              <div key={i} className={`evo-label ${heroIdx === i ? 'active' : ''}`}>{label}</div>
            ))}
          </div>
        </section>

        {/* 输入区 */}
        <section className="mb-10">
          <textarea
            className="field-input min-h-[160px]"
            placeholder={`粘贴汉字…\n每行一个。括号内为异体字，会一并查找`}
            value={text}
            onChange={(e) => setText(e.target.value)}
            spellCheck={false}
            disabled={busy}
            onDragOver={(e) => e.preventDefault()}
            onDrop={onDrop}
          />

          <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs">
            <input
              ref={fileRef} type="file" accept=".docx,.txt" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }}
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="font-mono hover:underline"
              style={{ color: 'var(--vermilion)' }}
            >
              ↑ 上传 .docx/.txt
            </button>
            <button
              onClick={() => setText(EXAMPLE_TEXT)}
              className="font-mono hover:underline"
              style={{ color: 'var(--ink-soft)' }}
              disabled={busy}
            >
              填入示例
            </button>
            <span className="font-mono ml-auto" style={{ color: 'var(--ink-muted)' }}>OUTPUT</span>
            <label className="flex items-center gap-1.5 cursor-pointer" style={{ color: 'var(--ink-soft)' }}>
              <input type="radio" name="mode" value="images" checked={mode === 'images'} onChange={() => setMode('images')} disabled={busy} />
              <span>对照表</span>
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer" style={{ color: 'var(--ink-soft)' }}>
              <input type="radio" name="mode" value="nav" checked={mode === 'nav'} onChange={() => setMode('nav')} disabled={busy} />
              <span>字源链接</span>
            </label>
          </div>

          <div className="mt-5 flex items-center gap-3 flex-wrap">
            <button
              onClick={handleGenerate}
              disabled={busy || !text.trim()}
              className="btn-primary"
            >
              {phase === 'parsing'
                ? '解析中…'
                : phase === 'matching'
                ? `匹配 ${progress.done}/${progress.total}`
                : mode === 'images'
                ? '生成对照表 →'
                : '生成链接表 →'}
            </button>
            <span className="font-mono text-[11px]" style={{ color: 'var(--ink-muted)' }}>
              上限 {mode === 'images' ? '200' : '2000'} 字 · 更多请用 <a href="https://github.com/carpediemzzsssww-cpu/ancient-char-lookup" target="_blank" rel="noopener" style={{ color: 'var(--vermilion)' }}>本地 CLI</a>（99.6% 命中）
            </span>
          </div>

          {phase === 'matching' && (
            <div className="mt-3 h-1 w-full rounded-full overflow-hidden" style={{ background: 'var(--rule-light)' }}>
              <div
                className="h-full transition-all"
                style={{ width: `${(100 * progress.done) / Math.max(1, progress.total)}%`, background: 'var(--vermilion)' }}
              />
            </div>
          )}

          {phase === 'error' && errMsg && (
            <div className="mt-4 hint-card warn">{errMsg}</div>
          )}
        </section>

        {/* 结果区 */}
        {phase === 'done' && stats && (
          <section className="fade-in">
            {degradedReason && (
              <div className="hint-card warn mb-4">
                <strong>已切到字源链接模式</strong>（{degradedReason}）· 完整对照表请用 <a href="https://github.com/carpediemzzsssww-cpu/ancient-char-lookup" target="_blank" rel="noopener" style={{ color: 'var(--vermilion)' }}>本地 CLI</a>（99.6% 命中）
              </div>
            )}

            {/* 统计带 */}
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm mb-5" style={{ color: 'var(--ink-soft)' }}>
              <span>共 <strong style={{ color: 'var(--ink)' }}>{stats.total}</strong> 字</span>
              {actualMode === 'images' && (
                <>
                  <span className="font-mono text-xs" style={{ color: 'var(--ink-muted)' }}>
                    甲骨 {stats.eraHit.oracle} · 金文 {stats.eraHit.bronze} · 战国 {stats.eraHit.chujian} · 篆书 {stats.eraHit.qinjian}
                  </span>
                  {stats.notInDb > 0 && (
                    <span className="font-mono text-xs" style={{ color: 'var(--vermilion)' }}>
                      ccamc 无此字 {stats.notInDb}
                    </span>
                  )}
                  {stats.cacheHits > 0 && (
                    <span className="font-mono text-xs" style={{ color: 'var(--bronze)' }}>
                      缓存命中 {stats.cacheHits}
                    </span>
                  )}
                </>
              )}
              <div className="ml-auto flex gap-2">
                <button onClick={downloadHtml} className="btn-ghost">下载 HTML</button>
                <button onClick={printHtml} className="btn-ghost">打印 A4</button>
              </div>
            </div>

            {/* 对照表 */}
            {actualMode === 'images' && rows && (
              <div className="rounded-md overflow-hidden" style={{ border: '1px solid var(--rule)', background: 'var(--bone-soft)' }}>
                <table className="tbl-han">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>现代</th>
                      <th>甲骨</th>
                      <th>金文</th>
                      <th>战国</th>
                      <th>小篆</th>
                      <th>字源</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <tr key={i}>
                        <td className="col-num">{i + 1}</td>
                        <td className="col-modern">
                          {r.entry.main}
                          {r.entry.variants.length > 0 && (
                            <span className="variant">（{r.entry.variants.join('、')}）</span>
                          )}
                          {r.hitChar !== r.entry.main && (
                            <div className="hit-note">配字 {r.hitChar}</div>
                          )}
                          {r.fromCache && <span className="cache-badge">已缓存</span>}
                        </td>
                        {ERAS.map((era) => (
                          <td key={era} className="col-era">
                            <EraCell url={r.eras[era].url} status={r.eras[era].status} eraLabel={ERA_LABEL[era]} />
                          </td>
                        ))}
                        <td className="col-links">
                          {buildRefLinks(r.entry.main).map((l) => (
                            <a key={l.name} href={l.url} target="_blank" rel="noopener">{l.name}</a>
                          ))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* 导航表（降级 / 用户主选） */}
            {actualMode === 'nav' && navEntries && (
              <div className="rounded-md overflow-hidden" style={{ border: '1px solid var(--rule)', background: 'var(--bone-soft)' }}>
                <table className="tbl-han">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>现代</th>
                      <th>字源链接（4 个）</th>
                    </tr>
                  </thead>
                  <tbody>
                    {navEntries.map((e, i) => (
                      <tr key={i}>
                        <td className="col-num">{i + 1}</td>
                        <td className="col-modern">
                          {e.main}
                          {e.variants.length > 0 && <span className="variant">（{e.variants.join('、')}）</span>}
                        </td>
                        <td className="col-links">
                          {buildRefLinks(e.main).map((l) => (
                            <a key={l.name} href={l.url} target="_blank" rel="noopener">{l.name}</a>
                          ))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* 状态图例 */}
            {actualMode === 'images' && rows && (
              <div className="mt-4 hint-card text-xs">
                空格的几种含义：
                <span className="cell-miss-empty mx-2">· 无</span>这个时代没有此字的拓本（古文字本就只有一部分流传）
                <span className="cell-miss-captcha mx-2">⏳ 稍候</span>数据源暂时不可用，几小时后会恢复
                <span className="cell-miss-error mx-2">✕ 失败</span>网络异常 · 完整对照请用 <a href="https://github.com/carpediemzzsssww-cpu/ancient-char-lookup" target="_blank" rel="noopener" style={{ color: 'var(--vermilion)' }}>本地 CLI</a>
              </div>
            )}
          </section>
        )}

        <footer className="mt-16 pt-6 text-xs flex flex-wrap items-center justify-between gap-3" style={{ borderTop: '1px solid var(--rule)', color: 'var(--ink-muted)' }}>
          <div>
            数据：
            <a className="ml-1 hover:underline" style={{ color: 'var(--ink-soft)' }} href="http://ccamc.org" target="_blank" rel="noopener">ccamc.org</a> ·
            <a className="ml-1 hover:underline" style={{ color: 'var(--ink-soft)' }} href="https://zi.tools" target="_blank" rel="noopener">zi.tools</a> ·
            <a className="ml-1 hover:underline" style={{ color: 'var(--ink-soft)' }} href="https://xiaoxue.iis.sinica.edu.tw" target="_blank" rel="noopener">小学堂</a> ·
            <a className="ml-1 hover:underline" style={{ color: 'var(--ink-soft)' }} href="https://github.com/RomanticGodVAN/character-Evolution-Dataset" target="_blank" rel="noopener">EVOBC</a>
          </div>
          <div className="font-mono">
            <a className="hover:underline" style={{ color: 'var(--vermilion)' }} href="https://github.com/carpediemzzsssww-cpu/ancient-char-lookup" target="_blank" rel="noopener">GitHub →</a>
            <span className="mx-2" style={{ color: 'var(--ink-faint)' }}>·</span>
            MIT
          </div>
        </footer>
      </div>
    </main>
  );
}

function ServerStatusPill({ health }: { health: { antiBotActive: boolean; cacheHits: number; memSize: number } | null }) {
  if (!health) {
    return (
      <span className="status-pill status-checking">
        <span className="dot" />
        <span>检测中…</span>
      </span>
    );
  }
  if (health.antiBotActive) {
    return (
      <span className="status-pill status-degraded" title="数据源暂时不可用，已自动切到字源链接模式">
        <span className="dot" />
        <span>数据源不稳 · 自动降级</span>
      </span>
    );
  }
  return (
    <span className="status-pill status-ok" title={`已缓存 ${health.memSize} 字 · 命中 ${health.cacheHits} 次`}>
      <span className="dot" />
      <span>运行中 · 已缓存 {health.memSize}</span>
    </span>
  );
}

function EraCell({ url, status, eraLabel }: { url: string | null; status: EraStatus; eraLabel: string }) {
  if (status === 'ok' && url) {
    return <img src={url} alt={eraLabel} loading="lazy" />;
  }
  if (status === 'captcha') {
    return <span className="cell-miss-captcha" title="数据源暂时不可用，几小时后会恢复">⏳ 稍候</span>;
  }
  if (status === 'error') {
    return <span className="cell-miss-error" title="网络异常">✕ 失败</span>;
  }
  // empty
  return <span className="cell-miss-empty" title="该时代无此字的拓本（古文字本就只有一部分流传）">· 无</span>;
}
