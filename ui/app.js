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
  const ids = ['search','query','import','prompts','compare','matcher','tooltip'];
  for(const x of ids){
    $('#panel-'+x).hidden = (x!==id);
    $('#tab-'+x).setAttribute('aria-selected', String(x===id));
  }
}
$('#tab-search')?.addEventListener('click',  ()=>showTab('search'));
$('#tab-query')?.addEventListener('click',   ()=>showTab('query'));
$('#tab-import')?.addEventListener('click',  ()=>showTab('import'));
$('#tab-prompts')?.addEventListener('click', ()=>showTab('prompts'));
$('#tab-compare')?.addEventListener('click', ()=>showTab('compare'));
$('#tab-matcher')?.addEventListener('click', ()=>showTab('matcher'));
$('#tab-tooltip')?.addEventListener('click', ()=>showTab('tooltip'));
// 予備：nav全体でイベント委譲
document.querySelector('nav.tabs')?.addEventListener('click', (e)=>{
  const btn = e.target.closest('.tab'); if(!btn) return;
  const id = (btn.id||'').replace(/^tab-/, ''); if(!id) return;
  showTab(id);
});
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

// ===== Update notifier =====
(async function checkUpdate(){
  try{
    const res = await fetch('/version');
    if(!res.ok) return;
    const info = await res.json();
    if(info && info.is_outdated){
      let bar = document.querySelector('#updateBar');
      if(!bar){
        bar = document.createElement('div');
        bar.id = 'updateBar';
        bar.className = 'update-bar';
        bar.innerHTML = `
          <span>新しいバージョンがあります：<b>${info.latest}</b>（現在 ${info.current}）</span>
          <div class="btn-group">
            <a class="ghost" href="${info.release_url}" target="_blank">リリースを見る</a>
            <button id="btnDoUpdate" class="primary">このツールを更新</button>
          </div>`;
        document.querySelector('.app-header')?.after(bar);
        document.querySelector('#btnDoUpdate')?.addEventListener('click', async ()=>{
          const btn = document.querySelector('#btnDoUpdate'); if(btn) btn.disabled=true;
          try{
            const r = await fetch('/update', {method:'POST'});
            const j = await r.json();
            if(j && j.ok){
              bar.innerHTML = `<span>更新が完了しました。ページを再読み込みしてください。</span>`;
            }else{
              bar.innerHTML = `<span>更新に失敗しました。ログを確認してください。</span>`;
              console.log('[UPDATE]', j);
            }
          }catch(e){ console.error(e); bar.innerHTML = `<span>更新エラー: ${e?.message||e}</span>`; }
        });
      }
    } else {
      // 最新の場合も明示
      let bar = document.querySelector('#updateBar');
      if(!bar){
        bar = document.createElement('div');
        bar.id = 'updateBar';
        bar.className = 'update-bar ok';
        bar.textContent = `最新です（現在 ${info.current}）`;
        document.querySelector('.app-header')?.after(bar);
      }
    }
  }catch(e){ /* ignore */ }
})();

