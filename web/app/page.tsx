'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import type { Entry } from '@/lib/parser';
import { ERAS, type Era } from '@/lib/ccamc';
import { assembleMatches, computeStats, renderHTML, type CharResult } from '@/lib/render';

type Phase = 'idle' | 'parsing' | 'matching' | 'done' | 'error';

const MAX_CHARS = 200;
const BATCH = 8;

export default function Home() {
  const [text, setText] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [html, setHtml] = useState<string | null>(null);
  const [stats, setStats] = useState<{ total: number; anyHit: number; allMiss: number; failed: string[] } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const onFile = useCallback(async (f: File) => {
    setText('');
    const ext = f.name.toLowerCase().split('.').pop();
    if (ext === 'txt') {
      setText(await f.text());
    } else if (ext === 'docx') {
      // 走服务端解析（mammoth）
      try {
        setPhase('parsing');
        const fd = new FormData();
        fd.set('file', f);
        const r = await fetch('/api/parse', { method: 'POST', body: fd });
        const d = await r.json();
        if (!r.ok || d.error) throw new Error(d.error || 'parse failed');
        const entries: Entry[] = d.entries;
        // 把解析到的字写回粘贴框（让用户可见）
        setText(entries.map((e) => e.main + (e.variants.length ? `（${e.variants.join('')}）` : '')).join('\n'));
        setPhase('idle');
      } catch (e) {
        setErrMsg(String((e as Error).message || e));
        setPhase('error');
      }
    } else {
      setErrMsg('仅支持 .docx 或 .txt');
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
    setProgress({ done: 0, total: 0 });
    try {
      setPhase('parsing');
      // 先 parse 文本（服务端，复用 /api/parse 文本路径）
      const r = await fetch('/api/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      const d = await r.json();
      if (!r.ok || d.error) throw new Error(d.error || 'parse failed');
      let entries: Entry[] = d.entries;
      if (entries.length === 0) {
        setPhase('error');
        setErrMsg('未识别到任何汉字');
        return;
      }
      if (entries.length > MAX_CHARS) {
        setPhase('error');
        setErrMsg(`输入超过 ${MAX_CHARS} 字（当前 ${entries.length}），请用本地 CLI 处理大批量`);
        return;
      }

      // 抽取唯一字
      const uniq = new Set<string>();
      for (const e of entries) { uniq.add(e.main); e.variants.forEach((v) => uniq.add(v)); }
      const chars = Array.from(uniq);

      setPhase('matching');
      setProgress({ done: 0, total: chars.length });

      const byChar = new Map<string, CharResult>();
      // 串行批次
      for (let i = 0; i < chars.length; i += BATCH) {
        const batch = chars.slice(i, i + BATCH);
        const r2 = await fetch('/api/match', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chars: batch }),
        });
        const d2 = await r2.json();
        if (!r2.ok || d2.error) throw new Error(d2.error || 'match failed');
        for (const item of d2.results as CharResult[]) byChar.set(item.char, item);
        setProgress({ done: Math.min(i + BATCH, chars.length), total: chars.length });
      }

      // 装配 + 渲染
      const matches = assembleMatches(entries, byChar);
      const s = computeStats(matches);
      const failed = matches.filter((m) => ERAS.every((e) => !m.images[e])).map((m) => m.entry.main);
      setStats({ total: s.total, anyHit: s.anyHit, allMiss: s.allMiss, failed });
      setHtml(renderHTML(matches, s));
      setPhase('done');
    } catch (e) {
      setErrMsg(String((e as Error).message || e));
      setPhase('error');
    }
  }, [text]);

  const downloadHtml = useCallback(() => {
    if (!html) return;
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = '古文字對照表.html';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, [html]);

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
        <header className="mb-8">
          <h1 className="text-3xl font-semibold tracking-tight">古文字對照表生成器</h1>
          <p className="text-sm text-slate-600 mt-1">
            上传 docx/txt 或粘贴汉字 → 自动生成「甲骨文・金文・战国・篆书」对照表，可打印 A4。
            数据来源：<a className="underline" href="http://ccamc.org" target="_blank" rel="noopener">ccamc.org</a>（CC0）。
          </p>
        </header>

        {/* 输入区 */}
        <div
          className="border-2 border-dashed border-slate-300 rounded-md p-4 text-center mb-3 hover:border-amber-400 transition-colors"
          onDragOver={(e) => e.preventDefault()}
          onDrop={onDrop}
        >
          <input
            ref={fileRef}
            type="file"
            accept=".docx,.txt"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }}
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="text-sm text-amber-700 hover:underline"
          >
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

        <div className="flex items-center gap-3 mt-4">
          <button
            onClick={handleGenerate}
            disabled={busy || !text.trim()}
            className="bg-amber-500 hover:bg-amber-600 disabled:bg-slate-300 text-white font-medium px-5 py-2 rounded-md text-sm transition-colors"
          >
            {phase === 'parsing' ? '解析中…' : phase === 'matching' ? `匹配中 ${progress.done}/${progress.total}` : '生成对照表'}
          </button>

          {phase === 'matching' && (
            <div className="flex-1 h-2 bg-slate-200 rounded">
              <div className="h-full bg-amber-400 rounded transition-all" style={{ width: `${(100 * progress.done) / Math.max(1, progress.total)}%` }} />
            </div>
          )}
        </div>

        {phase === 'error' && errMsg && (
          <div className="mt-4 text-sm text-red-700 bg-red-50 border border-red-200 rounded p-3">
            {errMsg}
          </div>
        )}

        {phase === 'done' && stats && (
          <section className="mt-8">
            <div className="flex items-center justify-between mb-3">
              <div className="text-sm text-slate-700">
                共 <strong>{stats.total}</strong> 字　·　至少一种古文字形 <strong>{stats.anyHit}</strong>　·　完全未收录 <strong>{stats.allMiss}</strong>
                {stats.failed.length > 0 && (
                  <span className="text-slate-500 ml-2">（{stats.failed.slice(0, 12).join('、')}{stats.failed.length > 12 ? '…' : ''}）</span>
                )}
              </div>
              <div className="flex gap-2">
                <button onClick={downloadHtml} className="text-sm border border-slate-400 px-3 py-1 rounded hover:bg-slate-100">下载 HTML</button>
                <button onClick={printHtml} className="text-sm border border-slate-400 px-3 py-1 rounded hover:bg-slate-100">打印</button>
              </div>
            </div>
            {html && (
              <iframe
                title="预览"
                srcDoc={html}
                className="w-full h-[640px] border border-slate-300 rounded-md bg-white"
              />
            )}
          </section>
        )}

        <footer className="mt-12 pt-6 border-t border-slate-200 text-xs text-slate-500">
          Open source on GitHub · 致谢：ccamc.org · zi.tools · 小学堂 · EVOBC
        </footer>
      </div>
    </main>
  );
}
