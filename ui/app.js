// ===== Utilities =====
const $  = (s)=>document.querySelector(s);
const $$ = (s)=>Array.from(document.querySelectorAll(s));

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

function escapeHtml(s){ return String(s??'').replace(/[&<>"']/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m])); }
function escReg(s){ return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
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

// ===== Tabs =====
function showTab(id){
  const ids = ['search','query','import','prompts','compare','matcher'];
  for(const x of ids){
    $('#panel-'+x).hidden = (x!==id);
    $('#tab-'+x).setAttribute('aria-selected', String(x===id));
  }
}
$('#tab-search').onclick  = ()=>showTab('search');
$('#tab-query').onclick   = ()=>showTab('query');
$('#tab-import').onclick  = ()=>showTab('import');
$('#tab-prompts').onclick = ()=>showTab('prompts');
$('#tab-compare').onclick = ()=>showTab('compare');
$('#tab-matcher').onclick = ()=>showTab('matcher');
showTab('query'); // default
$('#managePrompts').onclick = ()=>showTab('prompts');

// ===== Root: Source multiselect =====
let SELECTED_SOURCES = new Set();

function renderSourcesMenu(list){
  const saved = JSON.parse(localStorage.getItem('tdb-sources')||'[]');
  const namesNow = new Set(list.map(x=>x.name));
  const restored = saved.filter(s=>namesNow.has(s));
  SELECTED_SOURCES = new Set(restored);

  const box = $('#srcList'); if(!box) return;
  box.innerHTML = '';

  for (const s of list){
    const id = 'src_' + btoa(encodeURIComponent(s.name)).replace(/=+$/,'');
    const row = document.createElement('div');

    row.innerHTML = `
      <label for="${id}">
        <span title="${escapeHtml(s.name)}">${escapeHtml(s.name||'(empty)')}</span>
        <span class="count">${s.count}</span>
      </label>
      <div class="right">
        <button class="btn-icon danger" data-del="${escapeHtml(s.name)}" title="このソースを削除">🗑</button>
      </div>`;

    const input = document.createElement('input');
    input.type='checkbox'; input.id=id; input.value=s.name;
    input.checked = (SELECTED_SOURCES.size===0) ? true : SELECTED_SOURCES.has(s.name);
    input.style.marginRight='8px';
    row.querySelector('label').prepend(input);

    box.appendChild(row);
  }

  // 削除（イベント委譲）
  box.onclick = async (e)=>{
    const btn = e.target.closest('button[data-del]');
    if(!btn) return;
    const name = btn.getAttribute('data-del');
    if(!confirm(`source="${name}" を削除します。よろしいですか？`)) return;

    try{
      const res = await fetch('/sources/' + encodeURIComponent(name), { method:'DELETE' });
      const payload = await res.json();
      console.log('[SOURCES] deleted:', payload);
      // 再読込
      const sres = await fetch('/sources'); const sdata = await sres.json();
      renderSourcesMenu(sdata.sources||[]);
      updateSourceSummary();
      $('#srcSummary').textContent = `削除しました: ${name}`;
    }catch(err){
      console.error(err);
      alert('削除に失敗しました（詳細はConsole参照）');
    }
  };

  const now = getCheckedSourcesNow();
  SELECTED_SOURCES = new Set(now);
  updateSourceSummary();
}


function getCheckedSourcesNow(){
  const inputs = [...document.querySelectorAll('#srcList input[type=checkbox]')];
  const checked = inputs.filter(i=>i.checked).map(i=>i.value);
  return checked; // 0件=全ソース扱い（サーバ側で未指定）
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
  SELECTED_SOURCES = new Set();
  [...$('#srcList').querySelectorAll('input[type=checkbox]')].forEach(c=>c.checked=false);
};
$('#srcApply').onclick = ()=>{
  const checked = [...$('#srcList').querySelectorAll('input[type=checkbox]:checked')].map(c=>c.value);
  SELECTED_SOURCES = new Set(checked);
  updateSourceSummary();
  $('#srcMenu').hidden = true;
};
(async function loadSources(){
  try{
    const res = await fetch('/sources'); const data = await res.json();
    renderSourcesMenu(data.sources||[]);
  }catch(e){ console.error(e); }
})();

// ===== Prompts =====
const PROMPTS_KEY = 'tdb-prompts';
const PROMPT_ACTIVE_KEY = 'tdb-prompt-active';

function loadPrompts(){
  let arr = [];
  try{ arr = JSON.parse(localStorage.getItem(PROMPTS_KEY) || '[]'); }catch{}
  if(!arr.length){
    arr = [
      { id:'p1', name:'Gemini翻訳補助（最小）', body:
`以下は候補辞書（TSV）です。優先して一致を参照し、固有名詞は統一してください。
出力は原文の文意を尊重しつつ自然な日本語に。辞書に該当が無い場合のみ推測可。` },
      { id:'p2', name:'用語固定・丁寧口調', body:
`候補辞書を最優先で採用。既出用語は徹底して統一。
文体は「です・ます」。意訳し過ぎず、ゲームのUIに収まる簡潔さを重視。` }
    ];
    savePrompts(arr);
    localStorage.setItem(PROMPT_ACTIVE_KEY, 'p1');
  }
  return arr;
}
function savePrompts(arr){ localStorage.setItem(PROMPTS_KEY, JSON.stringify(arr)); }
function activePromptId(){ return localStorage.getItem(PROMPT_ACTIVE_KEY) || (loadPrompts()[0]?.id || ''); }
function setActivePrompt(id){ localStorage.setItem(PROMPT_ACTIVE_KEY, id); renderPromptSelect(); renderPromptList(); }
function getPromptById(id){ return loadPrompts().find(p=>p.id===id) || null; }
function renderPromptSelect(){
  const sel = $('#promptSelect'); if(!sel) return;
  const arr = loadPrompts(); const act = activePromptId();
  sel.innerHTML = arr.map(p=>`<option value="${p.id}" ${p.id===act?'selected':''}>${escapeHtml(p.name)}</option>`).join('');
}
function renderPromptList(){
  const ul = $('#promptsUl'); if(!ul) return; ul.innerHTML = '';
  const arr = loadPrompts(); const act = activePromptId();
  for(const p of arr){
    const li = document.createElement('li');
    li.innerHTML = `<span>${escapeHtml(p.name)}</span><span class="meta">${p.id===act?'既定':''}</span>`;
    li.onclick = ()=>{
      $('#pName').value = p.name;
      $('#pBody').value = p.body;
      $('#setDefault').onclick = ()=> setActivePrompt(p.id);
      $('#savePrompt').onclick = ()=> {
        const updated = loadPrompts().map(x=> x.id===p.id ? ({...x, name:$('#pName').value.trim()||x.name, body:$('#pBody').value}) : x );
        savePrompts(updated); renderPromptList(); renderPromptSelect();
      };
      $('#deletePrompt').onclick = ()=> {
        const left = loadPrompts().filter(x=>x.id!==p.id);
        savePrompts(left);
        if(activePromptId()===p.id && left.length){ setActivePrompt(left[0].id); }
        renderPromptList(); renderPromptSelect();
        $('#pName').value=''; $('#pBody').value='';
      };
    };
    ul.appendChild(li);
  }
}
$('#newPrompt').onclick = ()=>{
  const id = 'p' + Date.now();
  const arr = loadPrompts();
  arr.unshift({id, name:'新しいプロンプト', body:''});
  savePrompts(arr); setActivePrompt(id);
  $('#pName').value='新しいプロンプト'; $('#pBody').value='';
  renderPromptList(); renderPromptSelect(); showTab('prompts');
};
renderPromptSelect(); renderPromptList();
$('#promptSelect').onchange = (e)=> setActivePrompt(e.target.value);

// ===== Search =====
async function doSearch(){
  try{
    const q = $('#q').value.trim();
    const size = Math.max(1, Math.min(10000, Number($('#size').value)||20));
    const page = Math.max(1, Number($('#page')?.value)||1);
    const minp = $('#s_minprio').value === '' ? null : Number($('#s_minprio').value);
    const hideDup = $('#hideDup')?.checked === true;
    if(!q){ $('#searchStatus').textContent = '検索語を入力'; return; }
    $('#searchStatus').textContent = '検索中…';

    const url = new URL('/search', location.origin);
    url.searchParams.set('q', q);
    url.searchParams.set('size', String(size));
    url.searchParams.set('page', String(page));
    url.searchParams.set('max_len', '0'); // 編集前提でフル本文
    if(minp !== null) url.searchParams.set('min_priority', String(minp));

    const activeSources = getCheckedSourcesNow();
    activeSources.forEach(s => url.searchParams.append('sources', s));

    console.log('[SEARCH] url=', url.toString(), 'sources=', activeSources);

    const res = await fetch(url);
    if(!res.ok){
      const dt = await res.text();
      console.error('[SEARCH] http error', res.status, dt);
      $('#searchStatus').textContent = `検索エラー: HTTP ${res.status}`;
      return;
    }
    const data = await res.json();
    let items = data.items||[];
    if(hideDup){
      const seen = new Set();
      const norm = (s)=> String(s||'').toLowerCase();
      items = items.filter(r=>{
        const key = norm(r.en)+"\u0000"+norm(r.ja);
        if(seen.has(key)) return false;
        seen.add(key); return true;
      });
    }
    renderSearchTable(items, q);
    $('#searchStatus').textContent = `表示 ${items.length} 件 (page=${page}, size=${size}${hideDup?', 重複除外':''})`;
  }catch(err){
    console.error(err);
    $('#searchStatus').textContent = '検索エラー（Console参照）';
  }
}
function searchRowView(r, q){
  return `
    <td>${r.id}</td>
    <td class="col-en"><code>${highlightHtml(r.en||'', q)}</code></td>
    <td class="col-ja">${highlightHtml(r.ja||'', q)}</td>
    <td class="col-src">${escapeHtml(r.source||'')}</td>
    <td class="col-pri">${r.priority??''}</td>
    <td>${Number(r.score).toFixed(2)}</td>
    <td class="ops"><div class="btn-row">
      <button class="btn-sm btn-edit">編集</button>
    </div></td>`;
}
function searchRowEdit(r){
  return `
    <td>${r.id}</td>
    <td class="col-en"><textarea class="edit-en">${escapeHtml(r.en||'')}</textarea></td>
    <td class="col-ja"><textarea class="edit-ja">${escapeHtml(r.ja||'')}</textarea></td>
    <td class="col-src"><input type="text" class="edit-src" value="${escapeHtml(r.source||'')}"></td>
    <td class="col-pri"><input type="number" class="edit-pri" value="${r.priority??''}"></td>
    <td>${Number(r.score).toFixed(2)}</td>
    <td class="ops"><div class="btn-row">
      <button class="btn-sm btn-save primary">保存</button>
      <button class="btn-sm btn-cancel">取消</button>
    </div></td>`;
}
function renderSearchTable(items, q){
  const t = $('#searchTable'); const tb = t.tBodies[0]; tb.innerHTML = '';
  for(const r of items){
    const tr = document.createElement('tr');
    tr.dataset.id = r.id; tr.dataset.q = q; tr.dataset.mode = 'view';
    tr._data = r;
    tr.innerHTML = searchRowView(r, q);
    tb.appendChild(tr);
  }
  t.hidden = items.length===0;
}
async function onSearchTableClick(e){
  const btn = e.target.closest('button'); if(!btn) return;
  const tr = e.target.closest('tr'); if(!tr) return;
  const r = tr._data;

  if(btn.classList.contains('btn-edit')){
    tr.dataset.mode = 'edit';
    try{
      const res = await fetch(`/entry/${r.id}`); const full = await res.json();
      if(full && !full.error){
        r.en = full.en_text; r.ja = full.ja_text; r.source = full.source_name; r.priority = full.priority;
      }
    }catch{}
    tr.innerHTML = searchRowEdit(r);
  }

  if(btn.classList.contains('btn-cancel')){
    tr.dataset.mode = 'view';
    tr.innerHTML = searchRowView(r, tr.dataset.q);
  }

  if(btn.classList.contains('btn-save')){
    const payload = {
      en_text: tr.querySelector('.edit-en').value,
      ja_text: tr.querySelector('.edit-ja').value,
      source_name: tr.querySelector('.edit-src').value,
      priority: tr.querySelector('.edit-pri').value==='' ? null : Number(tr.querySelector('.edit-pri').value),
    };
    btn.disabled = true;
    try{
      const res = await fetch(`/entry/${r.id}`, {method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload)});
      const upd = await res.json();
      if(upd && !upd.error){
        r.en = upd.en_text; r.ja = upd.ja_text; r.source = upd.source_name; r.priority = upd.priority;
        tr.dataset.mode='view';
        tr.innerHTML = searchRowView(r, tr.dataset.q);
        $('#searchStatus').textContent = `保存しました (id=${r.id})`;
      }else{
        $('#searchStatus').textContent = `保存に失敗しました`;
      }
    }catch(err){
      console.error(err);
      $('#searchStatus').textContent = `保存エラー`;
    }finally{
      btn.disabled = false;
    }
  }
}
function onSearchTableKeydown(e){
  const tr = e.target.closest('tr'); if(!tr) return;
  if(tr.dataset.mode!=='edit') return;
  if((e.ctrlKey || e.metaKey) && e.key.toLowerCase()==='s'){ e.preventDefault(); tr.querySelector('.btn-save')?.click(); }
}
function initSearchBindings(){
  $('#btnSearch')?.addEventListener('click', doSearch);
  $('#q')?.addEventListener('keydown', e=>{ if(e.key==='Enter') doSearch(); });
  $('#copyTable')?.addEventListener('click', ()=>{
    const rows = [...document.querySelectorAll('#searchTable tbody tr')].map(tr => [...tr.cells].map(td => td.innerText));
    if(!rows.length) return;
    const tsv = ['ID\tEN\tJA\tsource\tprio\tscore', ...rows.map(r => r.join('\t'))].join('\n');
    navigator.clipboard.writeText(tsv);
  });
  $('#searchTable')?.addEventListener('click', onSearchTableClick);
  $('#searchTable')?.addEventListener('keydown', onSearchTableKeydown);
}
initSearchBindings();

// ===== Import (XML) =====
function initImportBindings(){
  const btn = $('#btnXML'); const st  = $('#importStatus');
  if(!btn) return;

  // ソース名をファイル名から自動生成
  function autoFillSourceNames(){
    try{
      const en = $('#xmlEN').files?.[0]?.name || '';
      const ja = $('#xmlJA').files?.[0]?.name || '';
      if(en){ const base=en.replace(/\.xml$/i,''); $('#srcEN').value = `${base}_Loca EN`; }
      if(ja){ const base=ja.replace(/\.xml$/i,''); $('#srcJA').value = `${base}_Loca JP`; }
    }catch{}
  }
  $('#xmlEN')?.addEventListener('change', autoFillSourceNames);
  $('#xmlJA')?.addEventListener('change', autoFillSourceNames);

  btn.onclick = async ()=>{
    const en = $('#xmlEN').files[0];
    const ja = $('#xmlJA').files[0];
    const srcEN = $('#srcEN').value || (en?.name||'').replace(/\.xml$/i,'') + ' Loca EN';
    const srcJA = $('#srcJA').value || (ja?.name||'').replace(/\.xml$/i,'') + ' Loca JP';
    const prio  = $('#prioXML').value || '100';
    const strict = $('#strict').checked;           // 追加：UIから取得
    const replace_src = $('#replace_src').checked; // 追加：UIから取得

    if(!en || !ja){
      st.textContent = 'EN/JA の XML を選択してください';
      st.className = 'status error';
      return;
    }

    const fd = new FormData();
    fd.append('enfile', en);
    fd.append('jafile', ja);
    fd.append('src_en', srcEN);
    fd.append('src_ja', srcJA);
    fd.append('priority', prio);
    fd.append('strict', String(strict));
    fd.append('replace_src', String(replace_src));

    st.textContent = `アップロード中… (${en.name}, ${ja.name})`;
    st.className = 'status';
    console.log('[IMPORT/XML] start', {en:en.name,sizeEN:en.size, ja:ja.name,sizeJA:ja.size, srcEN, srcJA, prio, strict, replace_src});

    try{
      const res = await fetch('/import/xml', { method:'POST', body: fd });

      if (!res.ok) {
        const text = await res.text(); // ★一度だけ読む
        let detail = text;
        try {
          const j = JSON.parse(text);
          detail = (j && j.detail !== undefined) ? j.detail : j;
        } catch {}
        console.error('[IMPORT/XML] HTTP error', res.status, detail);
        const msg = (typeof detail === 'string') ? detail : JSON.stringify(detail, null, 2);
        st.textContent = `エラー: ${msg}`;
        st.className = 'status error';
        return;
      }

      const data = await res.json();
      console.log('[IMPORT/XML] done', data);

      const extra = data.stats
        ? ` / EN_valid=${data.stats.en_valid}, JA_valid=${data.stats.ja_valid}, 共通=${data.stats.common}, strict=${data.strict}`
        : '';
      st.textContent = `取り込み完了: ${data.inserted} 行 (source=${data.source_name})${extra}`;
      st.className = 'status ok';

      // フィルタのソース一覧を更新
      try{
        const sres = await fetch('/sources');
        const sdata = await sres.json();
        renderSourcesMenu(sdata.sources || []);
      }catch(e){ console.warn('sources refresh failed', e); }

    }catch(err){
      console.error('[IMPORT/XML] fetch error', err);
      st.textContent = `エラー: ${err.message}`;
      st.className = 'status error';
    }
  };
}
initImportBindings();

// ===== Query =====
async function runQuery(){
  const lines = $('#terms').value.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  const top_k = Math.max(1, Math.min(10, Number($('#topk').value)||3));
  const max_len = Math.max(0, Number($('#maxlen').value)||0);
  const exact = $('#exact').checked;
  const word_boundary = $('#wb').checked;
  const min_priority = $('#minprio').value === '' ? null : Number($('#minprio').value);
  const sources = getCheckedSourcesNow();

  if(!lines.length){ $('#queryStatus').textContent='語を入力'; return; }
  $('#queryStatus').textContent='照会中…';

  console.log('[QUERY] lines=', lines.length, 'sources=', sources);

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
  const tb = t.tBodies[0]; tb.innerHTML = '';
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
      }else{
        td.innerHTML = '<span class="muted">—</span>';
      }
      tr.appendChild(td);
    }
    tb.appendChild(tr);
  }
  t.hidden = rows.length===0;
}
$('#btnRun').onclick = runQuery;

