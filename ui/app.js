// ===== Utilities =====
const $  = (s)=>document.querySelector(s);

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
function downloadText(filename, content, mime='text/plain'){
  const blob = new Blob([content], {type: mime + ';charset=utf-8'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  a.remove(); URL.revokeObjectURL(url);
}

/* ===== Tabs ===== */
function showTab(id){
  const ids = ['search','query','import'];
  for(const x of ids){
    $('#panel-'+x).hidden = (x!==id);
    $('#tab-'+x).setAttribute('aria-selected', String(x===id));
  }
}
$('#tab-search').onclick = ()=>showTab('search');
$('#tab-query').onclick  = ()=>showTab('query');
$('#tab-import').onclick = ()=>showTab('import');
showTab('query'); // default

/* ===== Root: Source multiselect ===== */
let SELECTED_SOURCES = new Set();

function renderSourcesMenu(list){
  const saved = JSON.parse(localStorage.getItem('tdb-sources')||'[]');
  if(saved.length){ SELECTED_SOURCES = new Set(saved); }
  const box = $('#srcList'); box.innerHTML = '';
  for(const s of list){
    const id = 'src_' + btoa(encodeURIComponent(s.name)).replace(/=+$/,'');
    const chk = document.createElement('div');
    chk.innerHTML = `
      <label for="${id}">
        <span title="${escapeHtml(s.name)}">${escapeHtml(s.name||'(empty)')}</span>
        <span class="count">${s.count}</span>
      </label>
    `;
    const input = document.createElement('input');
    input.type='checkbox'; input.id=id; input.value=s.name;
    input.checked = (SELECTED_SOURCES.size===0) ? true : SELECTED_SOURCES.has(s.name);
    input.style.marginRight='8px';
    chk.querySelector('label').prepend(input);
    box.appendChild(chk);
  }
  updateSourceSummary();
}
function updateSourceSummary(){
  const arr = [...SELECTED_SOURCES];
  $('#srcSummary').textContent = arr.length ? `選択: ${arr.join(', ')}` : '選択: 全ソース';
  localStorage.setItem('tdb-sources', JSON.stringify(arr));
}

$('#srcBtn').onclick = ()=>{ $('#srcMenu').hidden = !$('#srcMenu').hidden; };
document.addEventListener('click', (e)=>{
  if(!$('#srcMenu').hidden && !$('#srcMenu').contains(e.target) && e.target!==$('#srcBtn')){
    $('#srcMenu').hidden = true;
  }
});
$('#srcAll').onclick = ()=>{
  SELECTED_SOURCES = new Set([...$('#srcList').querySelectorAll('input[type=checkbox]')].map(c=>c.value));
  [...$('#srcList').querySelectorAll('input[type=checkbox]')].forEach(c=>c.checked=true);
};
$('#srcNone').onclick = ()=>{
  SELECTED_SOURCES = new Set(); // 空＝全ソース扱い
  [...$('#srcList').querySelectorAll('input[type=checkbox]')].forEach(c=>c.checked=false);
};
$('#srcApply').onclick = ()=>{
  const checked = [...$('#srcList').querySelectorAll('input[type=checkbox]:checked')].map(c=>c.value);
  SELECTED_SOURCES = new Set(checked);
  updateSourceSummary();
  $('#srcMenu').hidden = true;
};

// 初回ロード：/sources を取得
(async function loadSources(){
  try{
    const res = await fetch('/sources');
    const data = await res.json();
    renderSourcesMenu(data.sources||[]);
  }catch(e){ console.error(e); }
})();

/* ===== Search ===== */
async function doSearch(){
  const q = $('#q').value.trim();
  const size = Math.max(1, Math.min(200, Number($('#size').value)||20));
  const minp = $('#s_minprio').value === '' ? null : Number($('#s_minprio').value);
  if(!q){ $('#searchStatus').textContent = '検索語を入力'; return; }
  $('#searchStatus').textContent = '検索中…';

  const url = new URL('/search', location.origin);
  url.searchParams.set('q', q);
  url.searchParams.set('size', String(size));
  url.searchParams.set('max_len', '240');
  if(minp !== null) url.searchParams.set('min_priority', String(minp));
  for(const s of SELECTED_SOURCES){ url.searchParams.append('sources', s); }

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
      `<td><code>${highlightHtml(r.en||'', q)}</code><div class="meta">${escapeHtml(r.source||'')}</div></td>`+
      `<td>${highlightHtml(r.ja||'', q)}<div class="meta">${r.priority??''}</div></td>`+
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
  const top_k = Math.max(1, Math.min(10, Number($('#topk').value)||3));
  const max_len = Math.max(0, Number($('#maxlen').value)||0);
  const exact = $('#exact').checked;
  const word_boundary = $('#wb').checked;
  const min_priority = $('#minprio').value === '' ? null : Number($('#minprio').value);
  const sources = [...SELECTED_SOURCES];

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
      const p = cands[i]; // [en, ja, source, priority]
      if(p){
        const en = snippetAround(r.term, p[0]); const ja = snippetAround(r.term, p[1]);
        const src = p[2] || ''; const pr  = (p[3] ?? '') === '' ? '' : String(p[3]);
        td.innerHTML =
          `<div><code>${highlightHtml(en, r.term)}</code></div>`+
          `<div>${highlightHtml(ja, r.term)}</div>`+
          `<div class="meta">${escapeHtml(src)}${pr!=='' ? ' / prio '+pr : ''}</div>`;
      }
      tr.appendChild(td);
    }
    tb.appendChild(tr);
  }
  t.hidden = rows.length===0;
}
$('#btnRun').onclick = runQuery;

