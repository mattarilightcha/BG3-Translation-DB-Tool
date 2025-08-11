// ---------- 便利 ----------
const $  = (s)=>document.querySelector(s);
const $$ = (s)=>document.querySelectorAll(s);

function setTheme(mode){
  document.documentElement.setAttribute('data-theme', mode);
  localStorage.setItem('tdb-theme', mode);
}
(function initTheme(){
  const saved = localStorage.getItem('tdb-theme');
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  setTheme(saved || (prefersDark ? 'dark' : 'light'));
})();
$('#themeBtn').onclick = ()=>{
  const cur = document.documentElement.getAttribute('data-theme');
  setTheme(cur==='dark' ? 'light' : 'dark');
};

function escapeHtml(s){ return String(s).replace(/[&<>"']/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m])); }

// ---------- タブ ----------
function showTab(id){
  const isSearch = id==='search';
  $('#panel-search').hidden = !isSearch;
  $('#panel-query').hidden  =  isSearch;
  $('#tab-search').setAttribute('aria-selected', String(isSearch));
  $('#tab-query').setAttribute('aria-selected', String(!isSearch));
}
$('#tab-search').onclick = ()=>showTab('search');
$('#tab-query').onclick = ()=>showTab('query');

// ---------- 検索 ----------
async function doSearch(){
  const q = $('#q').value.trim();
  const size = Math.max(1, Math.min(200, Number($('#size').value)||20));
  if(!q){ $('#searchStatus').textContent='検索語を入れてください'; return; }
  $('#searchStatus').textContent='検索中…';
  const url = new URL('/search', location.origin);
  url.searchParams.set('q', q);
  url.searchParams.set('size', String(size));
  const res = await fetch(url);
  const data = await res.json();
  renderSearchTable(data.items||[]);
  $('#searchStatus').textContent = `件数 ${data.items?.length||0} / total ${data.total}`;
}
function renderSearchTable(items){
  const t = $('#searchTable'); const tb = t.tBodies[0];
  tb.innerHTML = '';
  for(const r of items){
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${r.id}</td><td><code>${escapeHtml(r.en||'')}</code></td><td>${escapeHtml(r.ja||'')}</td><td class="mono">${Number(r.score).toFixed(2)}</td>`;
    tb.appendChild(tr);
  }
  t.hidden = items.length===0;
}
$('#btnSearch').onclick = doSearch;
$('#q').addEventListener('keydown', (e)=>{ if(e.key==='Enter'){ doSearch(); }});
$('#copyTable').onclick = ()=>{
  const rows = [...$('#searchTable tbody').rows].map(tr=>[...tr.cells].map(td=>td.innerText));
  if(!rows.length){ return; }
  const tsv = ['ID\tEN\tJA\tscore', ...rows.map(r=>r.join('\t'))].join('\n');
  navigator.clipboard.writeText(tsv);
};

// ---------- 照会 ----------
async function runQuery(){
  const lines = $('#terms').value.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  const top_k = Math.max(1, Math.min(5, Number($('#topk').value)||3));
  if(!lines.length){ $('#queryStatus').textContent='語を入れてください'; return; }
  $('#queryStatus').textContent='照会中…';
  const res = await fetch('/query', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({lines, top_k})});
  const data = await res.json();
  window._lastQuery = data;
  renderQueryTable(data);
  $('#queryStatus').textContent=`対象 ${data.length} 行`;
}
function renderQueryTable(rows){
  const t = $('#queryTable'); const tb = t.tBodies[0];
  tb.innerHTML = '';
  for(const r of rows){
    const tr = document.createElement('tr');
    const cells = [document.createElement('td')];
    cells[0].textContent = r.term;
    for(let i=0;i<3;i++){
      const td = document.createElement('td');
      const p = (r.candidates||[])[i];
      td.innerHTML = p ? `<div><code>${escapeHtml(p[0]||'')}</code></div><div>${escapeHtml(p[1]||'')}</div>` : '';
      cells.push(td);
    }
    for(const c of cells) tr.appendChild(c);
    tb.appendChild(tr);
  }
  t.hidden = rows.length===0;
}
function toJSONL(rows){
  return rows.map(r=>{
    const c = (r.candidates||[]).map(p=>[(p?.[0]||''), (p?.[1]||'')]);
    return JSON.stringify({term:r.term, candidates:c});
  }).join('\n');
}
function toTSV(rows){
  const head = ['term','EN1','JA1','EN2','JA2','EN3','JA3'];
  const body = rows.map(r=>{
    const flat = (r.candidates||[]).flat();
    while(flat.length<6) flat.push('');
    return [r.term, ...flat.slice(0,6)].join('\t');
  });
  return [head.join('\t'), ...body].join('\n');
}
$('#btnRun').onclick = runQuery;
$('#copyJSONL').onclick = ()=>{ if(window._lastQuery){ navigator.clipboard.writeText(toJSONL(window._lastQuery)); $('#queryStatus').textContent='JSONLコピー完了'; } };
$('#copyTSV').onclick =   ()=>{ if(window._lastQuery){ navigator.clipboard.writeText(toTSV(window._lastQuery));   $('#queryStatus').textContent='TSVコピー完了';   } };