// ===== Exports with Prompt =====
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
function activePrompt(){ const id = localStorage.getItem('tdb-prompt-active')||''; return getPromptById(id); }
function buildWithPrompt(rawText, kind){
  if(!$('#includePrompt').checked) return rawText;
  const p = activePrompt(); if(!p) return rawText;
  if(kind==='jsonl'){
    const meta = JSON.stringify({type:'prompt', name:p.name, prompt:p.body});
    return meta + '\n' + rawText;
  }
  return `${p.name}\n${p.body}\n\n${rawText}`;
}
$('#copyJSONL').onclick = ()=>{ if(!window._lastQuery) return;
  const txt = buildWithPrompt(toJSONL(window._lastQuery), 'jsonl');
  navigator.clipboard.writeText(txt); $('#queryStatus').textContent='JSONLコピー完了';
};
$('#copyTSV').onclick = ()=>{ if(!window._lastQuery) return;
  const txt = buildWithPrompt(toTSV(window._lastQuery), 'tsv');
  navigator.clipboard.writeText(txt); $('#queryStatus').textContent='TSVコピー完了';
};
$('#dlJSONL').onclick = ()=>{ if(!window._lastQuery) return;
  const txt = buildWithPrompt(toJSONL(window._lastQuery), 'jsonl');
  downloadText('query_export.jsonl', txt, 'application/json');
};
$('#dlTSV').onclick = ()=>{ if(!window._lastQuery) return;
  const txt = buildWithPrompt(toTSV(window._lastQuery), 'tsv');
  downloadText('query_export.tsv', txt, 'text/tab-separated-values');
};
$('#dlCSV').onclick = ()=>{ if(!window._lastQuery) return;
  const txt = buildWithPrompt(toCSV(window._lastQuery), 'csv');
  downloadText('query_export.csv', txt, 'text/csv');
};