function toJSONL(rows){ return rows.map(r=>JSON.stringify(r)).join('\n'); }
function toTSV(rows, topk = Math.max(1, Number($('#topk').value)||3)){
  const head=['term']; for(let i=1;i<=topk;i++){ head.push(`EN${i}`,`JA${i}`,`SRC${i}`,`PRIO${i}`); }
  const body=(rows||[]).map(r=>{
    const flat=[]; for(let i=0;i<topk;i++){
      const p=(r.candidates||[])[i]||['','','','']; flat.push(p[0]||'', p[1]||'', p[2]||'', (p[3]??''));
    }
    return [r.term, ...flat].join('\t');
  });
  return [head.join('\t'),...body].join('\n');
}
function toCSV(rows, topk = Math.max(1, Number($('#topk').value)||3)){
  const esc=(s)=> `"${String(s).replace(/"/g,'""')}"`;
  const head=['term']; for(let i=1;i<=topk;i++){ head.push(`EN${i}`,`JA${i}`,`SRC${i}`,`PRIO${i}`); }
  const body=(rows||[]).map(r=>{
    const flat=[]; for(let i=0;i<topk;i++){
      const p=(r.candidates||[])[i]||['','','','']; flat.push(p[0]||'', p[1]||'', p[2]||'', (p[3]??''));
    }
    return [r.term, ...flat].map(esc).join(',');
  });
  return [head.map(esc).join(','), ...body].join('\n');
}
$('#copyJSONL').onclick = ()=>{ if(window._lastQuery){ navigator.clipboard.writeText(toJSONL(window._lastQuery)); $('#queryStatus').textContent='JSONLコピー完了'; } };
$('#copyTSV').onclick   = ()=>{ if(window._lastQuery){ navigator.clipboard.writeText(toTSV(window._lastQuery));   $('#queryStatus').textContent='TSVコピー完了';   } };
$('#dlJSONL').onclick   = ()=>{ if(window._lastQuery){ downloadText('query_export.jsonl', toJSONL(window._lastQuery), 'application/json'); } };
$('#dlTSV').onclick     = ()=>{ if(window._lastQuery){ downloadText('query_export.tsv',   toTSV(window._lastQuery),   'text/tab-separated-values'); } };
$('#dlCSV').onclick     = ()=>{ if(window._lastQuery){ downloadText('query_export.csv',   toCSV(window._lastQuery),   'text/csv'); } };

/* ===== Import (XML) ===== */
$('#btnXML').onclick = async ()=>{
  const en = $('#xmlEN').files[0];
  const ja = $('#xmlJA').files[0];
  const srcEN = $('#srcEN').value.trim() || 'Loca EN';
  const srcJA = $('#srcJA').value.trim() || 'Loca JP';
  const prio = Number($('#prioXML').value)||100;
  if(!en || !ja){ $('#importStatus').textContent='EN/JAのXMLを選んでください'; return; }
  $('#importStatus').textContent='インポート中…（サイズにより時間がかかります）';

  const fd = new FormData();
  fd.append('enfile', en);
  fd.append('jafile', ja);
  fd.append('src_en', srcEN);
  fd.append('src_ja', srcJA);
  fd.append('priority', String(prio));

  try{
    const res = await fetch('/import/xml', {method:'POST', body: fd});
    const data = await res.json();
    $('#importStatus').textContent = `取り込み完了：${data.inserted} 行（source=${data.source_name}）`;
    // ソース一覧を更新
    const srcRes = await fetch('/sources'); const srcData = await srcRes.json();
    renderSourcesMenu(srcData.sources||[]);
  }catch(e){
    console.error(e);
    $('#importStatus').textContent = 'エラー：インポートに失敗しました';
  }
};
