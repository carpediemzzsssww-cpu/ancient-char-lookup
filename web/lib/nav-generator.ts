import type { Entry } from './parser';
import { buildRefLinks } from './links';

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// 简化版：纯链接导航表（无图，避免 ccamc.org 反爬）
// 用户在每行点 4 个外链去对应字源网站手动查看
export function renderNavHTML(entries: Entry[]): string {
  const ts = new Date().toLocaleString('zh-CN');
  const chips = entries
    .map((e, i) => `<a class="chip" href="#row-${i + 1}" data-row="${i + 1}">${escapeHtml(e.main)}</a>`)
    .join('');

  const rows = entries.map((e, i) => {
    const charLabel = e.variants.length
      ? `${escapeHtml(e.main)}<span class="variant">（${escapeHtml(e.variants.join('、'))}）</span>`
      : escapeHtml(e.main);
    const links = buildRefLinks(e.main)
      .map((l) => `<a href="${escapeHtml(l.url)}" target="_blank" rel="noopener">${l.name}</a>`)
      .join(' ');
    const allChars = [e.main, ...e.variants].join('');
    return `<tr id="row-${i + 1}" data-chars="${escapeHtml(allChars)}">
      <td class="num">${i + 1}</td>
      <td class="modern">${charLabel}</td>
      <td class="links">${links}</td>
    </tr>`;
  }).join('\n');

  return `<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8"/>
<title>古文字字源導航表</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 24px; color: #222; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  .meta { font-size: 12px; color: #666; margin-bottom: 16px; }
  .nav { position: sticky; top: 0; background: #fff; padding: 10px 0; border-bottom: 1px solid #ddd; margin-bottom: 12px; z-index: 10; }
  .nav-bar { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  .nav-bar input { font-size: 16px; padding: 6px 10px; border: 1px solid #999; border-radius: 4px; width: 220px; font-family: KaiTi, STKaiti, "楷体", serif; }
  .nav-bar button { font-size: 12px; padding: 6px 10px; border: 1px solid #999; background: #f5f5f5; border-radius: 4px; cursor: pointer; }
  .nav-bar .match-info { font-size: 12px; color: #555; }
  .index-toggle { font-size: 12px; color: #1a5fb4; cursor: pointer; user-select: none; }
  .index-cloud { max-height: 96px; overflow-y: auto; margin-top: 8px; line-height: 1.7; padding: 4px; border: 1px solid #eee; background: #fafafa; }
  .index-cloud.collapsed { display: none; }
  .chip { display: inline-block; font-family: KaiTi, STKaiti, "楷体", serif; font-size: 16px; color: #333; padding: 0 4px; margin: 0 1px; text-decoration: none; border-radius: 3px; }
  .chip:hover { background: #ffeb3b; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid #888; padding: 8px 10px; text-align: left; vertical-align: middle; }
  th { background: #f3f3f3; font-weight: 600; font-size: 13px; }
  td.num { width: 48px; color: #888; font-size: 12px; text-align: center; }
  td.modern { width: 120px; font-family: KaiTi, STKaiti, "楷体", serif; font-size: 28px; line-height: 1.1; text-align: center; }
  td.modern .variant { font-size: 14px; color: #555; display: block; }
  td.links a { color: #1a5fb4; margin-right: 12px; text-decoration: none; font-size: 13px; }
  td.links a:hover { text-decoration: underline; }
  tr.flash { animation: flash 1.6s ease-out; }
  @keyframes flash { 0%, 30% { background: #fff59d; } 100% { background: transparent; } }
  @media print {
    @page { size: A4 portrait; margin: 16mm; }
    body { margin: 0; }
    h1 { font-size: 16px; }
    .meta, .nav { display: none !important; }
    table { font-size: 12px; }
    td.modern { font-size: 22px; }
    tr { page-break-inside: avoid; }
  }
</style>
</head>
<body>
  <h1>古文字字源導航表</h1>
  <div class="meta">生成时间：${escapeHtml(ts)}　·　共 ${entries.length} 字</div>
  <div class="nav">
    <div class="nav-bar">
      <input id="search" type="text" placeholder="输入汉字跳转 (Enter 下一个)" autocomplete="off"/>
      <button id="prev">上一个</button>
      <button id="next">下一个</button>
      <span class="match-info" id="match-info"></span>
      <span class="index-toggle" id="index-toggle">展开全字索引 ▾</span>
    </div>
    <div class="index-cloud collapsed" id="index-cloud">${chips}</div>
  </div>
  <table>
    <thead>
      <tr><th>序號</th><th>現代漢字</th><th>字源檢索（4 個權威字形庫）</th></tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
<script>
(function(){
  const input=document.getElementById('search');
  const prev=document.getElementById('prev');
  const next=document.getElementById('next');
  const info=document.getElementById('match-info');
  const toggle=document.getElementById('index-toggle');
  const cloud=document.getElementById('index-cloud');
  const rows=Array.from(document.querySelectorAll('tbody tr'));
  let matches=[];let cursor=-1;
  function flash(r){rows.forEach(x=>x.classList.remove('flash'));r.classList.add('flash');r.scrollIntoView({behavior:'smooth',block:'center'});}
  function search(q){q=(q||'').trim();if(!q){matches=[];cursor=-1;info.textContent='';return;}matches=rows.filter(r=>(r.dataset.chars||'').includes(q));if(matches.length===0){info.textContent='未找到';cursor=-1;return;}cursor=0;info.textContent='1 / '+matches.length;flash(matches[0]);}
  function step(d){if(matches.length===0)return;cursor=(cursor+d+matches.length)%matches.length;info.textContent=(cursor+1)+' / '+matches.length;flash(matches[cursor]);}
  input.addEventListener('input',e=>search(e.target.value));
  input.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();step(e.shiftKey?-1:1);}});
  next.addEventListener('click',()=>step(1));
  prev.addEventListener('click',()=>step(-1));
  toggle.addEventListener('click',()=>{const c=cloud.classList.toggle('collapsed');toggle.textContent=c?'展开全字索引 ▾':'收起全字索引 ▴';});
  cloud.addEventListener('click',e=>{if(e.target.classList.contains('chip')){const r=document.getElementById('row-'+e.target.dataset.row);if(r){e.preventDefault();flash(r);}}});
  if(location.hash.startsWith('#row-')){const r=document.getElementById(location.hash.slice(1));if(r)setTimeout(()=>flash(r),100);}
})();
</script>
</body>
</html>`;
}
