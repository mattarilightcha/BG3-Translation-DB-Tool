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
  const ids = ['search','query','import','prompts'];
  for(const x of ids){
    $('#panel-'+x).hidden = (x!==id);
    $('#tab-'+x).setAttribute('aria-selected', String(x===id));
  }
}
$('#tab-search').onclick  = ()=>showTab('search');
$('#tab-query').onclick   = ()=>showTab('query');
$('#tab-import').onclick  = ()=>showTab('import');
$('#tab-prompts').onclick = ()=>showTab('prompts');
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
    const size = Math.max(1, Math.min(200, Number($('#size').value)||20));
    const minp = $('#s_minprio').value === '' ? null : Number($('#s_minprio').value);
    if(!q){ $('#searchStatus').textContent = '検索語を入力'; return; }
    $('#searchStatus').textContent = '検索中…';

    const url = new URL('/search', location.origin);
    url.searchParams.set('q', q);
    url.searchParams.set('size', String(size));
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
    renderSearchTable(data.items||[], q);
    $('#searchStatus').textContent = `表示 ${data.items?.length||0}`;
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

  btn.onclick = async ()=>{
    const en = $('#xmlEN').files[0];
    const ja = $('#xmlJA').files[0];
    const srcEN = $('#srcEN').value || 'Loca EN';
    const srcJA = $('#srcJA').value || 'Loca JP';
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