// ===== Compare (XML diff) =====
function parseLocaXmlInline(xmlText){
  const result = new Map(); // uid -> { text, version, raw }
  if(!xmlText || !xmlText.trim()) return result;
  try{
    // 高速・寛容な抽出：<content ...contentuid="..." ... version="..."> ... </content>
    const re = /<content\b[^>]*?contentuid\s*=\s*"([^"]+)"[^>]*?(?:version\s*=\s*"(\d+)")?[^>]*>([\s\S]*?)<\/content>/gi;
    let m;
    while((m = re.exec(xmlText))){
      const uid = m[1];
      const ver = m[2] ? Number(m[2]) : null;
      const inner = m[3]||'';
      // テキスト抽出（簡易）：タグ除去 → 連続空白を1つに
      const text = inner.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      result.set(uid, { text, version: ver, raw: m[0] });
    }
  }catch(err){ console.warn('[COMPARE] parse error', err); }
  return result;
}

function normalizeForCompare(text){
  if(text == null) return '';
  return String(text).replace(/\s+/g,' ').trim();
}

function compareXmlMaps(mapEn, mapJa){
  const allUids = new Set([...mapEn.keys(), ...mapJa.keys()]);
  const diffs = [];
  for(const uid of allUids){
    const en = mapEn.get(uid) || { text:'', version:null };
    const ja = mapJa.get(uid) || { text:'', version:null };
    const enNorm = normalizeForCompare(en.text);
    const jaNorm = normalizeForCompare(ja.text);
    let status;
    if(!mapEn.has(uid)){
      status = 'ENなし';
    }else if(!mapJa.has(uid)){
      status = 'JAなし';
    }else if(enNorm === jaNorm){
      // 本文一致だが version が異なるかを追加判定
      if(en.version !== ja.version && en.version != null && ja.version != null){
        status = 'version差異';
      }else{
        status = '一致';
      }
    }else{
      status = '本文差異';
    }
    const same_as_en = (status==='一致') && (enNorm !== '') && (enNorm === jaNorm);
    diffs.push({ uid, status, en: en.text, ja: ja.text, ver_en: en.version, ver_ja: ja.version, same_as_en });
  }
  return diffs;
}

