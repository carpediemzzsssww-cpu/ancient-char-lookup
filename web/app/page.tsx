'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Entry } from '@/lib/parser';
import { buildRefLinks } from '@/lib/links';
import { ERAS, ERA_LABEL, type Era, type EraStatus } from '@/lib/ccamc';
import { renderHTML } from '@/lib/generator';
import { renderNavHTML } from '@/lib/nav-generator';
import { HERO_IMGS } from '@/lib/heroImgs';

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

  const onDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
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
        setDegradedReason(degradeReason || (okRate < 0.3 ? `命中率仅 ${(okRate * 100).toFixed(0)}%（疑似数据源限流）` : '服务端降级'));
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

  return (
    <main className="min-h-screen relative overflow-hidden">
      {/* 背景装饰：右上角 atmosphere blob */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-32 -right-40 w-[480px] h-[480px] rounded-full"
        style={{ background: 'radial-gradient(circle, rgba(181,72,57,0.08) 0%, transparent 70%)' }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-32 -left-32 w-[400px] h-[400px] rounded-full"
        style={{ background: 'radial-gradient(circle, rgba(90,116,96,0.06) 0%, transparent 70%)' }}
      />

      <div className="max-w-5xl mx-auto px-6 lg:px-8 py-10 lg:py-16 relative">

        {/* 顶部导航行 */}
        <div className="flex items-center justify-between mb-12">
          <div className="font-mono text-xs tracking-widest" style={{ color: 'var(--ink-muted)' }}>
            ANCIENT · CHAR · LOOKUP
          </div>
          <ServerStatusPill health={serverHealth} />
        </div>

        {/* HERO */}
        <section className="grid lg:grid-cols-[1.3fr_1fr] gap-12 items-center mb-16">
          <div className="fade-in">
            <div className="font-mono text-xs tracking-widest mb-4" style={{ color: 'var(--vermilion)' }}>
              · 字源檢索 · 一键對照 · CC0 ·
            </div>
            <h1 className="brand-title">
              一字之间，<br />三千年之<em>跨越</em>
            </h1>
            <p className="brand-sub mt-6">
              粘贴汉字，看它在<strong>甲骨文 · 金文 · 战国文字 · 篆书</strong>四个时代的样子。
              数据来自 ccamc.org（开放古文字字形库 · CC0），完整 99.6% 命中率请用本地 CLI。
            </p>
          </div>

          {/* Hero 演化网格 — 5 格大现代字 + 4 时代轮播高亮 */}
          <div className="relative">
            <div className="grid grid-cols-5 gap-2">
              <div
                className="evo-cell modern col-span-1"
                style={{ outline: heroIdx === 0 ? '2px solid var(--vermilion)' : 'none', outlineOffset: 2, transition: 'outline 0.3s' }}
              >
                令
                <span className="era-tag">现代</span>
              </div>
              {hero.map((h, i) => (
                <div
                  key={h.era}
                  className="evo-cell"
                  style={{
                    outline: heroIdx === i + 1 ? '2px solid var(--vermilion)' : 'none',
                    outlineOffset: 2,
                    transition: 'outline 0.3s',
                  }}
                >
                  <img src={h.src} alt={h.label} />
                  <span className="era-tag">{h.label}</span>
                </div>
              ))}
            </div>
            <div className="mt-3 font-mono text-[10px] tracking-widest text-right" style={{ color: 'var(--ink-muted)' }}>
              「令」字之演化 · EVOBC 数据集
            </div>
          </div>
        </section>

        {/* 输入区 */}
        <section className="mb-12">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-display text-2xl font-semibold">輸入待查的字</h2>
            <button
              onClick={() => setText(EXAMPLE_TEXT)}
              className="btn-ghost"
              disabled={busy}
            >
              示例字
            </button>
          </div>

          <div
            className="border-2 border-dashed rounded-md px-4 py-3 text-center mb-3 transition-colors"
            style={{ borderColor: 'var(--rule)' }}
            onDragOver={(e) => { e.preventDefault(); e.currentTarget.style.borderColor = 'var(--vermilion)'; }}
            onDragLeave={(e) => { e.currentTarget.style.borderColor = 'var(--rule)'; }}
            onDrop={(e) => { e.currentTarget.style.borderColor = 'var(--rule)'; onDrop(e); }}
          >
            <input
              ref={fileRef} type="file" accept=".docx,.txt" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }}
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="font-mono text-sm hover:underline"
              style={{ color: 'var(--vermilion)' }}
            >
              ↑ 上传文件
            </button>
            <span className="font-mono text-xs ml-2" style={{ color: 'var(--ink-muted)' }}>
              .docx / .txt · 或拖入此处
            </span>
          </div>

          <textarea
            className="field-input min-h-[180px]"
            placeholder={`输入汉字，每行一个或自由格式：\n令\n鬼\n龍\n俯（頫）  ← 括号内是异体字`}
            value={text}
            onChange={(e) => setText(e.target.value)}
            spellCheck={false}
            disabled={busy}
          />

          {/* 模式 + 生成 */}
          <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-3">
            <div className="flex items-center gap-3 text-sm" style={{ color: 'var(--ink-soft)' }}>
              <span className="font-mono text-xs tracking-wider" style={{ color: 'var(--ink-muted)' }}>OUTPUT</span>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input type="radio" name="mode" value="images" checked={mode === 'images'} onChange={() => setMode('images')} disabled={busy} />
                <span>對照表（含图）</span>
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input type="radio" name="mode" value="nav" checked={mode === 'nav'} onChange={() => setMode('nav')} disabled={busy} />
                <span>導航表（仅链接，最稳）</span>
              </label>
            </div>

            <div className="flex items-center gap-3 ml-auto">
              <button
                onClick={handleGenerate}
                disabled={busy || !text.trim()}
                className="btn-primary"
              >
                {phase === 'parsing' ? '解析中…' : phase === 'matching' ? `匹配 ${progress.done}/${progress.total}` : '一键生成 →'}
              </button>
            </div>
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
                ⚠ <strong>已自动降级到导航表模式</strong>（{degradedReason}）。完整对照表请用 <a href="https://github.com/carpediemzzsssww-cpu/ancient-char-lookup" target="_blank" rel="noopener" style={{ color: 'var(--vermilion)' }}>本地 CLI</a>（99.6% 命中）。
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
                      ccamc 未收录 {stats.notInDb}
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
                      <th>現代漢字</th>
                      <th>甲骨文</th>
                      <th>金文</th>
                      <th>戰國文字</th>
                      <th>篆書</th>
                      <th>字源檢索</th>
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
                            <div className="hit-note">配字：{r.hitChar}</div>
                          )}
                          {r.fromCache && <span className="cache-badge">⚡ 缓存</span>}
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
                      <th>現代漢字</th>
                      <th>字源檢索（4 個權威庫）</th>
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

            {/* 「缺」状态图例 */}
            {actualMode === 'images' && rows && (
              <div className="mt-4 hint-card text-xs">
                <strong>「缺」的几种可能：</strong>
                <span className="cell-miss-empty mx-2">·  灰</span>= 此字源此时代无字形拓本（古文字本就只有部分字流传至今）
                <span className="cell-miss-captcha mx-2">⏳ 朱</span>= 数据源临时限流，刷新或几小时后再试
                <span className="cell-miss-error mx-2">✕ 暗</span>= 网络错误。完整对照表请用 <a href="https://github.com/carpediemzzsssww-cpu/ancient-char-lookup" target="_blank" rel="noopener" style={{ color: 'var(--vermilion)' }}>本地 CLI</a>。
              </div>
            )}
          </section>
        )}

        {/* 印章 + 致谢 */}
        <footer className="mt-20 pt-8 flex flex-col sm:flex-row items-center sm:items-end gap-6 sm:gap-8 sm:justify-between" style={{ borderTop: '1px solid var(--rule)' }}>
          <div className="flex items-center gap-4">
            <div className="seal" aria-hidden>古文</div>
            <div>
              <div className="font-display text-base font-semibold" style={{ color: 'var(--ink)' }}>古文字對照表生成器</div>
              <div className="font-mono text-[10px] tracking-widest mt-1" style={{ color: 'var(--ink-muted)' }}>
                CLI · WEB · MIT LICENSE
              </div>
            </div>
          </div>
          <div className="text-xs leading-relaxed text-center sm:text-right" style={{ color: 'var(--ink-muted)' }}>
            <div>
              数据致谢：
              <a className="ml-1 hover:underline" style={{ color: 'var(--ink-soft)' }} href="http://ccamc.org" target="_blank" rel="noopener">ccamc.org</a> ·
              <a className="ml-1 hover:underline" style={{ color: 'var(--ink-soft)' }} href="https://zi.tools" target="_blank" rel="noopener">zi.tools</a> ·
              <a className="ml-1 hover:underline" style={{ color: 'var(--ink-soft)' }} href="https://xiaoxue.iis.sinica.edu.tw" target="_blank" rel="noopener">小学堂</a> ·
              <a className="ml-1 hover:underline" style={{ color: 'var(--ink-soft)' }} href="https://github.com/RomanticGodVAN/character-Evolution-Dataset" target="_blank" rel="noopener">EVOBC</a>
            </div>
            <div className="mt-1">
              <a className="hover:underline" style={{ color: 'var(--vermilion)' }} href="https://github.com/carpediemzzsssww-cpu/ancient-char-lookup" target="_blank" rel="noopener">GitHub →</a>
            </div>
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
      <span className="status-pill status-degraded" title="ccamc 当前限流，已切到导航表模式">
        <span className="dot" />
        <span>限流中 · 自动降级</span>
      </span>
    );
  }
  return (
    <span className="status-pill status-ok" title={`缓存 ${health.memSize} 字 · 命中 ${health.cacheHits} 次`}>
      <span className="dot" />
      <span>正常 · cache {health.memSize}</span>
    </span>
  );
}

function EraCell({ url, status, eraLabel }: { url: string | null; status: EraStatus; eraLabel: string }) {
  if (status === 'ok' && url) {
    return <img src={url} alt={eraLabel} loading="lazy" />;
  }
  if (status === 'captcha') {
    return <span className="cell-miss-captcha" title="数据源临时限流，刷新或稍后再试">⏳ 限流</span>;
  }
  if (status === 'error') {
    return <span className="cell-miss-error" title="网络错误">✕ 失败</span>;
  }
  // empty
  return <span className="cell-miss-empty" title="此字源此时代无收录（古文字部分字本就无遗存）">· 无</span>;
}
