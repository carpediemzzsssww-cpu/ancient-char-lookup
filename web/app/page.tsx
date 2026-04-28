'use client';

import { useCallback, useRef, useState } from 'react';
import type { Entry } from '@/lib/parser';
import { buildRefLinks } from '@/lib/links';
import { ERAS, ERA_LABEL, type Era } from '@/lib/ccamc';
import { assembleMatches, computeStats, renderHTML, type CharResult } from '@/lib/render';
import { renderNavHTML } from '@/lib/nav-generator';

type Phase = 'idle' | 'parsing' | 'matching' | 'done' | 'error';
type Mode = 'images' | 'nav';

const MAX_CHARS = 500; // 启用图片模式时建议上限
const BATCH = 8;

export default function Home() {
  const [text, setText] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>('images'); // 默认尝试图片
  const [actualMode, setActualMode] = useState<Mode>('images'); // 实际生成时用的模式
  const [degradedReason, setDegradedReason] = useState<string | null>(null);
  const [html, setHtml] = useState<string | null>(null);
  const [stats, setStats] = useState<{
    total: number; anyHit: number; allMiss: number; failed: string[];
    cacheHits?: number; captchaCount?: number;
  } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

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
    setHtml(null);
    setStats(null);
    setDegradedReason(null);
    setProgress({ done: 0, total: 0 });

    try {
      // ── 1. 解析输入 ──
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
      const limit = mode === 'images' ? MAX_CHARS : 2000;
      if (entries.length > limit) {
        setPhase('error');
        setErrMsg(`输入超过 ${limit} 字（当前 ${entries.length}）。${mode === 'images' ? '可以切到「导航表」模式查更多字，或用本地 CLI 处理大批量' : '请用本地 CLI'}`);
        return;
      }

      // ── 2. 导航表模式：直接渲染，不调 /api/match ──
      if (mode === 'nav') {
        setActualMode('nav');
        setStats({ total: entries.length, anyHit: 0, allMiss: 0, failed: [] });
        setHtml(renderNavHTML(entries));
        setPhase('done');
        return;
      }

      // ── 3. 图片模式：分批调 /api/match ──
      const uniq = new Set<string>();
      for (const e of entries) { uniq.add(e.main); e.variants.forEach((v) => uniq.add(v)); }
      const chars = Array.from(uniq);

      setPhase('matching');
      setProgress({ done: 0, total: chars.length });

      const byChar = new Map<string, CharResult>();
      let cacheHits = 0;
      let captchaCount = 0;
      let degradedFromServer = false;
      let degradeReason: string | null = null;

      for (let i = 0; i < chars.length; i += BATCH) {
        const batch = chars.slice(i, i + BATCH);
        const r2 = await fetch('/api/match', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chars: batch }),
        });
        const d2 = await r2.json();
        if (!r2.ok || d2.error) throw new Error(d2.error || 'match failed');

        for (const item of d2.results as (CharResult & { fromCache?: boolean })[]) {
          byChar.set(item.char, item);
          if (item.fromCache) cacheHits++;
        }
        if (typeof d2.stats?.captchaCount === 'number') captchaCount += d2.stats.captchaCount;

        // 服务端连续给 degraded → 立刻停止后续批次，整体降级
        if (d2.degraded) {
          degradedFromServer = true;
          degradeReason = d2.reason || 'degraded';
          break;
        }
        setProgress({ done: Math.min(i + BATCH, chars.length), total: chars.length });
      }

      // ── 4. 决策：是否降级到导航表 ──
      // 触发降级条件：a) 服务端明示 degraded；b) 前端实际命中率 < 30%
      const fetched = Array.from(byChar.values());
      const anyHitCount = fetched.filter((r) =>
        ERAS.some((e) => (r.eras[e]?.length ?? 0) > 0)
      ).length;
      const hitRate = fetched.length > 0 ? anyHitCount / fetched.length : 0;
      const shouldDegrade = degradedFromServer || (fetched.length >= 5 && hitRate < 0.3);

      if (shouldDegrade) {
        setActualMode('nav');
        setDegradedReason(degradeReason || (hitRate < 0.3 ? `命中率仅 ${(hitRate * 100).toFixed(0)}%（疑似数据源限流）` : '服务端降级'));
        setStats({ total: entries.length, anyHit: 0, allMiss: 0, failed: [], cacheHits, captchaCount });
        setHtml(renderNavHTML(entries));
        setPhase('done');
        return;
      }

      // ── 5. 正常组装 ──
      setActualMode('images');
      const matches = assembleMatches(entries, byChar);
      const s = computeStats(matches);
      const failed = matches.filter((m) => ERAS.every((e) => !m.images[e])).map((m) => m.entry.main);
      setStats({ total: s.total, anyHit: s.anyHit, allMiss: s.allMiss, failed, cacheHits, captchaCount });
      setHtml(renderHTML(matches, s));
      setPhase('done');
    } catch (e) {
      setErrMsg(String((e as Error).message || e));
      setPhase('error');
    }
  }, [text, mode]);

  const downloadHtml = useCallback(() => {
    if (!html) return;
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = actualMode === 'images' ? '古文字對照表.html' : '古文字字源導航表.html';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, [html, actualMode]);

  const printHtml = useCallback(() => {
    if (!html) return;
    const w = window.open('', '_blank');
    if (!w) return;
    w.document.write(html);
    w.document.close();
    setTimeout(() => w.print(), 800);
  }, [html]);

  const busy = phase === 'parsing' || phase === 'matching';

  return (
    <main className="min-h-screen bg-slate-50 text-slate-800">
      <div className="max-w-3xl mx-auto px-6 py-10">
        <header className="mb-6">
          <h1 className="text-3xl font-semibold tracking-tight">古文字對照表生成器</h1>
          <p className="text-sm text-slate-600 mt-2 leading-6">
            上传 docx/txt 或粘贴汉字 → 自动生成「甲骨/金文/战国/篆书」可打印对照表。
            数据来源：<a className="underline" href="http://ccamc.org" target="_blank" rel="noopener">ccamc.org</a>（CC0）。
          </p>
          <div className="mt-3 text-xs text-slate-500 leading-6 bg-slate-100 border border-slate-200 rounded p-2">
            ⚙️ 数据源 ccamc.org 偶尔触发反爬。本服务<strong>有自动降级</strong>：服务端检测到限流时切到「字源导航表」模式（仅链接、不出图）。完整 99.6% 命中表请用 <a className="underline" href="https://github.com/carpediemzzsssww-cpu/ancient-char-lookup#本地-cli-cli" target="_blank" rel="noopener">本地 CLI</a>。
          </div>
        </header>

        {/* 输入区 */}
        <div
          className="border-2 border-dashed border-slate-300 rounded-md p-4 text-center mb-3 hover:border-amber-400 transition-colors"
          onDragOver={(e) => e.preventDefault()}
          onDrop={onDrop}
        >
          <input
            ref={fileRef} type="file" accept=".docx,.txt" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }}
          />
          <button type="button" onClick={() => fileRef.current?.click()} className="text-sm text-amber-700 hover:underline">
            点击上传文件
          </button>
          <span className="text-xs text-slate-500 ml-2">或拖入 .docx / .txt</span>
        </div>

        <textarea
          className="w-full min-h-[180px] border border-slate-300 rounded-md p-3 text-base font-serif leading-7 focus:outline-none focus:ring-2 focus:ring-amber-400"
          placeholder={`输入汉字，每行一个或自由格式：\n令\n鬼\n龍\n俯（頫）`}
          value={text}
          onChange={(e) => setText(e.target.value)}
          spellCheck={false}
          disabled={busy}
        />

        {/* 模式切换 */}
        <div className="mt-3 flex items-center gap-3 text-sm">
          <span className="text-slate-600">输出：</span>
          <label className="flex items-center gap-1 cursor-pointer">
            <input type="radio" name="mode" value="images" checked={mode === 'images'} onChange={() => setMode('images')} disabled={busy} />
            <span>对照表（含图）</span>
          </label>
          <label className="flex items-center gap-1 cursor-pointer">
            <input type="radio" name="mode" value="nav" checked={mode === 'nav'} onChange={() => setMode('nav')} disabled={busy} />
            <span>导航表（仅链接，最稳）</span>
          </label>
        </div>

        <div className="flex items-center gap-3 mt-4">
          <button
            onClick={handleGenerate}
            disabled={busy || !text.trim()}
            className="bg-amber-500 hover:bg-amber-600 disabled:bg-slate-300 text-white font-medium px-5 py-2 rounded-md text-sm transition-colors"
          >
            {phase === 'parsing' ? '解析中…' : phase === 'matching' ? `匹配中 ${progress.done}/${progress.total}` : '生成'}
          </button>
          {phase === 'matching' && (
            <div className="flex-1 h-2 bg-slate-200 rounded">
              <div className="h-full bg-amber-400 rounded transition-all" style={{ width: `${(100 * progress.done) / Math.max(1, progress.total)}%` }} />
            </div>
          )}
        </div>

        {phase === 'error' && errMsg && (
          <div className="mt-4 text-sm text-red-700 bg-red-50 border border-red-200 rounded p-3">{errMsg}</div>
        )}

        {phase === 'done' && stats && (
          <section className="mt-8">
            {degradedReason && (
              <div className="mb-3 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded p-3 leading-6">
                ℹ️ 已自动降级到<strong>导航表模式</strong>（{degradedReason}）。
                完整对照表请用本地 CLI——见 <a className="underline" href="https://github.com/carpediemzzsssww-cpu/ancient-char-lookup" target="_blank" rel="noopener">GitHub</a>。
              </div>
            )}
            <div className="flex items-center justify-between mb-3">
              <div className="text-sm text-slate-700">
                共 <strong>{stats.total}</strong> 字
                {actualMode === 'images' && (
                  <>
                    　·　至少一种古文字形 <strong>{stats.anyHit}</strong>　·　完全未收录 <strong>{stats.allMiss}</strong>
                    {typeof stats.cacheHits === 'number' && stats.cacheHits > 0 && (
                      <span className="text-slate-500 ml-2">（缓存命中 {stats.cacheHits}）</span>
                    )}
                  </>
                )}
                {stats.failed.length > 0 && (
                  <span className="text-slate-500 ml-2">（{stats.failed.slice(0, 12).join('、')}{stats.failed.length > 12 ? '…' : ''}）</span>
                )}
              </div>
              <div className="flex gap-2">
                <button onClick={downloadHtml} className="text-sm border border-slate-400 px-3 py-1 rounded hover:bg-slate-100">下载 HTML</button>
                <button onClick={printHtml} className="text-sm border border-slate-400 px-3 py-1 rounded hover:bg-slate-100">打印</button>
              </div>
            </div>
            {actualMode === 'nav' ? (
              <div className="border border-slate-300 rounded-md bg-white max-h-[640px] overflow-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-100 sticky top-0">
                    <tr>
                      <th className="border-b border-slate-300 px-3 py-2 text-left w-12">#</th>
                      <th className="border-b border-slate-300 px-3 py-2 text-left w-24">現代漢字</th>
                      <th className="border-b border-slate-300 px-3 py-2 text-left">字源檢索</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parseTextEntries(text).map((e, i) => (
                      <tr key={i} className="border-b border-slate-100 hover:bg-amber-50">
                        <td className="px-3 py-2 text-slate-500">{i + 1}</td>
                        <td className="px-3 py-2">
                          <span className="text-2xl font-serif">{e.main}</span>
                          {e.variants.length > 0 && (
                            <span className="ml-1 text-sm text-slate-500">（{e.variants.join('、')}）</span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          {buildRefLinks(e.main).map((l) => (
                            <a key={l.name} href={l.url} target="_blank" rel="noopener" className="mr-3 text-blue-700 hover:underline text-sm">{l.name}</a>
                          ))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              html && (
                <iframe
                  title="预览"
                  srcDoc={html}
                  className="w-full h-[640px] border border-slate-300 rounded-md bg-white"
                />
              )
            )}
          </section>
        )}

        <footer className="mt-12 pt-6 border-t border-slate-200 text-xs text-slate-500 leading-6">
          <a className="underline" href="https://github.com/carpediemzzsssww-cpu/ancient-char-lookup" target="_blank" rel="noopener">GitHub</a> · MIT License · 致谢
          <a className="underline ml-1" href="https://zi.tools" target="_blank" rel="noopener">zi.tools</a>、
          <a className="underline ml-1" href="http://ccamc.org" target="_blank" rel="noopener">ccamc.org</a>、
          <a className="underline ml-1" href="https://xiaoxue.iis.sinica.edu.tw" target="_blank" rel="noopener">小学堂</a>、
          <a className="underline ml-1" href="https://www.zdic.net" target="_blank" rel="noopener">汉典</a>、
          <a className="underline ml-1" href="https://github.com/RomanticGodVAN/character-Evolution-Dataset" target="_blank" rel="noopener">EVOBC</a>
        </footer>
      </div>
    </main>
  );
}

// 客户端备用解析（仅纯文本，与服务端 parser 同规则的轻量版）
function parseTextEntries(t: string): Entry[] {
  const HAN = /[一-鿿㐀-䶿]/gu;
  const BR = /^([一-鿿㐀-䶿])\s*[（(]\s*([一-鿿㐀-䶿]+)\s*[）)]/u;
  const seen = new Set<string>();
  const out: Entry[] = [];
  for (const line of t.split(/\r?\n/)) {
    const s = line.trim();
    if (!s) continue;
    let entry: Entry | null = null;
    const m = s.match(BR);
    if (m && m[1] && m[2]) entry = { main: m[1], variants: m[2].split('') };
    else {
      const chars = s.match(HAN) || [];
      if (chars[0]) entry = { main: chars[0], variants: chars.slice(1) };
    }
    if (!entry) continue;
    const key = entry.main + '|' + entry.variants.join('');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(entry);
  }
  return out;
}