function renderCompareTable(rows){
  const wrap = $('#compareResult'); if(!wrap) return;
  if(!rows.length){ wrap.innerHTML = '<div class="hint">結果なし</div>'; return; }
  const esc = escapeHtml;
  const buildRow = (r)=> {
    const klass = r.status==='一致' ? (r.same_as_en ? 'same' : 'ok') : (r.status.includes('なし') ? 'warn' : 'diff');
    const verAttr = (v)=> (v===null || v===undefined || v==='') ? '' : ` version="${v}"`;
    const xmlRaw = `<content contentuid="${r.uid}"${verAttr(r.ver_en)}>${r.en||''}</content>`;
    const xml = `<code class=\"language-xml\">${escapeHtml(xmlRaw)}</code>`;
    const notes = [];
    if(r.ver_en!==undefined) notes.push(`verEN=${escapeHtml(String(r.ver_en??''))}`);
    if(r.ver_ja!==undefined) notes.push(`verJA=${escapeHtml(String(r.ver_ja??''))}`);
    const jaPrev = (r.ja||'').slice(0, 120);
    if(jaPrev) notes.push(`JAプレビュー: ${escapeHtml(jaPrev)}`);
    const note = notes.join(' / ');
    return `
    <tr class="${klass}">
      <td class="col-code"><pre class="codebox">${xml}</pre></td>
      <td class="col-status">${escapeHtml(r.status)}</td>
      <td class="col-notes">${note||'<span class=\"muted\">—</span>'}</td>
    </tr>`;
  };
  wrap.innerHTML = `
    <table class="table">
      <thead>
        <tr>
          <th>原文</th>
          <th style="width:120px">状態</th>
          <th style="width:28%">備考</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map(buildRow).join('')}
      </tbody>
    </table>`;
  try{ if(window.Prism){ Prism.highlightAllUnder(wrap); } }catch{}
}