// 手動確認ボタン
document.getElementById('checkUpdate')?.addEventListener('click', async ()=>{
  try{
    const res = await fetch('/version');
    if(!res.ok) { alert('確認に失敗しました'); return; }
    const info = await res.json();
    if(info && info.is_outdated){
      // 既存のバナーがなければ作成
      if(!document.querySelector('#updateBar')){
        const bar = document.createElement('div');
        bar.id = 'updateBar';
        bar.className = 'update-bar';
        bar.innerHTML = `
          <span>新しいバージョンがあります：<b>${info.latest}</b>（現在 ${info.current}）</span>
          <div class="btn-group">
            <a class="ghost" href="${info.release_url}" target="_blank">リリースを見る</a>
            <button id="btnDoUpdate" class="primary">このツールを更新</button>
          </div>`;
        document.querySelector('.app-header')?.after(bar);
        document.querySelector('#btnDoUpdate')?.addEventListener('click', async ()=>{
          const btn = document.querySelector('#btnDoUpdate'); if(btn) btn.disabled=true;
          try{
            const r = await fetch('/update', {method:'POST'});
            const j = await r.json();
            if(j && j.ok){
              bar.innerHTML = `<span>更新が完了しました。ページを再読み込みしてください。</span>`;
            }else{
              bar.innerHTML = `<span>更新に失敗しました。ログを確認してください。</span>`;
              console.log('[UPDATE]', j);
            }
          }catch(e){ alert('更新エラー: '+(e?.message||e)); }
        });
      }
    }else{
      let bar = document.querySelector('#updateBar');
      if(!bar){
        bar = document.createElement('div');
        bar.id = 'updateBar';
        bar.className = 'update-bar ok';
        bar.textContent = `最新です（現在 ${info.current}）`;
        document.querySelector('.app-header')?.after(bar);
      }
    }
  }catch(e){ alert('確認エラー: '+(e?.message||e)); }
});

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
const QPREF_KEY = 'tdb-q-prefs';
function loadQPrefs(){ try{ return JSON.parse(localStorage.getItem(QPREF_KEY)||'{}')||{}; }catch{ return {}; } }
function saveQPrefs(p){ localStorage.setItem(QPREF_KEY, JSON.stringify(p||{})); }
function restoreQueryPrefs(){
  const p = loadQPrefs();
  if(p.topk!=null) $('#topk').value = p.topk;
  if(p.maxlen!=null) $('#maxlen').value = p.maxlen;
  if(p.exact!=null) $('#exact').checked = !!p.exact;
  if(p.wb!=null) $('#wb').checked = !!p.wb;
  if(p.minprio!=null) $('#minprio').value = p.minprio;
  if(p.includePrompt!=null) $('#includePrompt').checked = !!p.includePrompt;
  if(p.terms!=null) $('#terms').value = p.terms;
}
function bindQueryPrefsAutosave(){
  const saveNow = ()=>{
    const obj = {
      topk: Number($('#topk').value||3),
      maxlen: Number($('#maxlen').value||0),
      exact: $('#exact').checked===true,
      wb: $('#wb').checked===true,
      minprio: ($('#minprio').value===''? null : Number($('#minprio').value)),
      includePrompt: $('#includePrompt').checked===true,
      terms: $('#terms').value || ''
    };
    saveQPrefs(obj);
  };
  ['#topk','#maxlen','#exact','#wb','#minprio','#includePrompt','#terms'].forEach(sel=>{
    const el = document.querySelector(sel); if(!el) return;
    el.addEventListener('change', saveNow);
    if(el.tagName==='TEXTAREA' || el.tagName==='INPUT') el.addEventListener('input', saveNow);
  });
  document.getElementById('q_reset')?.addEventListener('click', ()=>{
    // 既定値
    $('#topk').value = 3;
    $('#maxlen').value = 240; // 既定UI値に合わせる
    $('#exact').checked = true;
    $('#wb').checked = false;
    $('#minprio').value = '';
    $('#includePrompt').checked = true;
    // terms は空に
    $('#terms').value = '';
    saveNow();
  });
}
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
// 起動時に復元＆自動保存バインド
(function initQueryPrefs(){ try{ restoreQueryPrefs(); bindQueryPrefsAutosave(); }catch(e){ console.warn('q-prefs init failed', e); } })();

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
    // 属性の順序に依存しない抽出：<content ...> ... </content>
    const re = /<content\b([^>]*)>([\s\S]*?)<\/content>/gi;
    let m;
    while((m = re.exec(xmlText))){
      const attrs = m[1] || '';
      const uidM = /contentuid\s*=\s*"([^"]+)"/i.exec(attrs);
      if(!uidM) continue;
      const uid = uidM[1];
      const verM = /version\s*=\s*"([^"]+)"/i.exec(attrs);
      const ver = verM ? verM[1] : null; // 文字列のまま保持
      const inner = m[2] || '';
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
    const verEn = (en.version===null || en.version===undefined) ? '' : String(en.version);
    const verJa = (ja.version===null || ja.version===undefined) ? '' : String(ja.version);
    const textEq = (enNorm === jaNorm);
    const verEq  = (verEn === verJa);
    let status;
    if(!mapEn.has(uid)){
      status = 'ENなし';
    }else if(!mapJa.has(uid)){
      status = 'JAなし';
    }else if(textEq && verEq){
      status = '一致';
    }else if(!textEq && !verEq){
      status = '本文差異+version差異';
    }else if(!textEq){
      status = '本文差異';
    }else if(!verEq){
      status = 'version差異';
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
  const statusClass = (s)=>{
    if(s==='一致') return 'st-eq';
    if(s==='本文差異+version差異') return 'st-both';
    if(s==='本文差異') return 'st-body';
    if(s==='version差異') return 'st-version';
    if(s==='ENなし') return 'st-en-miss';
    if(s==='JAなし') return 'st-ja-miss';
    return 'st-unknown';
  };
  const buildRow = (r)=> {
    const klass = statusClass(r.status);
    const verAttr = (v)=> (v===null || v===undefined || v==='') ? '' : ` version="${v}"`;
    const xmlRaw = `<content contentuid="${r.uid}"${verAttr(r.ver_en)}>${r.en||''}</content>`;
    const xml = `<code class=\"language-xml\">${escapeHtml(xmlRaw)}</code>`;
    const vEN = String(r.ver_en ?? '');
    const vJA = String(r.ver_ja ?? '');
    const verEq = (vEN !== '' && vEN === vJA);
    const jaPrev = (r.ja||'').slice(0, 120);
    let noteHtml = '';
    if(verEq){
      const preview = jaPrev ? `\n<span class=\"sub\">JAプレビュー: ${escapeHtml(jaPrev)}</span>` : '';
      noteHtml = `[ver一致]${preview}`;
    }else{
      // ver違い時のみバージョン表示＋警告マーク
      const warn = `<span class=\"warn-ico has-tip\" data-tip=\"警告：原文のバージョンが新しいです。そもそも原文が変化している可能性があります。最新版のENと古いENを突き合わせて、変更点を調べてください！\">⚠</span>`;
      const verline = `verEN=${escapeHtml(vEN)} / verJA=${escapeHtml(vJA)} / ${warn}`;
      const preview = jaPrev ? `\n<span class=\"sub\">JAプレビュー: ${escapeHtml(jaPrev)}</span>` : '';
      noteHtml = `<span class=\"verline\">${verline}</span>${preview}`;
    }
    if(!noteHtml) noteHtml = '<span class=\"muted\">—</span>';
    return `
    <tr class="${klass}">
      <td class="col-code"><pre class="codebox">${xml}</pre></td>
      <td class="col-status">${escapeHtml(r.status)}</td>
      <td class="col-notes">${noteHtml}</td>
    </tr>`;
  };
  wrap.innerHTML = `
    <table class="table">
      <thead>
        <tr>
          <th class="sortable" data-sort="uid">原文</th>
          <th class="sortable" data-sort="status" style="width:120px">状態</th>
          <th class="sortable" data-sort="ver" style="width:28%">備考</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map(buildRow).join('')}
      </tbody>
    </table>`;
  try{ if(window.Prism){ Prism.highlightAllUnder(wrap); } }catch{}

  // 保存してソートハンドラを付与
  window._compareRows = rows.slice();
  window._compareSort = window._compareSort || { key:'', dir:1 };
  // 状態の優先度: version差異系 → 一致系 → 欠落系（JA/EN）→ 本文差異
  const orderRank = {
    '本文差異+version差異': 0,
    'version差異': 1,
    '一致': 2,
    'JAなし': 3,
    'ENなし': 3,
    '本文差異': 4
  };
  function cmp(a,b,key){
    if(key==='uid') return a.uid<b.uid?-1:a.uid>b.uid?1:0;
    if(key==='status'){
      const av = orderRank[a.status] ?? 9; const bv = orderRank[b.status] ?? 9;
      if(av!==bv) return av-bv; return a.uid<b.uid?-1:a.uid>b.uid?1:0;
    }
    if(key==='ver'){
      const ak = String(a.ver_en??'')+"|"+String(a.ver_ja??'');
      const bk = String(b.ver_en??'')+"|"+String(b.ver_ja??'');
      if(ak!==bk) return ak<bk?-1:1; return a.uid<b.uid?-1:a.uid>b.uid?1:0;
    }
    return 0;
  }
  function setIndicators(){
    wrap.querySelectorAll('th.sortable').forEach(th=>{ th.classList.remove('sort-asc','sort-desc'); });
    const cur = window._compareSort;
    if(cur && cur.key){
      const th = wrap.querySelector(`th.sortable[data-sort="${cur.key}"]`);
      if(th) th.classList.add(cur.dir===1?'sort-asc':'sort-desc');
    }
  }
  setIndicators();
  wrap.querySelector('thead')?.addEventListener('click', (e)=>{
    const th = e.target.closest('th.sortable'); if(!th) return;
    const key = th.getAttribute('data-sort'); if(!key) return;
    const cur = window._compareSort || {key:'',dir:1};
    const dir = (cur.key===key) ? -cur.dir : 1;
    window._compareSort = { key, dir };
    const sorted = window._compareRows.slice().sort((a,b)=> dir * cmp(a,b,key));
    renderCompareTable(sorted);
  });
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
        // EN順（英語のUUID順）で表示。JA欠落はwarnで可視化
        diffs = diffs.filter(d=> mapEn.has(d.uid));
        const enUids = [...mapEn.keys()];
        const map = new Map(diffs.map(d=>[d.uid,d]));
        diffs = enUids.map(uid=> map.get(uid) || { uid, status:'JAなし', en: mapEn.get(uid)?.text||'', ja:'', ver_en: mapEn.get(uid)?.version??'', ver_ja:'' });
      }else{
        // まとめ表示：version差異系 → 一致 → 欠落系（JA/EN）→ 本文差異
        const order = { '本文差異+version差異':0, 'version差異':1, '一致':2, 'JAなし':3, 'ENなし':3, '本文差異':4 };
        diffs.sort((a,b)=> (order[a.status]-order[b.status]) || (a.uid<b.uid?-1:a.uid>b.uid?1:0));
      }
      renderCompareTable(diffs);
      const counts = {
        total: diffs.length,
        eq: diffs.filter(d=>d.status==='一致').length,
        enMiss: diffs.filter(d=>d.status==='ENなし').length,
        jaMiss: diffs.filter(d=>d.status==='JAなし').length,
        diff: diffs.filter(d=> d.status==='本文差異' || d.status==='version差異' || d.status==='本文差異+version差異').length,
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
  $('#btnAlignVer')?.addEventListener('click', ()=>{
    const enText = $('#cmpEN').value || '';
    const jaText = $('#cmpJA').value || '';
    const mapEn = parseLocaXmlInline(enText);
    const mapJa = parseLocaXmlInline(jaText);
    const enUids = [...mapEn.keys()];
    // version属性を書き換える（本文はそのまま）
    const setVersionAttr = (rawContent, newVer)=>{
      return String(rawContent||'').replace(/<content\b([^>]*)>/i, (m, attrs)=>{
        const hasVer = /\bversion\s*=\s*"[^"]*"/i.test(attrs);
        if(!newVer){
          // versionを削除
          const attrs2 = attrs.replace(/\s*version\s*=\s*"[^"]*"/i, '');
          return `<content${attrs2}>`;
        }
        if(hasVer){
          const attrs2 = attrs.replace(/version\s*=\s*"[^"]*"/i, `version="${newVer}"`);
          return `<content${attrs2}>`;
        }
        return `<content${attrs} version="${newVer}">`;
      });
    };
    const piece = (uid)=>{
      const en = mapEn.get(uid);
      const ja = mapJa.get(uid);
      if(!en && !ja) return `<!-- missing: ${uid} -->`;
      const newVerStr = (en?.version==null || en?.version==='') ? '' : String(en.version);
      // JAがある場合は本文はそのまま、versionだけ合わせる
      if(ja && ja.raw){
        return setVersionAttr(ja.raw.trim(), newVerStr);
      }
      // JAが無い場合は従来通りに生成（本文はエスケープしない＝既存のエンティティを尊重）
      const body = (ja?.text ?? en?.text ?? '') || '';
      const verAttr = newVerStr ? ` version="${newVerStr}"` : '';
      return `<content contentuid="${uid}"${verAttr}>${body}</content>`;
    };
    const formatted = enUids.map(piece).join('\n');
    const wrap = (function extractXmlWrapper(xmlText){
      const text = String(xmlText||'');
      const decl = (text.match(/^\s*<\?xml[\s\S]*?\?>/i)||[])[0] || '';
      const open = (text.match(/<contentList\b[^>]*>/i)||[])[0] || '';
      const close = /<\/contentList>/i.test(text) ? '</contentList>' : (open ? '</contentList>' : '');
      return { decl, openTag: open, closeTag: close };
    })(enText);
    const wrapped = `${wrap.decl?wrap.decl+'\n':''}${wrap.openTag||'<contentList>'}\n${formatted}\n${wrap.closeTag}`;
    $('#cmpJA').value = wrapped;
    $('#compareStatus').textContent = 'JA側のversionをEN側のversionに合わせました（原文を最新とみなして反映）。';
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
        .map(r=> {
          const code = r.querySelector('.codebox')?.innerText||'';
          const one = code.replace(/\n+/g,'\n').trim();
          // 不足時に version を補う（備考の verEN= を参照）
          if(/ version=\"/.test(one)) return one; // 既にversionあり
          const note = r.querySelector('.col-notes')?.textContent||'';
          const m = /verEN\s*=\s*([^\s/]+)/.exec(note);
          const ver = m ? m[1].replace(/[^0-9A-Za-z_.-]/g,'') : '';
          if(ver){
            return one.replace(/^(<content\s+contentuid=\"[^\"]+\")>/, `$1 version="${ver}">`)
                      .replace(/^<content\s+contentuid=\"([^\"]+)\"(\s*)>/, `<content contentuid="$1" version="${ver}">`);
          }
          return one;
        })
        .filter(Boolean);
      if(!texts.length){ alert('JAなしの行はありません'); return; }
      const out = texts.join('\n');
      navigator.clipboard.writeText(out);
    }catch(e){ alert('コピーに失敗しました: '+e.message); }
  });
  // 動的ツールチップ（warn-ico専用）: ソート/再描画後も位置を追従
  (function initWarnTooltip(){
    if(window._warnTipReady) return; window._warnTipReady = true;
    const tip = document.createElement('div');
    tip.id = 'tooltip-float';
    tip.className = 'tooltip-float';
    tip.hidden = true;
    document.body.appendChild(tip);
    let curEl = null;
    function place(){
      if(!curEl || tip.hidden) return;
      const r = curEl.getBoundingClientRect();
      // 上側中央に表示（スクロール・リサイズに追従）
      tip.style.left = Math.round(r.left + r.width/2) + 'px';
      // いったん表示して高さを計測
      const h = tip.offsetHeight || 0;
      tip.style.top = Math.max(8, Math.round(r.top - 10 - h)) + 'px';
    }
    document.addEventListener('mouseover', (e)=>{
      const el = e.target.closest('.warn-ico.has-tip');
      if(!el) return;
      curEl = el;
      tip.textContent = el.getAttribute('data-tip') || '';
      tip.hidden = false;
      tip.classList.add('show');
      place();
    });
    document.addEventListener('mouseout', (e)=>{
      const el = e.target.closest('.warn-ico.has-tip');
      if(!el) return;
      if(!el.contains(e.relatedTarget)){
        tip.hidden = true;
        tip.classList.remove('show');
        curEl = null;
      }
    });
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
  })();
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

// ===== Tooltip Inserter =====
const TT_DICT_KEY = 'tdb-tt-dict';
const TT_PREF_KEY = 'tdb-tt-prefs';
function loadTTPrefs(){
  try{ return JSON.parse(localStorage.getItem(TT_PREF_KEY)||'{}')||{}; }catch{ return {}; }
}
function saveTTPrefs(p){ localStorage.setItem(TT_PREF_KEY, JSON.stringify(p||{})); }
function loadTTDict(){
  try{
    const raw = localStorage.getItem(TT_DICT_KEY);
    if(!raw){
      // 初期サンプル（初回のみ）
      const sample = [
        { term:'セーヴィング・スロー', tooltip:'SavingThrow' },
        { term:'難易度', tooltip:'DifficultyClass' },
        { term:'知力', tooltip:'Intelligence' },
        { term:'修正値', tooltip:'AbilityModifier' },
        { term:'包み込む', tooltip:'SUSPENDED', type:'Status' },
      ];
      saveTTDict(sample);
      return sample;
    }
    const arr = JSON.parse(raw);
    if(Array.isArray(arr)) return arr.filter(x=>x && typeof x.term==='string' && (typeof x.tooltip==='string' || typeof x.type==='string'));
    return [];
  }catch{ return []; }
}
function saveTTDict(arr){
  localStorage.setItem(TT_DICT_KEY, JSON.stringify(arr||[]));
}
function buildApplyPreview(text, idx, len, tooltip, type){
  // 可能なら <content> 本文に絞って前後を切り出す
  let cStart = text.lastIndexOf('<content', idx);
  let before = '', hit = '', after = '';
  if(cStart >= 0){
    const openEnd = text.indexOf('>', cStart);
    const closeStart = text.indexOf('</content>', idx);
    if(openEnd >= 0 && closeStart >= 0){
      const body = text.slice(openEnd+1, closeStart);
      const relIdx = Math.max(0, Math.min(body.length, idx - (openEnd+1)));
      const r = 80;
      const s2 = Math.max(0, relIdx - r);
      const e2 = Math.min(body.length, relIdx + len + r);
      before = body.slice(s2, relIdx);
      hit    = body.slice(relIdx, relIdx+len);
      after  = body.slice(relIdx+len, e2);
    }
  }
  if(before==='' && hit==='' && after===''){
    const r = 80; const start = Math.max(0, idx-r); const end = Math.min(text.length, idx+len+r);
    before = text.slice(start, idx); hit = text.slice(idx, idx+len); after = text.slice(idx+len, end);
  }
  const beforeHtml = escapeHtml(before) + '<mark>' + escapeHtml(hit) + '</mark>' + escapeHtml(after);
  const attrs = []; if(type) attrs.push(`Type=\"${escapeHtml(type)}\"`); if(tooltip) attrs.push(`Tooltip=\"${escapeHtml(tooltip)}\"`);
  const attrStr = attrs.length ? ' ' + attrs.join(' ') : '';
  const afterTag = `&lt;LSTag${attrStr}&gt;${escapeHtml(hit)}&lt;/LSTag&gt;`;
  const afterHtml = escapeHtml(before) + afterTag + escapeHtml(after);
  const afterOnlyHtml = `<mark class=\"ttc-add\">${afterTag}</mark>`;

  // 全文版（単一エスケープでそのまま表示し、挿入部分のみ黄色）
  let bodyStart = 0, bodyEnd = text.length;
  if(cStart >= 0){
    const openEnd = text.indexOf('>', cStart);
    const closeStart = text.indexOf('</content>', idx);
    if(openEnd >= 0 && closeStart >= 0){ bodyStart = openEnd+1; bodyEnd = closeStart; }
  }
  const bodyFull = text.slice(bodyStart, bodyEnd);
  const relIdxFull = Math.max(0, Math.min(bodyFull.length, idx - bodyStart));
  const beforePart = bodyFull.slice(0, relIdxFull);
  const hitPart    = bodyFull.slice(relIdxFull, relIdxFull + len);
  const afterPart  = bodyFull.slice(relIdxFull + len);
  const beforeFullHtml = escapeHtml(bodyFull);
  const afterFullHtml  = escapeHtml(beforePart) + `<span class=\"ttc-add\">` + `&lt;LSTag${attrStr}&gt;${escapeHtml(hitPart)}&lt;/LSTag&gt;` + `</span>` + escapeHtml(afterPart);

  return { beforeHtml, afterHtml, afterOnlyHtml, beforeFullHtml, afterFullHtml };
}
function showTTConfirmModal(payload){
  return new Promise((resolve)=>{
    const { term, tooltip, type, text, idx, len, remaining } = payload||{};
    // 参照用の行番号とcontentuid（エラー防止のため先に抽出）
    const linesUpTo = text.slice(0, idx).split(/\r?\n/).length;
    let uid = '';
    try{
      const cStart = text.lastIndexOf('<content', idx);
      if(cStart >= 0){
        const openEnd = text.indexOf('>', cStart);
        if(openEnd >= 0){
          const open = text.slice(cStart, openEnd+1);
          const m = /contentuid\s*=\s*"([^"]+)"/i.exec(open);
          uid = m ? m[1] : '';
        }
      }
    }catch{}

    let wrap = document.getElementById('tt_confirm_modal');
    if(!wrap){
      wrap = document.createElement('div');
      wrap.id = 'tt_confirm_modal';
      wrap.style.position='fixed'; wrap.style.inset='0'; wrap.style.background='rgba(0,0,0,.35)'; wrap.style.zIndex='1000';
      wrap.innerHTML = `
        <div class=\"modal\" style=\"position:absolute;left:50%;top:16px;transform:translate(-50%,0)\" tabindex=\"0\">
          <div class=\"form-row ttc-head\" style=\"justify-content:space-between\">
            <strong>タグ挿入の確認 <small id=\"ttc_progress\" class=\"muted\"></small></strong>
            <div class=\"btn-group\">
              <button id=\"ttc_all\" class=\"btn-sm danger\">すべてキャンセル</button>
              <button id=\"ttc_cancel\" class=\"skip\">スキップ (Space)</button>
              <button id=\"ttc_undo\" class=\"warning\">一つ戻す (Backspace)</button>
              <button id=\"ttc_ok\" class=\"primary\">適用 (Enter)</button>
            </div>
          </div>
          <div class=\"ttc-info\">
            <div class=\"item\"><span class=\"muted\">用語</span> <code id=\"ttc_term\"></code></div>
            <div class=\"item\"><span class=\"muted\">Tooltip</span> <code id=\"ttc_tip\"></code></div>
            <div class=\"item\"><span class=\"muted\">Type</span> <code id=\"ttc_type\"></code></div>
            <div class=\"item\"><span class=\"muted\">行番号</span> <code id=\"ttc_line\"></code></div>
            <div class=\"item\"><span class=\"muted\">contentuid</span> <code id=\"ttc_uid\"></code></div>
          </div>
          <div class=\"form-row\" style=\"flex-direction:column;gap:10px; align-items:stretch\">
            <div><b>適用前</b></div>
            <pre class=\"codebox\" style=\"white-space:pre-wrap;border:1px dashed var(--line);padding:10px;border-radius:8px\"><code id=\"ttc_ctx_before\"></code></pre>
            <div><b>適用後</b></div>
            <pre class=\"codebox\" style=\"white-space:pre-wrap;border:1px dashed var(--line);padding:10px;border-radius:8px\"><code id=\"ttc_ctx_after\"></code></pre>
          </div>
          <label class=\"inline\" style=\"margin-top:8px\"><input type=\"checkbox\" id=\"ttc_noask\"> 次回から確認を表示しない（設定から戻せます）</label>
        </div>`;
      document.body.appendChild(wrap);
      wrap.addEventListener('click', (e)=>{ if(e.target===wrap) { wrap.remove(); resolve({apply:false,dontAsk:false}); } });
    }
    wrap.querySelector('#ttc_term').textContent = term||'';
    wrap.querySelector('#ttc_tip').textContent  = tooltip||'';
    wrap.querySelector('#ttc_type').textContent = type||'';
    wrap.querySelector('#ttc_line').textContent = String(linesUpTo);
    wrap.querySelector('#ttc_uid').textContent  = uid||'';
    const pv = buildApplyPreview(text, idx, len, tooltip, type);
    wrap.querySelector('#ttc_ctx_before').innerHTML = pv.beforeFullHtml || pv.beforeHtml || '';
    wrap.querySelector('#ttc_ctx_after').innerHTML  = pv.afterFullHtml  || pv.afterHtml  || '';
    // Prism を使わない（mark を壊さない）

    // 進捗表示
    try{ const prog = wrap.querySelector('#ttc_progress'); if(prog){ prog.textContent = (remaining!=null) ? `残り ${remaining} 件` : ''; } }catch{}

    const ok = wrap.querySelector('#ttc_ok');
    const cancel = wrap.querySelector('#ttc_cancel');
    const cancelAll = wrap.querySelector('#ttc_all');
    const undoBtn = wrap.querySelector('#ttc_undo');
    const ck = wrap.querySelector('#ttc_noask');
    const closeAll = (apply, cancelAllFlag)=>{ const dontAsk = !!ck.checked; wrap.remove(); resolve({apply, dontAsk, cancelAll: !!cancelAllFlag}); };
    ok.onclick = ()=> closeAll(true, false);
    cancel.onclick = ()=> closeAll(false, false);
    cancelAll.onclick = ()=> closeAll(false, true);
    undoBtn.onclick = ()=>{ wrap.remove(); resolve({ apply:false, dontAsk:false, goBack:true }); };

    // キーボードショートカット: Enter=適用 / Space=スキップ / Backspace=一つ戻す
    const modalEl = wrap.querySelector('.modal');
    try{ modalEl?.focus(); }catch{}
    const onKey = (e)=>{
      const key = e.key;
      if(key === 'Enter'){
        e.preventDefault(); ok.click();
      }else if(key === ' ' || key === 'Spacebar' || e.code === 'Space'){
        e.preventDefault(); cancel.click();
      }else if(key === 'Backspace'){
        e.preventDefault(); undoBtn.click();
      }
    };
    modalEl?.addEventListener('keydown', onKey);
  });
}
function showTTSettings(){
  const prefs = loadTTPrefs();
  let wrap = document.getElementById('tt_prefs_modal');
  if(!wrap){
    wrap = document.createElement('div');
    wrap.id = 'tt_prefs_modal';
    wrap.style.position='fixed'; wrap.style.inset='0'; wrap.style.background='rgba(0,0,0,.35)'; wrap.style.zIndex='1000';
    wrap.innerHTML = `
      <div style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:min(520px,96vw);max-height:70vh;overflow:auto;background:var(--card);color:var(--fg);border:1px solid var(--line);border-radius:12px;box-shadow:var(--shadow);padding:14px">
        <div class="form-row" style="justify-content:space-between">
          <strong>ツールチップ適用の設定</strong>
          <div class="btn-group">
            <button id="tt_prefs_save" class="primary">保存</button>
            <button id="tt_prefs_close" class="ghost">閉じる</button>
          </div>
        </div>
        <label class="inline"><input id="tt_pref_skip" type="checkbox"> 逐次確認を表示しない</label>
        <small class="hint">ONにすると、用語ごとの確認ダイアログを省略します。あとから戻せます。</small>
      </div>`;
    document.body.appendChild(wrap);
    wrap.addEventListener('click', (e)=>{ if(e.target===wrap) wrap.remove(); });
    document.getElementById('tt_prefs_close').onclick = ()=> wrap.remove();
    document.getElementById('tt_prefs_save').onclick = ()=>{
      const newPrefs = loadTTPrefs();
      newPrefs.skipConfirm = document.getElementById('tt_pref_skip').checked === true;
      saveTTPrefs(newPrefs);
      wrap.remove();
      alert('設定を保存しました');
    };
  }
  const ck = wrap.querySelector('#tt_pref_skip'); if(ck) ck.checked = !!prefs.skipConfirm; // 既定はオフ
}
function showTTDictManager(){
  const cur = loadTTDict();
function appendRow(tb, term, tip){
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><input type="text" class="inp-term" placeholder="例：知力" value="${escapeHtml(term||'')}"></td>
      <td><input type="text" class="inp-tip" placeholder="例：Intelligence / SUSPENDED" value="${escapeHtml(tip||'')}"></td>
      <td><input type="text" class="inp-type" placeholder="例：Status" value=""></td>
      <td class="ops"><button class="btn-sm btn-del">削除</button></td>`;
    tb.appendChild(tr);
  }
  function renderTTDictTable(rows){
    const tb = document.querySelector('#tt_dict_table tbody'); if(!tb) return;
    tb.innerHTML = '';
    for(const r of rows){ const tr = document.createElement('tr'); tr.innerHTML = `
      <td><input type="text" class="inp-term" value="${escapeHtml(r.term||'')}"></td>
      <td><input type="text" class="inp-tip" value="${escapeHtml(r.tooltip||'')}"></td>
      <td><input type="text" class="inp-type" value="${escapeHtml(r.type||'')}"></td>
      <td class="ops"><button class="btn-sm btn-del">削除</button></td>`; tb.appendChild(tr); }
  }
  function parseCsvLine(line){
    const out = []; let i = 0; let cur = '';
    let inQ = false; while(i < line.length){
      const ch = line[i++];
      if(inQ){
        if(ch === '"'){
          if(line[i] === '"'){ cur += '"'; i++; }
          else { inQ = false; }
        }else cur += ch;
      }else{
        if(ch === ','){ out.push(cur); cur = ''; }
        else if(ch === '"'){ inQ = true; }
        else cur += ch;
      }
    }
    out.push(cur);
    return out;
  }
  function mergeCsvRowsIntoTable(pairs){
    const tb = document.querySelector('#tt_dict_table tbody'); if(!tb) return;
    const map = new Map(); // term -> {tooltip,type}
    for(const tr of [...tb.querySelectorAll('tr')]){
      const term = (tr.querySelector('.inp-term')?.value||'').trim();
      const tip  = (tr.querySelector('.inp-tip')?.value||'').trim();
      const typ  = (tr.querySelector('.inp-type')?.value||'').trim();
      if(term) map.set(term, { tooltip: tip, type: typ });
    }
    for(const [term, tip, typ] of pairs){ if(term && (tip||typ)) map.set(term, { tooltip: tip||'', type: typ||'' }); }
    renderTTDictTable([...map.entries()].map(([term, v])=>({term, tooltip: v.tooltip||'', type: v.type||''})));
  }
  let wrap = document.getElementById('tt_dict_modal');
  if(!wrap){
    wrap = document.createElement('div');
    wrap.id = 'tt_dict_modal';
    wrap.style.position='fixed'; wrap.style.inset='0'; wrap.style.background='rgba(0,0,0,.35)'; wrap.style.zIndex='1000';
    wrap.innerHTML = `
      <div id="tt_dict_panel" style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:min(900px,96vw);max-height:84vh;overflow:auto;background:var(--card);color:var(--fg);border:1px solid var(--line);border-radius:12px;box-shadow:var(--shadow);padding:14px">
        <div class="form-row" style="justify-content:space-between">
          <strong>ツールチップ辞書（表形式）</strong>
          <div class="btn-group">
            <button id="tt_row_add">行追加</button>
            <button id="tt_csv_btn">CSVインポート</button>
            <input id="tt_csv_file" type="file" accept=".csv,text/csv" hidden>
            <button id="tt_dict_clear">全削除</button>
            <button id="tt_dict_save" class="primary">保存</button>
            <button id="tt_dict_close" class="ghost">閉じる</button>
          </div>
        </div>
        <div class="table-wrap">
          <table class="table" id="tt_dict_table">
            <thead><tr><th style="width:45%">用語</th><th style="width:35%">Tooltip名</th><th style="width:10%">Type</th><th style="width:10%">操作</th></tr></thead>
            <tbody></tbody>
          </table>
        </div>
        <small class="hint">CSVは1行2列（用語, Tooltip名）。重複用語は上書きします。</small>
      </div>`;
    document.body.appendChild(wrap);
    wrap.addEventListener('click', (e)=>{ if(e.target===wrap) wrap.remove(); });
    document.getElementById('tt_dict_close').onclick = ()=> wrap.remove();
    document.getElementById('tt_row_add').onclick = ()=>{
      const tb = document.querySelector('#tt_dict_table tbody'); if(!tb) return; appendRow(tb, '', '', '');
    };
    document.getElementById('tt_dict_table').addEventListener('click', (e)=>{
      const btn = e.target.closest('.btn-del'); if(!btn) return;
      const tr = btn.closest('tr'); if(tr) tr.remove();
    });
    document.getElementById('tt_dict_save').onclick = ()=>{
      const rows = [...document.querySelectorAll('#tt_dict_table tbody tr')];
      const map = new Map();
      for(const tr of rows){
        const term = (tr.querySelector('.inp-term')?.value||'').trim();
        const tip  = (tr.querySelector('.inp-tip')?.value||'').trim();
        const typ  = (tr.querySelector('.inp-type')?.value||'').trim();
        if(!term || !(tip||typ)) continue;
        map.set(term, { tooltip: tip, type: typ });
      }
      const out = [...map.entries()].map(([term, v])=>({term, tooltip: v.tooltip||'', type: v.type||''}));
      saveTTDict(out);
      alert('保存しました（件数: '+out.length+'）');
    };
    document.getElementById('tt_csv_btn').onclick = ()=> document.getElementById('tt_csv_file').click();
    document.getElementById('tt_csv_file').addEventListener('change', (e)=>{
      const file = e.target.files?.[0]; if(!file) return;
      const fr = new FileReader();
      fr.onload = ()=>{
        try{
          let text = String(fr.result||'');
          text = text.replace(/^\uFEFF/, '');
          const lines = text.split(/\r?\n/);
          const pairs = [];
          for(const line of lines){
            if(!line.trim()) continue;
            const cols = parseCsvLine(line);
            const term = (cols[0]||'').trim();
            const tip  = (cols[1]||'').trim();
            const typ  = (cols[2]||'').trim();
            if(!term || !(tip||typ)) continue;
            const t0 = term.toLowerCase(); const t1 = tip.toLowerCase();
            if((t0==='term' || t0==='用語') && (t1==='tooltip' || t1==='ツールチップ')) continue;
            pairs.push([term, tip, typ]);
          }
          mergeCsvRowsIntoTable(pairs);
          alert('CSV取り込み完了（'+pairs.length+' 件）');
        }catch(err){ alert('CSV解析エラー: '+(err?.message||err)); }
      };
      fr.readAsText(file, 'utf-8');
      e.target.value = '';
    });
    document.getElementById('tt_dict_clear').onclick = ()=>{
      if(confirm('辞書を空にします。よろしいですか？')){
        const tb = document.querySelector('#tt_dict_table tbody'); if(tb) tb.innerHTML = '';
      }
    };
    renderTTDictTable(cur);
  }else{
    renderTTDictTable(cur);
  }
}

function findLSTagRanges(text){
  const ranges = [];
  // 生のタグ
  const reRaw = /<LSTag\b[\s\S]*?>[\s\S]*?<\/LSTag>/g;
  let m;
  while((m = reRaw.exec(text))){ ranges.push([m.index, m.index + m[0].length]); }
  // エスケープ済みタグ
  const reEsc = /&lt;LSTag\b[\s\S]*?&gt;[\s\S]*?&lt;\/LSTag&gt;/g;
  while((m = reEsc.exec(text))){ ranges.push([m.index, m.index + m[0].length]); }
  return ranges.sort((a,b)=> a[0]-b[0]);
}
function posIntersectsRanges(start, end, ranges){
  for(const [s,e] of ranges){ if(start < e && end > s) return true; }
  return false;
}
function shiftRangesFrom(ranges, pos, delta){
  for(let i=0;i<ranges.length;i++){
    const s = ranges[i][0], e = ranges[i][1];
    if(e <= pos) continue; // 完全に手前→無変更
    if(s >= pos){ ranges[i][0] = s + delta; ranges[i][1] = e + delta; }
    else { ranges[i][1] = e + delta; } // 置換点が区間内末尾に影響
  }
}
function getPlainSegments(text){
  const ranges = findLSTagRanges(text).slice().sort((a,b)=> a[0]-b[0]);
  const segs = [];
  let cur = 0;
  for(const [s,e] of ranges){ if(cur < s){ segs.push([cur, s]); } cur = Math.max(cur, e); }
  if(cur < text.length) segs.push([cur, text.length]);
  return segs;
}

function inAnyRange(start, end, ranges){
  for(const [s,e] of ranges){ if(start < e && end > s) return true; }
  return false;
}

function extractTaggedTerms(text){
  const set = new Set();
  try{
    const reRaw = /<LSTag\b[^>]*>([\s\S]*?)<\/LSTag>/g; let m;
    while((m = reRaw.exec(text))) { const w = (m[1]||'').trim(); if(w) set.add(w); }
  }catch{}
  try{
    const reEsc = /&lt;LSTag\b[^&]*&gt;([\s\S]*?)&lt;\/LSTag&gt;/g; let m2;
    while((m2 = reEsc.exec(text))) { const w = (m2[1]||'').trim(); if(w) set.add(w); }
  }catch{}
  return set;
}

// 既存タグ本文に対する部分一致（前方・後方・中間）を検出
function isSubstringOfAny(term, taggedSet){
  if(!term || !taggedSet || typeof taggedSet[Symbol.iterator] !== 'function') return false;
  for(const w of taggedSet){
    try{ if(w && typeof w.includes === 'function' && w.includes(term)) return true; }catch{}
  }
  return false;
}

// 候補語の直前が &gt; または直後が &lt; の場合は除外（エスケープされたタグ境界の直近）
function touchesEscapedAngle(text, start, len){
  const before4 = text.slice(Math.max(0, start-4), start);
  const after4  = text.slice(start+len, start+len+4);
  const leftIsGt  = before4.endsWith('&gt;');
  const rightIsLt = after4.startsWith('&lt;');
  // 候補の直前が &gt; かつ 直後が &lt;（= エスケープされたタグに完全に挟まれている）のみ除外
  return leftIsGt && rightIsLt;
}

// 初回に全文を走破して固定の挿入候補を収集
function collectTTCandidates(text, dict){
  const entries = (dict||[]).filter(x=>x && x.term && (x.tooltip || x.type));
  // 同じ先頭文字の中でも「長い語を優先する」ことを厳格化するため、走査中に
  // 既に見つけた短い一致よりも長い一致が取れる場合は置き換える。
  const buckets = buildBuckets(entries);
  const segs = getPlainSegments(text);
  const result = [];
  for(const [segStart, segEnd] of segs){
    let pos = segStart;
    while(pos < segEnd){
      const ch = text[pos];
      const cand = buckets.get(ch) || [];
      let picked = null;
      for(const it of cand){
        const t = it.term;
        if(!text.startsWith(t, pos)) continue;
        if(touchesEscapedAngle(text, pos, t.length)) continue;
        picked = it; break; // cand は既に長い順
      }
      // 直後位置に、picked を完全に包含するより長い語が存在しないか追加確認
      if(picked){
        const longer = cand.find(it=> it.term.length > picked.term.length && text.startsWith(it.term, pos));
        if(longer && !touchesEscapedAngle(text, pos, longer.term.length)) picked = longer;
      }
      if(picked){
        result.push({ idx: pos, term: picked.term, tooltip: picked.tooltip||'', type: picked.type||'' });
        pos += picked.term.length; // 重複回避のため前進
      }else{
        pos++;
      }
    }
  }
  return result;
}

function buildBuckets(entries){
  const map = new Map();
  for(const it of entries){
    const t = String(it.term||''); if(!t) continue;
    const k = t[0];
    const arr = map.get(k) || []; arr.push(it); map.set(k, arr);
  }
  // 長い語を先に
  for(const [k,arr] of map){ arr.sort((a,b)=> (b.term.length - a.term.length)); }
  return map;
}

async function applyTooltipsToXml(xmlText, dict){
  let text = String(xmlText||'');
  const candidates = collectTTCandidates(text, dict);
  let replacedCount = 0;
  let remaining = candidates.length;
  let offset = 0;
  const applied = []; // 履歴: { pos, term, tag }

  for(let i=0;i<candidates.length;i++){
    const c = candidates[i];
    const term = c.term; const tooltip = c.tooltip; const type = c.type;
    const pos0 = c.idx; const pos = pos0 + offset; const endPos = pos + term.length;

    // 念のため：適用直前に既存タグ区間と重なるならスキップ
    const protect = findLSTagRanges(text);
    if(inAnyRange(pos, endPos, protect)) { remaining--; continue; }

    const prefs = loadTTPrefs();
    let doApply = true; let setSkip = false;
    if(!prefs?.skipConfirm){
      const choice = await showTTConfirmModal({ term, tooltip, type, text, idx: pos, len: term.length, remaining });
      if(choice?.cancelAll){ return { text: xmlText, replacedCount: 0 }; }
      if(choice?.goBack){
        // 直前の適用を元に戻し、前の候補へ戻る
        const last = applied.pop();
        if(last){
          const before = text.slice(0, last.pos);
          const after  = text.slice(last.pos + last.tag.length);
          text = before + last.term + after;
          offset -= (last.tag.length - last.term.length);
          replacedCount = Math.max(0, replacedCount - 1);
          remaining++;
          const st = document.getElementById('tt_status'); if(st){ st.textContent = `1件戻しました。残り ${remaining} 件`; }
          renderTooltipResult(xmlText, text);
        }
        i = Math.max(-1, i - 2); // for の i++ を相殺しつつ一つ前へ
        continue;
      }
      doApply = !!choice?.apply; setSkip = !!choice?.dontAsk;
      if(setSkip){ prefs.skipConfirm = true; saveTTPrefs(prefs); }
    }
    if(!doApply){ remaining--; continue; }

    const attrs = [];
    if(type) attrs.push(`Type=\"${escapeHtml(type)}\"`);
    if(tooltip) attrs.push(`Tooltip=\"${escapeHtml(tooltip)}\"`);
    const attrStr = attrs.length ? ' ' + attrs.join(' ') : '';
    const tag = `&lt;LSTag${attrStr}&gt;${term}&lt;/LSTag&gt;`;
    const before = text.slice(0, pos);
    const after  = text.slice(endPos);
    text = before + tag + after;
    replacedCount++;
    applied.push({ pos, term, tag });
    remaining = Math.max(0, remaining - 1);
    const st = document.getElementById('tt_status'); if(st){ st.textContent = `適用中… 残り ${remaining} 件`; }
    const pv = buildApplyPreview(text, pos, term.length, tooltip, type);
    const outCode = document.getElementById('tt_output_code');
    if(outCode){ outCode.innerHTML = pv.afterFullHtml; }
    offset += tag.length - term.length;
  }
  return { text, replacedCount };
}
function renderTooltipResult(inputText, outputText){
  const inCode = document.getElementById('tt_input_code');
  const outCode = document.getElementById('tt_output_code');
  const table = document.getElementById('tt_table');
  if(inCode) inCode.innerHTML = escapeHtml(inputText||'');
  if(outCode) outCode.innerHTML = escapeHtml(outputText||'');
  if(table) table.hidden = false;
  try{ if(window.Prism){ Prism.highlightAllUnder(table); } }catch{}
}
function initTooltipBindings(){
  const btnApply = document.getElementById('tt_apply'); if(!btnApply) return;
  const btnCopy  = document.getElementById('tt_copy');
  const btnClear = document.getElementById('tt_clear');
  const btnUndo  = document.getElementById('tt_undo');
  const btnDict  = document.getElementById('tt_manageDict');
  const btnSettings = document.getElementById('tt_settings');
  const st       = document.getElementById('tt_status');
  // 多段UNDO用の履歴スタック（直近が末尾）
  let undoStack = []; // Array<{ input:string, output:string }>
  const UNDO_LIMIT = 50;
  btnApply.addEventListener('click', async ()=>{
    try{
      const src = document.getElementById('tt_xml').value || '';
      if(!src.trim()){ if(st) st.textContent='XMLを入力してください'; return; }
      const dict = loadTTDict();
      // 適用前のスナップショットを履歴に積む
      const prevOut = document.getElementById('tt_output_code')?.textContent || '';
      undoStack.push({ input: src, output: prevOut });
      if(undoStack.length > UNDO_LIMIT) undoStack.shift();
      const res = await applyTooltipsToXml(src, dict);
      renderTooltipResult(src, res.text);
      if(st){
        const n = Number(res?.replacedCount||0);
        st.textContent = `適用完了: ${n} 箇所`;
        st.className='status ok';
      }
    }catch(e){ if(st){ st.textContent='エラー: '+(e?.message||e); st.className='status error'; } }
  });
  // 上部バーからはUNDOボタンを撤去したため、念のためリスナーは追加しない
  btnCopy?.addEventListener('click', ()=>{
    const out = document.getElementById('tt_output_code')?.textContent || '';
    if(!out){ if(st) st.textContent='結果がありません'; return; }
    navigator.clipboard.writeText(out);
    if(st) st.textContent='コピーしました';
  });
  btnClear?.addEventListener('click', ()=>{
    document.getElementById('tt_xml').value='';
    document.getElementById('tt_input_code').textContent='';
    document.getElementById('tt_output_code').textContent='';
    document.getElementById('tt_table').hidden = true;
    if(st) st.textContent='';
    // 履歴も消去
    undoStack = [];
  });
  btnDict?.addEventListener('click', showTTDictManager);
  btnSettings?.addEventListener('click', showTTSettings);

  // ====== Analyzer (XML → frequent LSTags) ======
  const anlRun   = document.getElementById('tt_anl_run');
  const anlFile  = document.getElementById('tt_anl_file');
  const anlTopN  = document.getElementById('tt_anl_topn');
  const anlTbl   = document.getElementById('tt_anl_table');
  const anlSt    = document.getElementById('tt_anl_status');
  const anlAll   = document.getElementById('tt_anl_check_all');
  const anlAdd   = document.getElementById('tt_anl_add_selected');
  function parseLSTagsFromXml(xmlText){
    const out = [];
    if(!xmlText) return out;
    // 生タグとエスケープ済みの両方を抽出
    const patterns = [
      /<LSTag\b([^>]*)>([\s\S]*?)<\/LSTag>/gi,
      /&lt;LSTag\b([^&]*)&gt;([\s\S]*?)&lt;\/LSTag&gt;/gi,
    ];
    for(const re of patterns){
      let m; while((m = re.exec(xmlText))){
        const attrs = m[1]||''; const body = (m[2]||'').trim();
        const tipM = /Tooltip\s*=\s*"([^"]*)"/i.exec(attrs);
        const typeM= /Type\s*=\s*"([^"]*)"/i.exec(attrs);
        const tooltip = tipM ? tipM[1] : '';
        const type    = typeM ? typeM[1] : '';
        if(!body) continue;
        out.push({ term: body, tooltip, type });
      }
    }
    return out;
  }
  function renderAnlTable(rows){
    if(!anlTbl) return; const tb = anlTbl.tBodies[0]; tb.innerHTML='';
    for(const r of rows){
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><input type="checkbox" class="tt_anl_ck"></td>
        <td>${escapeHtml(r.term||'')}</td>
        <td>${escapeHtml(r.tooltip||'')}</td>
        <td>${escapeHtml(r.type||'')}</td>
        <td>${r.count||0}</td>`;
      tr._data = r; tb.appendChild(tr);
    }
    anlTbl.hidden = rows.length===0;
  }
  anlRun?.addEventListener('click', ()=>{
    try{
      anlSt.textContent = '';
      const file = anlFile?.files?.[0]; if(!file){ anlSt.textContent='XMLファイルを選択してください'; anlSt.className='status error'; return; }
      const topn = Math.max(1, Math.min(1000, Number(anlTopN?.value||50)));
      const fr = new FileReader();
      fr.onload = ()=>{
        try{
          const text = String(fr.result||'');
          const tags = parseLSTagsFromXml(text);
          // 集計: key = term|tooltip|type
          const map = new Map();
          for(const t of tags){
            const key = `${t.term}\u0001${t.tooltip}\u0001${t.type}`;
            map.set(key, (map.get(key)||0) + 1);
          }
          let rows = [...map.entries()].map(([k,c])=>{ const [term,tooltip,type] = k.split('\u0001'); return {term,tooltip,type,count:c}; });
          rows.sort((a,b)=> b.count - a.count || a.term.localeCompare(b.term));
          rows = rows.slice(0, topn);
          renderAnlTable(rows);
          anlSt.textContent = `抽出: ${tags.length}件 / 表示: 上位 ${rows.length}件`;
          anlSt.className = 'status';
        }catch(err){ anlSt.textContent = '解析エラー: ' + (err?.message||err); anlSt.className='status error'; }
      };
      fr.readAsText(file, 'utf-8');
    }catch(e){ anlSt.textContent = 'エラー: ' + (e?.message||e); anlSt.className='status error'; }
  });
  anlAll?.addEventListener('change', ()=>{
    const on = anlAll.checked; document.querySelectorAll('#tt_anl_table .tt_anl_ck').forEach((i)=>{ i.checked = on; });
  });
  anlAdd?.addEventListener('click', ()=>{
    try{
      if(!anlTbl || anlTbl.hidden){ anlSt.textContent='結果がありません'; return; }
      const sel = [...document.querySelectorAll('#tt_anl_table .tt_anl_ck')].map((ck)=> ck.closest('tr')).filter(Boolean).filter(tr=> tr.querySelector('.tt_anl_ck').checked).map(tr=> tr._data);
      if(!sel.length){ anlSt.textContent='選択がありません'; return; }
      const cur = loadTTDict(); const map = new Map(cur.map(x=>[x.term, { tooltip:x.tooltip||'', type:x.type||'' }]));
      for(const r of sel){
        // term=本文、tooltip/typeはそのまま
        map.set(r.term, { tooltip: r.tooltip||'', type: r.type||'' });
      }
      const out = [...map.entries()].map(([term,v])=>({ term, tooltip:v.tooltip||'', type:v.type||'' }));
      saveTTDict(out);
      anlSt.textContent = `辞書に追加しました（${sel.length}件、総数 ${out.length}件）`;
      anlSt.className = 'status ok';
    }catch(err){ anlSt.textContent = '辞書追加エラー: ' + (err?.message||err); anlSt.className='status error'; }
  });
}
initTooltipBindings();

// 残件見積もり：既存タグ内は数えず、長い語優先で重複を避ける
function estimateRemainingMatches(xmlText, dict){
  const text = String(xmlText||'');
  const cands = collectTTCandidates(text, dict);
  return cands.length;
}
