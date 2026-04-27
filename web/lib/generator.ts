import type { Entry } from './parser';
import { buildRefLinks } from './links';
import { ERAS, ERA_LABEL, type Era } from './ccamc';

export type MatchResult = {
  entry: Entry;
  images: Record<Era, string | null>; // 选中的一张 URL
};

export type Stats = {
  total: number;
  anyHit: number;
  allMiss: number;
  eraHits: Record<Era, number>;
};

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderRow(idx: number, m: MatchResult): string {
  const { entry, images } = m;
  const charLabel = entry.variants.length
    ? `${escapeHtml(entry.main)}<span class="variant">（${escapeHtml(entry.variants.join('、'))}）</span>`
    : escapeHtml(entry.main);

  const cells = ERAS.map((era) => {
    const url = images[era];
    if (!url) return `<td class="era miss">缺</td>`;
    return `<td class="era"><img src="${escapeHtml(url)}" alt="${ERA_LABEL[era]}" loading="lazy"/></td>`;
  }).join('');

  const refLinks = buildRefLinks(entry.main)
    .map((l) => `<a href="${escapeHtml(l.url)}" target="_blank" rel="noopener">${l.name}</a>`)
    .join(' ');

  const allChars = [entry.main, ...entry.variants].join('');
  const allMissing = ERAS.every((e) => !images[e]);
  const note = allMissing ? '未收录' : '';

  return `<tr id="row-${idx}" data-chars="${escapeHtml(allChars)}">
    <td class="num">${idx}</td>
    <td class="modern">${charLabel}</td>
    ${cells}
    <td class="ref-links">${refLinks}</td>
    <td class="note">${escapeHtml(note)}</td>
  </tr>`;
}