function initCompareBindings(){
  const btn = $('#btnCompare'); const st = $('#compareStatus');
  if(!btn) return;
  // 全幅切替
  $('#toggleWide')?.addEventListener('click', ()=>{
    const isWide = document.body.classList.toggle('wide');
    localStorage.setItem('tdb-wide', isWide ? '1' : '');
  });
  // 復元
  (function restoreWide(){ try{ if(localStorage.getItem('tdb-wide')) document.body.classList.add('wide'); }catch{} })();
  function extractXmlWrapper(xmlText){
    const text = String(xmlText||'');
    const decl = (text.match(/^\s*<\?xml[\s\S]*?\?>/i)||[])[0] || '';
    const open = (text.match(/<contentList\b[^>]*>/i)||[])[0] || '';
    const close = /<\/contentList>/i.test(text) ? '</contentList>' : (open ? '</contentList>' : '');
    return { decl, openTag: open, closeTag: close };
  }
  btn.onclick = ()=>{
    const enText = $('#cmpEN').value || '';
    const jaText = $('#cmpJA').value || '';
    const mode = $('#cmpMode')?.value || 'align';
    st.textContent = '解析・比較中…'; st.className = 'status';
    setTimeout(()=>{
      const mapEn = parseLocaXmlInline(enText);
      const mapJa = parseLocaXmlInline(jaText);
      let diffs = compareXmlMaps(mapEn, mapJa);
      if(mode==='align'){
        // EN順（英語のUID順）で表示。JA欠落はwarnで可視化
        diffs = diffs.filter(d=> mapEn.has(d.uid));
        const enUids = [...mapEn.keys()];
        const map = new Map(diffs.map(d=>[d.uid,d]));
        diffs = enUids.map(uid=> map.get(uid) || { uid, status:'JAなし', en: mapEn.get(uid)?.text||'', ja:'', ver_en: mapEn.get(uid)?.version??'', ver_ja:'' });
      }else{
        // まとめ表示：差異→片側なし→一致 の順
        const order = { '本文差異':0, 'version差異':0, 'ENなし':1, 'JAなし':2, '一致':3 };
        diffs.sort((a,b)=> (order[a.status]-order[b.status]) || (a.uid<b.uid?-1:a.uid>b.uid?1:0));
      }
      renderCompareTable(diffs);
      const counts = {
        total: diffs.length,
        eq: diffs.filter(d=>d.status==='一致').length,
        enMiss: diffs.filter(d=>d.status==='ENなし').length,
        jaMiss: diffs.filter(d=>d.status==='JAなし').length,
        diff: diffs.filter(d=>d.status==='本文差異' || d.status==='version差異').length,
      };
      st.textContent = `総数 ${counts.total} / 一致 ${counts.eq} / 差異 ${counts.diff} / ENなし ${counts.enMiss} / JAなし ${counts.jaMiss}`;
    }, 10);
  };
  $('#btnFormatJA')?.addEventListener('click', ()=>{
    const enText = $('#cmpEN').value || '';
    const jaText = $('#cmpJA').value || '';
    const mapEn = parseLocaXmlInline(enText);
    const mapJa = parseLocaXmlInline(jaText);
    const enUids = [...mapEn.keys()];
    const piece = (uid)=>{
      const it = mapJa.get(uid);
      if(!it) return `<!-- missing: ${uid} -->`;
      if(it.raw) return it.raw.trim();
      const ver = it.version==null? '' : ` version="${it.version}"`;
      const body = escapeHtml(it.text||'');
      return `<content contentuid="${uid}"${ver}>${body}</content>`;
    };
    const formatted = enUids.map(piece).join('\n');
    const wrap = extractXmlWrapper(enText);
    const wrapped = `${wrap.decl?wrap.decl+'\n':''}${wrap.openTag||'<contentList>'}\n${formatted}\n${wrap.closeTag}`;
    $('#cmpJA').value = wrapped;
    st.textContent = `JAをEN順（${enUids.length}件）に整形しました。`;
    updateHighlight();
  });
  $('#btnPrettyJA')?.addEventListener('click', ()=>{
    const jaText = $('#cmpJA').value || '';
    const mapJa = parseLocaXmlInline(jaText);
    // 出現順を維持
    const order = [];
    const re = /<content\b[^>]*?contentuid\s*=\s*"([^"]+)"[^>]*>([\s\S]*?)<\/content>/gi;
    let m; while((m = re.exec(jaText))){ order.push(m[1]); }
    const piece = (uid)=>{
      const it = mapJa.get(uid);
      if(!it) return `<!-- missing: ${uid} -->`;
      return (it.raw||'').trim();
    };
    const formatted = order.map(piece).join('\n');
    $('#cmpJA').value = formatted;
    st.textContent = `JAを整形しました（順序維持、${order.length}件）。`;
  });
  $('#btnFillJAFromEN')?.addEventListener('click', ()=>{
    const enText = $('#cmpEN').value || '';
    const jaText = $('#cmpJA').value || '';
    const mapEn = parseLocaXmlInline(enText);
    const mapJa = parseLocaXmlInline(jaText);
    const enUids = [...mapEn.keys()];
    const piece = (uid)=>{
      const it = mapJa.get(uid);
      if(it && it.raw) return it.raw.trim();
      const en = mapEn.get(uid);
      if(!en) return `<!-- missing: ${uid} -->`;
      if(en.raw) return String(en.raw||'').trim();
      const ver = (en.version===null || en.version===undefined || en.version==='') ? '' : ` version="${en.version}"`;
      const body = escapeHtml(en.text||'');
      return `<content contentuid="${uid}"${ver}>${body}</content>`;
    };
    const filled = enUids.map(piece).join('\n');
    const wrapInfo = extractXmlWrapper(enText);
    const wrapped = `${wrapInfo.decl?wrapInfo.decl+'\n':''}${wrapInfo.openTag||'<contentList>'}\n${filled}\n${wrapInfo.closeTag}`;
    $('#cmpJA').value = wrapped;
    $('#compareStatus').textContent = `JA欠落をENで補完しました（${enUids.length}件）。`;
    // 再描画して補完行をハイライト
    setTimeout(()=>{
      const diffs = compareXmlMaps(parseLocaXmlInline($('#cmpEN').value||''), parseLocaXmlInline($('#cmpJA').value||''));
      renderCompareTable(diffs);
      const tbody = document.querySelector('#compareResult tbody');
      if(tbody){
        [...tbody.rows].forEach(row=>{
          const text = row.querySelector('.codebox')?.textContent||'';
          if(text){ row.classList.add('filled-from-en'); }
        });
      }
    }, 0);
  });
  $('#btnClearCompare')?.addEventListener('click', ()=>{ $('#cmpEN').value=''; $('#cmpJA').value=''; $('#compareResult').innerHTML=''; st.textContent=''; });
  $('#btnCopyNoJA')?.addEventListener('click', ()=>{
    try{
      const tbody = document.querySelector('#compareResult tbody'); if(!tbody) return;
      const rows = [...tbody.rows];
      const texts = rows.filter(r=>/JAなし/.test(r.querySelector('.col-status')?.textContent||''))
        .map(r=> (r.querySelector('.codebox')?.innerText||'').replace(/\n+/g,'\n').trim())
        .filter(Boolean);
      if(!texts.length){ alert('JAなしの行はありません'); return; }
      const out = texts.join('\n');
      navigator.clipboard.writeText(out);
    }catch(e){ alert('コピーに失敗しました: '+e.message); }
  });
}
initCompareBindings();

