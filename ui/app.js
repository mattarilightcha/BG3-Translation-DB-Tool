// ===== Utilities =====
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
function escReg(s){ return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function snippetAround(term, text, max = 260){
  const t = String(text||''); const needle = String(term||'').toLowerCase();
  if(!needle) return t.length>max ? t.slice(0,max)+'…' : t;
  const lower = t.toLowerCase(); const i = lower.indexOf(needle);
  if(i<0) return t.length>max ? t.slice(0,max)+'…' : t;
  const pad = Math.floor(max*0.45);
  let s = t.slice(Math.max(0,i-pad), Math.min(t.length, i+needle.length+pad));
  if(i-pad>0) s = '…'+s;
  if(i+needle.length+pad < t.length) s = s+'…';
  return s;
}
function highlightHtml(text, term){
  const esc = escapeHtml(text||''); if(!term) return esc;
  const re = new RegExp(escReg(term), 'ig');
  return esc.replace(re, m=>`<mark>${m}</mark>`);
}

/* ===== Tabs ===== */
function showTab(id){
  const isSearch = id==='search';
  $('#panel-search').hidden = !isSearch;
  $('#panel-query').hidden  =  isSearch;
  $('#tab-search').setAttribute('aria-selected', String(isSearch));
  $('#tab-query').setAttribute('aria-selected', String(!isSearch));
}
$('#tab-search').onclick = ()=>showTab('search');
$('#tab-query').onclick = ()=>showTab('query');
// デフォは Query タブ
showTab('query');

/* ===== Search ===== */
async function doSearch(){
  const q = $('#q').value.trim();
  const size = Math.max(1, Math.min(200, Number($('#size').value)||20));
  if(!q){ $('#searchStatus').textContent = '検索語を入力'; return; }
  $('#searchStatus').textContent = '検索中…';
  const url = new URL('/search', location.origin);
  url.searchParams.set('q', q);
  url.searchParams.set('size', String(size));
  url.searchParams.set('max_len', '240'); // ハイライトとスニペット
  const res = await fetch(url);
  const data = await res.json();
  renderSearchTable(data.items||[], q);
  $('#searchStatus').textContent = `表示 ${data.items?.length||0}`;
}
function renderSearchTable(items, q){
  const t = $('#searchTable'); const tb = t.tBodies[0]; tb.innerHTML = '';
  for(const r of items){
    const tr = document.createElement('tr');
    tr.innerHTML =
      `<td>${r.id}</td>`+
      `<td><code>${highlightHtml(r.en||'', q)}</code></td>`+
      `<td>${highlightHtml(r.ja||'', q)}</td>`+
      `<td>${Number(r.score).toFixed(2)}</td>`;
    tb.appendChild(tr);
  }
  t.hidden = items.length===0;
}
$('#btnSearch').onclick = doSearch;
$('#q').addEventListener('keydown', e=>{ if(e.key==='Enter') doSearch(); });
$('#copyTable').onclick = ()=>{
  const rows = [...$('#searchTable tbody').rows].map(tr=>[...tr.cells].map(td=>td.innerText));
  if(!rows.length) return;
  const tsv = ['ID\tEN\tJA\tscore', ...rows.map(r=>r.join('\t'))].join('\n');
  navigator.clipboard.writeText(tsv);
};

/* ===== Query ===== */
async function runQuery(){
  const lines = $('#terms').value.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  const top_k = Math.max(1, Math.min(5, Number($('#topk').value)||3));
  const max_len = Math.max(0, Number($('#maxlen').value)||0);
  const exact = $('#exact').checked;
  const word_boundary = $('#wb').checked;
  const min_priority = $('#minprio').value === '' ? null : Number($('#minprio').value);
  const sources = $('#sources').value.split(',').map(s=>s.trim()).filter(Boolean);

  if(!lines.length){ $('#queryStatus').textContent='語を入力'; return; }
  $('#queryStatus').textContent='照会中…';

  const res = await fetch('/query',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({lines, top_k, max_len, exact, word_boundary, min_priority, sources})
  });
  const data = await res.json();
  window._lastQuery = data;
  renderQueryTable(data, top_k);
  $('#queryStatus').textContent = `対象 ${data.length} 行`;
}

function renderQueryTable(rows, topk){
  const t = $('#queryTable');
  const tb = t.tBodies[0];
  tb.innerHTML = '';

  // ヘッダを Top-K に合わせて作り直し
  const thead = t.tHead;
  if (thead) {
    thead.rows[0].innerHTML = `<th style="width:20%">Term</th>` +
      Array.from({length: topk}, (_,i)=>`<th>候補${i+1}</th>`).join('');
  }

  for(const r of rows){
    const tr = document.createElement('tr');
    const tdTerm = document.createElement('td'); tdTerm.textContent = r.term; tr.appendChild(tdTerm);
    const cands = r.candidates || [];
    for(let i=0;i<topk;i++){
      const td = document.createElement('td');
      const p = cands[i];
      if(p){
        const en = snippetAround(r.term, p[0]);
        const ja = snippetAround(r.term, p[1]);
        td.innerHTML = `<div><code>${highlightHtml(en, r.term)}</code></div><div>${highlightHtml(ja, r.term)}</div>`;
      }
      tr.appendChild(td);
    }
    tb.appendChild(tr);
  }
  t.hidden = rows.length===0;
}

$('#btnRun').onclick = runQuery;

function toJSONL(rows){
  return rows.map(r=>{
    const c=(r.candidates||[]).map(p=>[(p?.[0]||''),(p?.[1]||'')]); 
    return JSON.stringify({term:r.term,candidates:c});
  }).join('\n');
}
function toTSV(rows){
  const head=['term','EN1','JA1','EN2','JA2','EN3','JA3'];
  const body=(rows||[]).map(r=>{
    const flat=(r.candidates||[]).flat(); while(flat.length<6) flat.push('');
    return [r.term,...flat.slice(0,6)].join('\t');
  });
  return [head.join('\t'),...body].join('\n');
}
$('#copyJSONL').onclick = ()=>{ if(window._lastQuery){ navigator.clipboard.writeText(toJSONL(window._lastQuery)); $('#queryStatus').textContent='JSONLコピー完了'; } };
$('#copyTSV').onclick   = ()=>{ if(window._lastQuery){ navigator.clipboard.writeText(toTSV(window._lastQuery));   $('#queryStatus').textContent='TSVコピー完了';   } };