export function renderHTML(matches: MatchResult[], stats: Stats): string {
  const ts = new Date().toLocaleString('zh-CN');
  const chips = matches
    .map((m, i) => `<a class="chip" href="#row-${i + 1}" data-row="${i + 1}">${escapeHtml(m.entry.main)}</a>`)
    .join('');
  const rows = matches.map((m, i) => renderRow(i + 1, m)).join('\n');

  const stat = `总条目 ${stats.total}　·　至少一种古文字形 ${stats.anyHit}（${(100 * stats.anyHit / Math.max(1, stats.total)).toFixed(1)}%）　·　完全未收录 ${stats.allMiss}`;

  return `<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8"/>
<title>古文字還原字表</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 24px; color: #222; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  .meta { font-size: 12px; color: #666; margin-bottom: 12px; }
  .stats { font-size: 12px; color: #444; margin-bottom: 16px; }
  .nav { position: sticky; top: 0; background: #fff; padding: 10px 0; border-bottom: 1px solid #ddd; margin-bottom: 12px; z-index: 10; }
  .nav-bar { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  .nav-bar input { font-size: 16px; padding: 6px 10px; border: 1px solid #999; border-radius: 4px; width: 220px; font-family: KaiTi, STKaiti, "楷体", serif; }
  .nav-bar button { font-size: 12px; padding: 6px 10px; border: 1px solid #999; background: #f5f5f5; border-radius: 4px; cursor: pointer; }
  .nav-bar .hint { font-size: 11px; color: #888; }
  .nav-bar .match-info { font-size: 12px; color: #555; }
  .index-toggle { font-size: 12px; color: #1a5fb4; cursor: pointer; user-select: none; }
  .index-cloud { max-height: 96px; overflow-y: auto; margin-top: 8px; line-height: 1.7; padding: 4px; border: 1px solid #eee; background: #fafafa; }
  .index-cloud.collapsed { display: none; }
  .chip { display: inline-block; font-family: KaiTi, STKaiti, "楷体", serif; font-size: 16px; color: #333; padding: 0 4px; margin: 0 1px; text-decoration: none; border-radius: 3px; }
  .chip:hover { background: #ffeb3b; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid #888; padding: 6px; text-align: center; vertical-align: middle; }
  th { background: #f3f3f3; font-weight: 600; font-size: 13px; }
  td.num { width: 36px; color: #888; font-size: 12px; }
  td.modern { width: 90px; font-family: KaiTi, STKaiti, "楷体", serif; font-size: 36px; line-height: 1.1; }
  td.modern .variant { font-size: 18px; color: #555; display: block; }
  td.era { width: 100px; height: 92px; }
  td.era img { max-width: 80px; max-height: 80px; }
  td.era.miss { color: #bbb; font-size: 12px; }
  td.ref-links { width: 180px; font-size: 11px; }
  td.ref-links a { color: #1a5fb4; margin-right: 6px; text-decoration: none; }
  td.note { width: 60px; font-size: 11px; color: #888; }
  tr.flash { animation: flash 1.6s ease-out; }
  @keyframes flash { 0%, 30% { background: #fff59d; } 100% { background: transparent; } }
  @media print {
    @page { size: A4 landscape; margin: 12mm; }
    body { margin: 0; }
    h1 { font-size: 16px; }
    .meta, .stats, .nav { display: none !important; }
    .ref-links { display: none !important; }
    table { font-size: 11px; }
    td.modern { font-size: 28px; }
    td.era { width: 80px; height: 78px; }
    td.era img { max-width: 64px; max-height: 64px; }
    tr { page-break-inside: avoid; }
  }
</style>
</head>
<body>
  <h1>古文字還原字表</h1>
  <div class="meta">生成时间：${escapeHtml(ts)}　·　数据来源：ccamc.org（CC0）</div>
  <div class="stats">${escapeHtml(stat)}</div>
  <div class="nav">
    <div class="nav-bar">
      <input id="search" type="text" placeholder="输入汉字跳转 (Enter 下一个)" autocomplete="off"/>
      <button id="prev">上一个</button>
      <button id="next">下一个</button>
      <span class="match-info" id="match-info"></span>
      <span class="hint">·</span>
      <span class="index-toggle" id="index-toggle">展开全字索引 ▾</span>
    </div>
    <div class="index-cloud collapsed" id="index-cloud">${chips}</div>
  </div>
  <table>
    <thead>
      <tr>
        <th>序號</th><th>現代漢字</th><th>甲骨文</th><th>金文</th><th>戰國文字</th><th>篆書</th><th class="ref-links">參考鏈接</th><th>備註</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
<script>
(function(){
  const input = document.getElementById('search');
  const prev = document.getElementById('prev');
  const next = document.getElementById('next');
  const info = document.getElementById('match-info');
  const toggle = document.getElementById('index-toggle');
  const cloud = document.getElementById('index-cloud');
  const rows = Array.from(document.querySelectorAll('tbody tr'));
  let matches = []; let cursor = -1;
  function flash(row){ rows.forEach(r=>r.classList.remove('flash')); row.classList.add('flash'); row.scrollIntoView({behavior:'smooth',block:'center'}); }
  function search(q){ q=(q||'').trim(); if(!q){matches=[];cursor=-1;info.textContent='';return;} matches=rows.filter(r=>(r.dataset.chars||'').includes(q)); if(matches.length===0){info.textContent='未找到';cursor=-1;return;} cursor=0; info.textContent='1 / '+matches.length; flash(matches[0]); }
  function step(d){ if(matches.length===0)return; cursor=(cursor+d+matches.length)%matches.length; info.textContent=(cursor+1)+' / '+matches.length; flash(matches[cursor]); }
  input.addEventListener('input',e=>search(e.target.value));
  input.addEventListener('keydown',e=>{ if(e.key==='Enter'){e.preventDefault(); step(e.shiftKey?-1:1);} });
  next.addEventListener('click',()=>step(1));
  prev.addEventListener('click',()=>step(-1));
  toggle.addEventListener('click',()=>{ const c=cloud.classList.toggle('collapsed'); toggle.textContent=c?'展开全字索引 ▾':'收起全字索引 ▴'; });
  cloud.addEventListener('click',e=>{ if(e.target.classList.contains('chip')){ const r=document.getElementById('row-'+e.target.dataset.row); if(r){e.preventDefault(); flash(r);} } });
  if(location.hash.startsWith('#row-')){ const r=document.getElementById(location.hash.slice(1)); if(r) setTimeout(()=>flash(r),100); }
})();
</script>
</body>
</html>`;
}