// ===== Matcher (BG3 MOD↔公式) =====
let MATCH_LAST = { matched_xml:null, unmatched_xml:null, review_csv:null, counts:null };
async function matcherRun(){
  const st = $('#m_status'); st.textContent='送信中…'; st.className='status';
  try{
    const mod = $('#m_modXML').files[0];
    let enDir = ($('#m_enDir').value||'').trim();
    let jaDir = ($('#m_jaDir').value||'').trim();
    const baseDir = ($('#m_baseDir').value||'').trim();
    const fuzzy = $('#m_fuzzy').checked;
    const cutoff = Number($('#m_cutoff').value||0.92);
    const workers = Number($('#m_workers').value||1);
    if(!mod){ st.textContent='MOD XML を選択してください'; st.className='status error'; return; }
    // 自動補完: base_dir が空でも既定の bg3_official を基準に EN/JA を補う
    const baseRoot = baseDir || 'data\\bundles\\bg3_official';
    const sep = (baseRoot.endsWith('\\') || baseRoot.endsWith('/')) ? '' : '\\';
    if(!enDir){ enDir = baseRoot + sep + 'English'; $('#m_enDir').value = enDir; }
    if(!jaDir){ jaDir = baseRoot + sep + 'Japanese'; $('#m_jaDir').value = jaDir; }
    if(!enDir || !jaDir){ st.textContent='EN/JA ディレクトリを入力してください'; st.className='status error'; return; }
    const fd = new FormData();
    fd.append('modfile', mod);
    fd.append('en_dir', enDir);
    fd.append('ja_dir', jaDir);
    if(baseDir) fd.append('base_dir', baseDir);
    localStorage.setItem('tdb-m-en_dir', enDir);
    localStorage.setItem('tdb-m-ja_dir', jaDir);
    localStorage.setItem('tdb-m-base_dir', baseDir);
    fd.append('enable_fuzzy', String(fuzzy));
    fd.append('cutoff', String(cutoff));
    fd.append('workers', String(workers));
    const res = await fetch('/match/bg3', { method:'POST', body: fd });
    if(!res.ok){ const text = await res.text(); st.textContent=`エラー: HTTP ${res.status} ${text}`; st.className='status error'; return; }
    const data = await res.json();
    MATCH_LAST.matched_xml = data.matched_xml || null;
    MATCH_LAST.matched_ja_xml = data.matched_ja_xml || null;
    MATCH_LAST.unmatched_xml = data.unmatched_xml || null;
    MATCH_LAST.review_csv = data.review_csv || null;
    MATCH_LAST.counts = data.counts || null;
    const c = MATCH_LAST.counts||{};
    $('#m_resultInfo').textContent = `完了: JAあり=${c.matched_ja||0} / JAなし=${c.matched_noja||0} / EN未一致=${c.unmatched||0}  (mod=${c.mod||0}, EN=${enDir}, JA=${jaDir})`;
    st.textContent='完了'; st.className='status ok';
  }catch(err){ console.error(err); st.textContent='エラー: '+err.message; st.className='status error'; }
}
function matcherClear(){ $('#m_modXML').value=''; $('#m_enDir').value=''; $('#m_jaDir').value=''; $('#m_status').textContent=''; $('#m_resultInfo').textContent=''; MATCH_LAST={matched_xml:null,unmatched_xml:null,review_csv:null,counts:null}; }
function downloadText(filename, content, mime='text/plain'){
  const blob = new Blob([content], {type: mime + ';charset=utf-8'});
  const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href=url; a.download=filename; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
}
function initMatcherBindings(){
  $('#m_btnRun')?.addEventListener('click', matcherRun);
  $('#m_btnClear')?.addEventListener('click', matcherClear);
  $('#m_dlMatched')?.addEventListener('click', ()=>{ if(!MATCH_LAST.matched_xml){ alert('未生成です'); return; } downloadText('bg3_out_matched_ja.xml', MATCH_LAST.matched_xml, 'application/xml'); });
  $('#m_dlUnmatched')?.addEventListener('click', ()=>{ if(!MATCH_LAST.unmatched_xml){ alert('未生成です'); return; } downloadText('bg3_out_unmatched_src.xml', MATCH_LAST.unmatched_xml, 'application/xml'); });
  $('#m_dlReview')?.addEventListener('click', ()=>{ if(!MATCH_LAST.review_csv){ alert('fuzzy無効では出力されません'); return; } downloadText('bg3_review_pairs.csv', MATCH_LAST.review_csv, 'text/csv'); });
  $('#m_toCompare')?.addEventListener('click', ()=>{
    try{
      const srcLeft = $('#m_modXML')?.files?.[0];
      // 左：MOD原文（アップロードしたXMLを読み込む）
      if(srcLeft){
        const fr = new FileReader();
        fr.onload = ()=>{ $('#cmpEN').value = String(fr.result||''); };
        fr.readAsText(srcLeft, 'utf-8');
      } else if (MATCH_LAST.unmatched_xml){
        // 代替：EN側に unmatched を置く
        $('#cmpEN').value = MATCH_LAST.unmatched_xml;
      }
      // 右：JAありだけ（matched_ja_xml）。無ければ matched 全体
      const right = MATCH_LAST.matched_ja_xml || MATCH_LAST.matched_xml || '';
      $('#cmpJA').value = right;
      showTab('compare');
      // 即比較を実行
      $('#btnCompare')?.click();
    }catch(e){ alert('移行エラー: '+e.message); }
  });
  // フォルダ参照（ローカルピッカー）
  async function pickDir(kind){
    try{
      const res = await fetch('/pick/dir?title=' + encodeURIComponent(kind==='en'?'ENフォルダを選択':'JAフォルダを選択'));
      if(!res.ok){ const t = await res.text(); alert('参照不可: '+t); return; }
      const data = await res.json();
      const p = data.path||''; if(!p) return;
      if(kind==='en'){ $('#m_enDir').value = p; localStorage.setItem('tdb-m-en_dir', p); }
      else { $('#m_jaDir').value = p; localStorage.setItem('tdb-m-ja_dir', p); }
    }catch(e){ alert('参照エラー: '+e.message); }
  }
  $('#m_pickEN')?.addEventListener('click', ()=>pickDir('en'));
  $('#m_pickJA')?.addEventListener('click', ()=>pickDir('ja'));

  // 復元（サーバパス）
  (function restoreMatcherPrefs(){ try{ const en=localStorage.getItem('tdb-m-en_dir')||''; const ja=localStorage.getItem('tdb-m-ja_dir')||''; const base=localStorage.getItem('tdb-m-base_dir')||''; if(en) $('#m_enDir').value=en; if(ja) $('#m_jaDir').value=ja; if(base) $('#m_baseDir').value=base; }catch{} })();
  // 既定パス（未入力時）
  if(!$('#m_enDir').value){ $('#m_enDir').placeholder = $('#m_enDir').placeholder || 'data\\bundles\\bg3_official\\English'; $('#m_enDir').value = 'data\\bundles\\bg3_official\\English'; }
  if(!$('#m_jaDir').value){ $('#m_jaDir').placeholder = $('#m_jaDir').placeholder || 'data\\bundles\\bg3_official\\Japanese'; $('#m_jaDir').value = 'data\\bundles\\bg3_official\\Japanese'; }
}
initMatcherBindings();
