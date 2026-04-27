'use client';

import { useCallback, useRef, useState } from 'react';
import type { Entry } from '@/lib/parser';
import { buildRefLinks } from '@/lib/links';
import { renderNavHTML } from '@/lib/nav-generator';

type Phase = 'idle' | 'parsing' | 'done' | 'error';

const MAX_CHARS = 2000;

export default function Home() {
  const [text, setText] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [entries, setEntries] = useState<Entry[] | null>(null);
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
    setEntries(null);
    try {
      setPhase('parsing');
      const r = await fetch('/api/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      const d = await r.json();
      if (!r.ok || d.error) throw new Error(d.error || 'parse failed');
      const es: Entry[] = d.entries;
      if (es.length === 0) {
        setPhase('error');
        setErrMsg('未识别到任何汉字');
        return;
      }
      if (es.length > MAX_CHARS) {
        setPhase('error');
        setErrMsg(`输入超过 ${MAX_CHARS} 字（当前 ${es.length}），请用本地 CLI`);
        return;
      }
      setEntries(es);
      setPhase('done');
    } catch (e) {
      setErrMsg(String((e as Error).message || e));
      setPhase('error');
    }
  }, [text]);

  const downloadHtml = useCallback(() => {
    if (!entries) return;
    const html = renderNavHTML(entries);
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = '古文字字源導航表.html';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, [entries]);

  const printHtml = useCallback(() => {
    if (!entries) return;
    const html = renderNavHTML(entries);
    const w = window.open('', '_blank');
    if (!w) return;
    w.document.write(html);
    w.document.close();
    setTimeout(() => w.print(), 800);
  }, [entries]);

  const busy = phase === 'parsing';

  return (
    <main className="min-h-screen bg-slate-50 text-slate-800">
      <div className="max-w-4xl mx-auto px-6 py-10">
        <header className="mb-6">
          <h1 className="text-3xl font-semibold tracking-tight">古文字字源導航表</h1>
          <p className="text-sm text-slate-600 mt-2 leading-6">
            上传 docx/txt 或粘贴汉字 → 为每字生成「字統网 / 古文字字形庫 / 小學堂 / 漢典」4 個权威字源庫的检索链接，可打印 A4。
          </p>
          <div className="mt-3 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded p-2 leading-6">
            <strong>关于古文字图片：</strong>
            本 Web 版未直接内嵌甲骨/金文等图片，因目标字源站 ccamc.org 对自动抓取有反爬保护。
            如需带 4 个时代图片的<strong>完整对照表</strong>（99.6% 命中率，含 1.3 万字 EVOBC 离线数据），
            请使用本仓库 <code className="bg-white px-1 rounded border border-amber-300">cli/</code> 子目录的本地 CLI 工具，
            详见 <a className="underline" href="https://github.com/carpediemzzsssww-cpu/ancient-char-lookup#本地-cli-cli" target="_blank" rel="noopener">README</a>。
          </div>
        </header>

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
            {phase === 'parsing' ? '解析中…' : '生成导航表'}
          </button>
        </div>

        {phase === 'error' && errMsg && (
          <div className="mt-4 text-sm text-red-700 bg-red-50 border border-red-200 rounded p-3">
            {errMsg}
          </div>
        )}

        {phase === 'done' && entries && (
          <section className="mt-8">
            <div className="flex items-center justify-between mb-3">
              <div className="text-sm text-slate-700">
                共 <strong>{entries.length}</strong> 字
              </div>
              <div className="flex gap-2">
                <button onClick={downloadHtml} className="text-sm border border-slate-400 px-3 py-1 rounded hover:bg-slate-100">下载 HTML</button>
                <button onClick={printHtml} className="text-sm border border-slate-400 px-3 py-1 rounded hover:bg-slate-100">打印</button>
              </div>
            </div>
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
                  {entries.map((e, i) => (
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
                          <a key={l.name} href={l.url} target="_blank" rel="noopener" className="mr-3 text-blue-700 hover:underline text-sm">
                            {l.name}
                          </a>
                        ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        <footer className="mt-12 pt-6 border-t border-slate-200 text-xs text-slate-500">
          <a className="underline" href="https://github.com/carpediemzzsssww-cpu/ancient-char-lookup" target="_blank" rel="noopener">GitHub</a> · MIT License · 致谢：
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
