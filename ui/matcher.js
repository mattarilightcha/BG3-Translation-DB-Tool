// minimal helpers (subset from app.js)
const $  = (s)=>document.querySelector(s);
function escapeHtml(s){ return String(s??'').replace(/[&<>"]|'/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m])); }
function downloadText(filename, content, mime='text/plain'){
  const blob = new Blob([content], {type: mime + ';charset=utf-8'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
}

let LAST = { matched_xml:null, unmatched_xml:null, review_csv:null, counts:null };

async function runMatch(){
  const st = $('#status'); st.textContent = '送信中…'; st.className='status';
  try{
    const mod = $('#modXML').files[0];
    const ens = Array.from($('#enXML').files||[]);
    const jas = Array.from($('#jaXML').files||[]);
    const fuzzy = $('#fuzzy').checked;
    const cutoff = Number($('#cutoff').value||0.92);
    const workers = Number($('#workers').value||1);

    if(!mod){ st.textContent='MOD XML を選択してください'; st.className='status error'; return; }
    if(ens.length===0){ st.textContent='公式 EN XML を1つ以上選択してください'; st.className='status error'; return; }
    if(jas.length===0){ st.textContent='公式 JA XML を1つ以上選択してください'; st.className='status error'; return; }

    const fd = new FormData();
    fd.append('modfile', mod);
    for(const f of ens) fd.append('enfiles', f);
    for(const f of jas) fd.append('jafiles', f);
    fd.append('enable_fuzzy', String(fuzzy));
    fd.append('cutoff', String(cutoff));
    fd.append('workers', String(workers));

    const res = await fetch('/match/bg3', { method:'POST', body: fd });
    if(!res.ok){
      const text = await res.text();
      st.textContent = `エラー: HTTP ${res.status} ${text}`; st.className='status error';
      return;
    }
    const data = await res.json();
    LAST.matched_xml = data.matched_xml || null;
    LAST.unmatched_xml = data.unmatched_xml || null;
    LAST.review_csv = data.review_csv || null;
    LAST.counts = data.counts || null;
    const c = LAST.counts||{};
    $('#resultInfo').textContent = `完了: JAあり=${c.matched_ja||0} / JAなし=${c.matched_noja||0} / EN未一致=${c.unmatched||0}  (mod=${c.mod||0}, en=${c.en||0}, ja=${c.ja||0})`;
    st.textContent = '完了'; st.className='status ok';
  }catch(err){
    console.error(err); st.textContent = 'エラー: ' + err.message; st.className='status error';
  }
}

$('#btnRun').onclick = runMatch;
$('#btnClear').onclick = ()=>{ $('#modXML').value=''; $('#enXML').value=''; $('#jaXML').value=''; $('#status').textContent=''; $('#resultInfo').textContent=''; LAST={matched_xml:null,unmatched_xml:null,review_csv:null,counts:null}; };
$('#dlMatched').onclick = ()=>{ if(!LAST.matched_xml){ alert('未生成です'); return;} downloadText('bg3_out_matched_ja.xml', LAST.matched_xml, 'application/xml'); };
$('#dlUnmatched').onclick = ()=>{ if(!LAST.unmatched_xml){ alert('未生成です'); return;} downloadText('bg3_out_unmatched_src.xml', LAST.unmatched_xml, 'application/xml'); };
$('#dlReview').onclick = ()=>{ if(!LAST.review_csv){ alert('fuzzy無効では出力されません'); return;} downloadText('bg3_review_pairs.csv', LAST.review_csv, 'text/csv'); };


