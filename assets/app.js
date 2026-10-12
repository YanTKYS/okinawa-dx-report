/* 沖縄県内11市 DX推進体制比較
 * 静的ページ。data/*.csv を読み込んで描画する。ビルド不要・外部依存なし。
 *
 * 設計上の鉄則:
 *  - 「不明」「未評価」「未確認」等は欠損として扱い、決して 0 に置き換えない。
 *  - 欠損を含む市は、その指標の集計・相関から除外し、除外数を必ず表示する。
 *  - 推測値の補完は一切行わない。
 *  - 広義指標（総務省 dx_info_staff）と狭義指標（dx_staff）を同じラベルで表示しない。
 */
'use strict';

/* ============================ 定数 ============================ */

var DATA_FILES = {
  municipalities: 'data/municipalities.csv',
  evidence:       'data/evidence.csv',
  rubric:         'data/scoring_rubric.csv',
  scoring:        'data/scoring_results.csv'
};

var MIN_N_CALC = 3;   /* 相関を算出できる最小の対 */
var MIN_N_MAIN = 6;   /* methodology §9.2.1 の運用基準（2026-09-17 新設）。これ未満は「探索的」と表示し主分析と呼ばない */

/* 「注目する市」の選択。閲覧者が municipalities.csv の11市から任意に選ぶ。
   強調表示のみで、並び順・評価・分析対象・統計処理は一切変えない。
   URL の ?city=<自治体コード> で共有できる（未指定・不正値は全市＝強調なし）。 */
var FOCUS_PARAM = 'city';

var MISSING_TOKENS = ['', '-', '—', '–', '不明', '未評価', '未採点', '未確認',
  '確認不能', '該当なし', '未調査', '未取得', '算出不能', 'N/A', 'n/a', 'NA', 'null', 'undefined'];

/* Spearman ρ / Pearson r の臨界値 (α=0.05, 両側) */
var RHO_CRIT = {5:1.000,6:.886,7:.786,8:.738,9:.700,10:.648,11:.618,12:.587,13:.560,14:.538,15:.521};
var R_CRIT   = {5:.878,6:.811,7:.754,8:.707,9:.666,10:.632,11:.602,12:.576,13:.553,14:.532,15:.514};

/* 主分析＝総務省の広義共通指標。UI上で「DX担当人数」とは表示しない。 */
var MAIN_METRICS = [
  {key:'_dxinfo',        label:'DX・情報関係業務担当職員数',               unit:'人', tier:'main'},
  {key:'_dxinfoPer10k',  label:'人口1万人あたり DX・情報関係業務担当職員数', unit:'人', tier:'main'},
  {key:'_dxinfoPer100',  label:'職員100人あたり DX・情報関係業務担当職員数', unit:'人', tier:'main'}
];
/* 補助分析＝自治体資料ベースの狭義指標。データがある場合のみ選択肢に出す。 */
var SUB_METRICS = [
  {key:'_dx', label:'参考：DX専任・主担当人数（狭義）', unit:'人', tier:'sub'}
];

var DXINFO_NOTE = '総務省「令和6年度 自治体DX・情報化推進概要」における'
  + '「DX推進担当課室・情報政策担当課室」の合計人数（基準日2024年4月1日）。'
  + '情報政策担当を含むため、<b>DX専任人数とは異なる</b>。';

var CONF_DESC = {
  'A':'一次資料から直接確認',
  'B':'複数情報から高い確度で確認',
  'C':'間接情報のみ（一次資料未確認）',
  '不明':'判断できない'
};

/* methodology.md §9.6 の事前登録ペア。結果に合わせて変更しない。 */
var PRESET_PAIRS = [
  {a:'糸満市',  b:'豊見城市', note:'本島南部・同規模。情報政策課兼務型 ⇔ デジタル推進課設置'},
  {a:'沖縄市',  b:'うるま市', note:'本島中部・同規模。機能分離型 ⇔ 機能一体型'},
  {a:'浦添市',  b:'宜野湾市', note:'本島中南部・同規模。分担型 ⇔ 単独課型'},
  {a:'石垣市',  b:'宮古島市', note:'離島・同規模。専管課あり ⇔ 情報政策課兼務'}
];

var STATE = {muni:[], evidence:[], rubric:[], scoring:[], focus:null,
             sort:{key:'_code', dir:1}, scope:'sensitivity'};

/* ============================ CSV ============================ */

/* RFC4180 準拠。引用符内のカンマ・改行・エスケープされた引用符を保持する */
function parseCSV(text){
  if(text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  var rows = [], row = [], field = '', i = 0, inQuotes = false, c;
  while(i < text.length){
    c = text[i];
    if(inQuotes){
      if(c === '"'){
        if(text[i+1] === '"'){ field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += c; i++; continue;
    }
    if(c === '"'){ inQuotes = true; i++; continue; }
    if(c === ','){ row.push(field); field = ''; i++; continue; }
    if(c === '\r'){ if(text[i+1] === '\n') i++; row.push(field); field=''; rows.push(row); row=[]; i++; continue; }
    if(c === '\n'){ row.push(field); field=''; rows.push(row); row=[]; i++; continue; }
    field += c; i++;
  }
  if(field !== '' || row.length){ row.push(field); rows.push(row); }
  return rows;
}

function toObjects(rows){
  if(!rows.length) return [];
  var head = rows[0].map(function(h){ return h.trim(); });
  return rows.slice(1)
    .filter(function(r){ return r.some(function(v){ return String(v).trim() !== ''; }); })
    .map(function(r){
      var o = {};
      head.forEach(function(h, i){ o[h] = (r[i] === undefined ? '' : r[i]); });
      return o;
    });
}

/* ============================ 欠損判定 ============================ */

function isMissing(v){
  if(v === null || v === undefined) return true;
  var s = String(v).trim();
  if(MISSING_TOKENS.indexOf(s) !== -1) return true;
  if(/^要確認/.test(s)) return true;
  return false;
}
function txt(v, fb){ return isMissing(v) ? (fb === undefined ? '不明' : fb) : String(v).trim(); }

/* 厳格な数値変換。数字だけで構成された値のみ採用し、それ以外は null（欠損） */
function num(v){
  if(isMissing(v)) return null;
  var s = String(v).trim().replace(/[,\s]/g, '');
  if(!/^-?\d+(\.\d+)?$/.test(s)) return null;
  var n = parseFloat(s);
  return isFinite(n) ? n : null;
}
function fmt(n, d){
  if(n === null || n === undefined) return '—';
  var k = (d === undefined) ? (Number.isInteger(n) ? 0 : 2) : d;
  return n.toLocaleString('ja-JP', {minimumFractionDigits:k, maximumFractionDigits:k});
}
function esc(s){
  return String(s === null || s === undefined ? '' : s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

/* ============================ 派生値 ============================ */

function derive(rows){
  return rows.map(function(r){
    r._name  = String(r.municipality || '').trim();
    r._code  = num(r.municipality_code);
    r._pop   = num(r.population);
    r._staff = num(r.total_staff);

    /* 広義（総務省・主分析） */
    r._dxinfo = num(r.dx_info_staff);
    r._dxinfoPer10k = num(r.dx_info_staff_per_10000_population);
    if(r._dxinfoPer10k === null && r._dxinfo !== null && r._pop) r._dxinfoPer10k = r._dxinfo / r._pop * 10000;
    r._dxinfoPer100 = num(r.dx_info_staff_per_100_staff);
    if(r._dxinfoPer100 === null && r._dxinfo !== null && r._staff) r._dxinfoPer100 = r._dxinfo / r._staff * 100;

    /* 狭義（自治体資料・補助分析）。広義と混同しないよう別変数で保持する。 */
    r._dx       = num(r.dx_staff);
    r._infra    = num(r.infra_staff);
    r._bpr      = num(r.bpr_staff);
    r._infoDept = num(r.info_policy_dept_staff);
    r._combined = num(r.dx_bpr_combined_staff);
    r._ext      = num(r.external_dx_staff);

    /* スコア */
    r._score  = num(r.dx_score);
    r._scoreA = num(r.dx_score_adjusted);
    /* 実装成果スコア（主分析の被説明変数）。説明変数と構成概念が重複する
       体制系項目（I-3・IV-1・V-1〜V-3 等）を除いた部分尺度。 */
    r._impl   = num(r.impl_score);
    r._implA  = num(r.impl_score_adjusted);
    r._implMax   = num(r.impl_max_points);
    r._implJudge = num(r.impl_judgeable_points);
    r._implRate  = num(r.impl_unconfirmed_rate);
    r._implEligible = (String(r.impl_main_analysis_eligible||'').indexOf('該当') === 0);
    r._judge  = num(r.judgeable_points);
    r._unconfPts = num(r.unconfirmed_points);
    r._unconfRate= num(r.unconfirmed_rate);
    r._eligible  = (String(r.main_analysis_eligible||'').indexOf('該当') === 0);

    /* 軸1: 専任組織の有無 */
    var ded = String(r.dedicated_dx_org || '').trim();
    r._orgGroup = /^有/.test(ded) ? 'dedicated' : (/^無/.test(ded) ? 'concurrent' : 'unknown');

    /* 軸2: DX企画機能と情報システム運用機能の分離状況 */
    var info = String(r.info_policy_department || '').trim();
    if(String(r.dx_department || '').indexOf('／') !== -1) r._funcType = 'split-dept';
    else if(/同一/.test(info))                             r._funcType = 'integrated';
    else if(isMissing(info))                               r._funcType = 'unknown';
    else                                                   r._funcType = 'separated';

    r._hasBpr = !isMissing(r.bpr_department);
    return r;
  });
}

var ORG_GROUPS = [
  {id:'dedicated',  name:'DX専任組織あり',         desc:'DX推進を主たる所掌とする課・室を設置'},
  {id:'concurrent', name:'情報政策部署がDXを兼務', desc:'DX専管組織を置かず情報政策課等が所掌'},
  {id:'unknown',    name:'要確認',                 desc:'情報不足により分類できない'}
];
var FUNC_LABEL = {'separated':'機能分離型','integrated':'機能一体型',
                  'split-dept':'分担型（複数部署）','unknown':'要確認'};

/* ============================ 注目する市 ============================ */

/* STATE.focus は自治体コード（数値）または null（全市・強調なし） */
function isFocus(r){ return STATE.focus !== null && r._code === STATE.focus; }
function focusRow(){ return STATE.muni.filter(isFocus)[0] || null; }
function focusTr(r){ return isFocus(r) ? '<tr class="is-focus">' : '<tr>'; }

/* URL の city パラメータを municipalities.csv の自治体コードと照合する。不正・未対応は null */
function rawCityParam(){
  try{ return new URLSearchParams(location.search).get(FOCUS_PARAM); }catch(e){ return null; }
}
function codeFromURL(){
  var v = rawCityParam();
  if(v === null || !/^\d+$/.test(v.trim())) return null;
  var c = parseInt(v, 10);
  return STATE.muni.some(function(r){ return r._code === c; }) ? c : null;
}
/* city パラメータだけを書き換え、他のパラメータとページ内アンカーは保持する */
function writeURL(code, push){
  try{
    var u = new URL(location.href);
    if(code === null) u.searchParams.delete(FOCUS_PARAM);
    else u.searchParams.set(FOCUS_PARAM, String(code));
    history[push ? 'pushState' : 'replaceState'](history.state, '', u.pathname + u.search + u.hash);
  }catch(e){ /* file:// 等で履歴APIが使えない場合は表示だけ切り替える */ }
}

function initFocusPicker(){
  var sel = document.getElementById('focusSel');
  STATE.muni.forEach(function(r){
    if(r._code === null) return;
    var o = document.createElement('option');
    o.value = String(r._code); o.textContent = r._name;
    sel.appendChild(o);
  });
  STATE.focus = codeFromURL();
  /* 不正・未対応コードは全市表示とし、URLからも外して表示と一致させる */
  if(rawCityParam() !== null && STATE.focus === null) writeURL(null, false);
  sel.value = STATE.focus === null ? '' : String(STATE.focus);
  sel.addEventListener('change', function(){
    var c = sel.value === '' ? null : parseInt(sel.value, 10);
    if(c === STATE.focus) return;
    STATE.focus = c; writeURL(c, true); applyFocus();
  });
  /* 戻る・進む。ページ内アンカー移動でも発火するため、選択が変わったときだけ再描画する */
  window.addEventListener('popstate', function(){
    var c = codeFromURL();
    if(c === STATE.focus) return;
    STATE.focus = c;
    sel.value = c === null ? '' : String(c);
    applyFocus();
  });
}

/* 選択変更時の再描画。閲覧中のセクション位置と、開いている詳細（details）を保つ */
function applyFocus(){
  var open = Array.prototype.filter.call(document.querySelectorAll('details[data-key]'),
               function(d){ return d.open; }).map(function(d){ return d.getAttribute('data-key'); });
  var secs = document.querySelectorAll('main section'), anchor = null, top = 0, i;
  for(i = 0; i < secs.length; i++){
    var b = secs[i].getBoundingClientRect();
    if(b.bottom > 60){ anchor = secs[i]; top = b.top; break; }
  }
  renderFocusSections();
  Array.prototype.forEach.call(document.querySelectorAll('details[data-key]'), function(d){
    if(open.indexOf(d.getAttribute('data-key')) !== -1) d.open = true;
  });
  if(anchor){
    var d = anchor.getBoundingClientRect().top - top;
    if(Math.abs(d) > 1) window.scrollBy(0, d);
  }
}

function renderFocusLabel(){
  var f = focusRow(), el = document.getElementById('focusPrint');
  if(el) el.innerHTML = f ? '注目する市：<b>' + esc(f._name) + '</b>（強調表示のみ。評価・統計処理は全市共通）' : '';
  var pick = document.getElementById('focusPick');
  if(pick) pick.classList.toggle('on', !!f);
}

/* ============================ 統計 ============================ */

function pearson(xs, ys){
  var n = xs.length; if(n < 3) return null;
  var mx = 0, my = 0, i;
  for(i=0;i<n;i++){ mx += xs[i]; my += ys[i]; }
  mx /= n; my /= n;
  var sxy=0, sxx=0, syy=0, dx, dy;
  for(i=0;i<n;i++){ dx = xs[i]-mx; dy = ys[i]-my; sxy += dx*dy; sxx += dx*dx; syy += dy*dy; }
  if(sxx === 0 || syy === 0) return null;
  return sxy / Math.sqrt(sxx * syy);
}
/* 同順位は平均順位 */
function rankAvg(arr){
  var idx = arr.map(function(v,i){ return [v,i]; }).sort(function(a,b){ return a[0]-b[0]; });
  var ranks = new Array(arr.length), i = 0, j, k, r;
  while(i < idx.length){
    j = i;
    while(j+1 < idx.length && idx[j+1][0] === idx[i][0]) j++;
    r = (i + j) / 2 + 1;
    for(k=i;k<=j;k++) ranks[idx[k][1]] = r;
    i = j + 1;
  }
  return ranks;
}
function spearman(xs, ys){ if(xs.length < 3) return null; return pearson(rankAvg(xs), rankAvg(ys)); }

/* Fisher z変換による95%信頼区間（methodology §9.2 で事前登録）。
   Pearson  SE = 1/sqrt(n-3)
   Spearman SE = sqrt((1 + rho^2/2)/(n-3))  … Bonett–Wright (2000)
            ※ sqrt(1.06/(n-3)) は Fieller et al. の近似であり別式。
   n が小さいほど区間は極端に広くなる。区間が0をまたぐ場合、符号すら確定していない。 */
function fisherCI(coef, n, kind){
  if(coef === null || coef === undefined || n < 4) return null;
  var c = Math.max(Math.min(coef, 0.999999), -0.999999);
  var z = Math.atanh ? Math.atanh(c) : 0.5 * Math.log((1+c)/(1-c));
  var se = (kind === 'pearson') ? 1/Math.sqrt(n-3) : Math.sqrt((1 + c*c/2)/(n-3));
  function th(x){ return Math.tanh ? Math.tanh(x) : (Math.exp(2*x)-1)/(Math.exp(2*x)+1); }
  return [th(z - 1.959964*se), th(z + 1.959964*se)];
}
function ciText(ci){
  if(!ci) return 'n&lt;4のため算出不能';
  return '95%CI [' + ci[0].toFixed(3) + ', ' + ci[1].toFixed(3) + ']' +
         ((ci[0] < 0 && ci[1] > 0) ? '（0をまたぐ）' : '');
}
/* n に応じた分析の位置づけ。n<6 を「主分析」とは呼ばない。 */
function tierLabel(n, scope){
  if(n < MIN_N_CALC) return '算出不能';
  if(scope === 'main') return (n < MIN_N_MAIN) ? '探索的（n&lt;' + MIN_N_MAIN + '）' : '主分析';
  return '感度分析（参考値）';
}
function critical(tbl, n){ if(n < 5) return null; return tbl[n] !== undefined ? tbl[n] : (n > 15 ? tbl[15] : null); }

/* 被説明変数ごとの定義。主分析は実装成果スコアのみ。
   総合100点スコアは説明変数（人的・組織体制）と構成概念が重複する項目
   （I-3 推進本部・IV-1 BPR専管組織・V-2 外部人材・V-3 人材採用配置 等）を含むため、
   人員数と相関させると採点設計に由来する相関が構造的に生じうる。感度分析に限定する。 */
var OUTCOMES = {
  '_impl':  {raw:'_impl',  adj:'_implA',  elig:'_implEligible', main:true,
             label:'実装成果スコア（II+III+IV-2+VI・60点）',
             rateKey:'_implRate', axis:'実装成果スコア'},
  '_score': {raw:'_score', adj:'_scoreA', elig:'_eligible',     main:false,
             label:'総合DXスコア（21項目・100点）',
             rateKey:'_unconfRate', axis:'総合DXスコア'}
};
function outcomeOf(yKey){
  return (yKey === '_scoreA' || yKey === '_score') ? OUTCOMES['_score'] : OUTCOMES['_impl'];
}

/* 指標の対を作る。scope='main' は当該被説明変数の未確認率30%以下の市に限る（methodology §6） */
function pairsFor(xKey, yKey, scope){
  var used = [], excluded = [], refOnly = [];
  var eligKey = outcomeOf(yKey).elig;
  STATE.muni.forEach(function(r){
    var hasVals = !(r[xKey] === null || r[xKey] === undefined ||
                    r[yKey] === null || r[yKey] === undefined);
    if(scope === 'main' && !r[eligKey]){
      /* 未確認率30%超。統計には入れないが、参考値として薄く表示できるよう分けて返す */
      if(hasVals) refOnly.push(r);
      excluded.push(r); return;
    }
    if(!hasVals){ excluded.push(r); return; }
    used.push(r);
  });
  return {used:used, excluded:excluded, refOnly:refOnly};
}

/* 相関の強さの言語表現。係数の絶対値だけで断定しない。 */
function strengthWord(v, n, crit){
  if(v === null) return '算出不能';
  var a = Math.abs(v), dir = v > 0 ? '正' : '負';
  var sig = (crit !== null && a >= crit);
  var core = a < 0.2 ? 'ほぼ無相関'
           : a < 0.4 ? ('弱い' + dir + 'の関係')
           : a < 0.7 ? ('中程度の' + dir + 'の関係')
           :           ('強い' + dir + 'の関係');
  if(a >= 0.2 && !sig) core += '（統計的に有意ではない）';
  return core;
}

/* ============================ 読み込み ============================ */

function loadCSV(path){
  return fetch(path, {cache:'no-cache'}).then(function(res){
    if(!res.ok) throw new Error(path + ' : HTTP ' + res.status);
    return res.arrayBuffer();
  }).then(function(buf){
    return toObjects(parseCSV(new TextDecoder('utf-8').decode(buf)));
  });
}

function boot(){
  Promise.all([loadCSV(DATA_FILES.municipalities), loadCSV(DATA_FILES.evidence),
               loadCSV(DATA_FILES.rubric), loadCSV(DATA_FILES.scoring)])
  .then(function(res){
    STATE.muni = derive(res[0]); STATE.evidence = res[1];
    STATE.rubric = res[2];       STATE.scoring = res[3];
    initFocusPicker();
    renderAll();
  }).catch(showLoadError);
}

function showLoadError(err){
  var isFile = location.protocol === 'file:';
  var el = document.getElementById('loaderr');
  el.className = 'notice err';
  el.innerHTML = '<h3>データを読み込めませんでした</h3>' +
    (isFile
      ? '<p>ローカルファイル（<code>file://</code>）として開かれています。ブラウザのセキュリティ制限により CSV を読み込めません。</p>' +
        '<p>リポジトリのルートで <code>python3 -m http.server 8000</code> を実行し <code>http://localhost:8000/</code> を開くか、GitHub Pages 上で閲覧してください。</p>'
      : '<p><code>data/</code> 配下の CSV を取得できませんでした。</p>') +
    '<p class="sub">' + esc(err && err.message ? err.message : err) + '</p>';
  el.classList.remove('hidden');
  document.getElementById('content').classList.add('hidden');
}

/* ============================ 描画 ============================ */

function renderAll(){
  renderSummary(); renderConclusion(); renderFocusSections();
  renderConfidence(); renderFooterMeta();
  initScrollSpy();
  if(location.hash){ var t = document.querySelector(location.hash); if(t) t.scrollIntoView(); }
}

/* 注目する市の選択に応じて表示が変わるセクション。統計値はいずれも選択に依存しない */
function renderFocusSections(){
  renderStaffing(); renderScoring(); renderAnalysis(); renderFocus(); renderPairs();
  renderTypology(); renderTable(); renderCoverage(); renderEvidence(); renderFocusLabel();
}

function countBy(p){ return STATE.muni.filter(p).length; }
function names(p){ return STATE.muni.filter(p).map(function(r){ return r._name; }); }
function joinNames(a){
  var f = focusRow();
  return a.map(function(n){ return (f && n === f._name) ? '<b>' + esc(n) + '</b>' : esc(n); }).join('、');
}

/* 既定の相関：広義絶対人数 × 実装成果スコア（主分析の被説明変数） */
function headline(scope, yKey){
  yKey = yKey || '_impl';
  var p = pairsFor('_dxinfo', yKey, scope);
  var xs = p.used.map(function(r){ return r._dxinfo; });
  var ys = p.used.map(function(r){ return r[yKey]; });
  var n = p.used.length, r = pearson(xs,ys), rho = spearman(xs,ys);
  return {n:n, ex:p.excluded.length, r:r, rho:rho,
          rci:fisherCI(r,n,'pearson'), rhoci:fisherCI(rho,n,'spearman'),
          rc:critical(R_CRIT,n), rhoc:critical(RHO_CRIT,n)};
}

/* ---------- 1. サマリー ---------- */

function renderSummary(){
  var total = STATE.muni.length;
  var dxinfoKnown = countBy(function(r){ return r._dxinfo !== null; });
  var scored      = countBy(function(r){ return r._score !== null; });
  var eligible    = countBy(function(r){ return r._implEligible; });
  var main = headline('main'), sens = headline('sensitivity');
  var noStaff = names(function(r){ return r._dxinfo === null; });
  var eligNames = names(function(r){ return r._implEligible; });
  var pairNames = names(function(r){ return r._implEligible && r._dxinfo !== null; });

  /* 主分析に必要なデータの充足状況（調査結果ではなく、判定材料がどこまで揃っているか） */
  function row(label, n, note, key){
    var pct = total ? Math.round(n/total*100) : 0;
    return '<tr' + (key ? ' class="key"' : '') + '><th scope="row">' + label + '</th>' +
      '<td class="n"><b class="num">' + n + '</b> / ' + total + '市</td>' +
      '<td class="meter-cell"><span class="meter" role="img" aria-label="' + pct + '%"><i style="width:' + pct + '%"></i></span></td>' +
      '<td>' + note + '</td></tr>';
  }
  document.getElementById('kpis').innerHTML =
    '<thead><tr><th scope="col">項目</th><th scope="col" class="n">確認済み</th><th scope="col" class="meter-cell"><span class="sr-only">割合</span></th><th scope="col">内訳・備考</th></tr></thead><tbody>' +
    row('調査対象', total, '沖縄県内の全「市」') +
    row('DX推進度 採点済み', scored, '凍結ルーブリック21項目・100点満点。うち実装成果13項目・60点が主分析の被説明変数') +
    row('広義人員データ 確認済み', dxinfoKnown,
        '総務省・同一定義・2024-04-01基準・確度A' + (noStaff.length ? '。未取得：' + esc(noStaff.join('、')) : '')) +
    row('主分析 対象（実装成果スコアの未確認率30%以下）', eligible,
        eligible ? esc(eligNames.join('、')) : '該当なし（全市が未確認率30%超）') +
    row('主分析の対（上の2条件をともに満たす市）', pairNames.length,
        (pairNames.length ? esc(pairNames.join('、')) + '。' : '該当なし。') +
        '相関の算出には' + MIN_N_CALC + '市以上、「主分析」と呼ぶには' + MIN_N_MAIN + '市以上が必要', true) +
    '</tbody>';

  /* 現時点の結論（ファーストビュー必須表示）。感度分析の値は参考として小さく併記する */
  var badge = document.getElementById('readiness');
  var head, body;
  if(main.n >= MIN_N_MAIN){
    head = '主分析 n=' + main.n + ' で評価';
    body = 'Spearman ρ = ' + (main.rho===null?'—':main.rho.toFixed(3)) + '（' + ciText(main.rhoci) + '）' +
      '／Pearson r = ' + (main.r===null?'—':main.r.toFixed(3)) + '（' + ciText(main.rci) + '）。' +
      '<b>有意でないことは「関係がない」ことを意味しない</b>。';
  }else if(main.n >= MIN_N_CALC){
    head = '探索的な値しか出せない（n = ' + main.n + '）';
    body = 'methodology §9.2.1 の運用基準 n≥' + MIN_N_MAIN +
      ' に達していないため、<b>主分析とは呼ばない</b>。信頼区間は ' + ciText(main.rci) + '。';
  }else{
    head = '主分析では判定できない（n = ' + main.n + '）';
    body = '主分析の対象は、<b>実装成果スコアの未確認率が30%以下</b>で、かつ<b>総務省の広義人員が確認できた</b>市である。' +
      '現在の未確認率30%以下は ' + eligible + '市' + (eligible ? '（' + esc(eligNames.join('、')) + '）' : '') + 'で、' +
      (pairNames.length === 0
        ? (eligible ? 'いずれも広義人員が未取得のため、' : '') + '<b>スコアが確定した市と人員が確定した市が重なっていない</b>。'
        : '両条件を満たす市は' + pairNames.length + '市にとどまる。') +
      '相関係数の算出に必要な' + MIN_N_CALC + '市に届かないため、仮説は正・無・負のいずれとも判定していない。' +
      '<b>これは「関係がない」という結果ではなく、判定に必要なデータが揃っていないという意味である。</b>';
  }
  badge.innerHTML =
    '<p class="status-label">現時点の結論（仮説H1：人的体制が厚いほどDXが進んでいる）</p>' +
    '<p class="status-head">' + head + '</p>' +
    '<p class="status-body">' + body + '</p>' +
    (main.n < MIN_N_MAIN ?
      '<div class="status-ref"><p class="status-ref-label"><span class="tag">参考値</span> 感度分析（未確認率30%超の市を含む・n = ' + sens.n + '）— 主結論には用いない</p>' +
      '<dl class="refvals">' +
        '<div><dt>Spearman ρ</dt><dd><span class="num">' + (sens.rho===null?'算出不能':sens.rho.toFixed(3)) + '</span> ' + (sens.rho===null?'':ciText(sens.rhoci)) + '</dd></div>' +
        '<div><dt>Pearson r</dt><dd><span class="num">' + (sens.r===null?'算出不能':sens.r.toFixed(3)) + '</span> ' + (sens.r===null?'':ciText(sens.rci)) + '</dd></div>' +
      '</dl></div>' : '');
}

/* ---------- 2. 結論 ---------- */

function renderConclusion(){
  var mainI = headline('main','_impl'), sensI = headline('sensitivity','_impl');
  var sensIA = headline('sensitivity','_implA');
  var sensT  = headline('sensitivity','_score'), sensTA = headline('sensitivity','_scoreA');
  var total = STATE.muni.length;
  var dxinfoKnown = countBy(function(r){ return r._dxinfo !== null; });
  var popKnown = countBy(function(r){ return r._pop !== null; });
  var staffKnown = countBy(function(r){ return r._staff !== null; });
  var eligT = names(function(r){ return r._eligible; });
  var eligI = names(function(r){ return r._implEligible; });
  var vals = STATE.muni.filter(function(r){ return r._dxinfo !== null; })
                       .sort(function(a,b){ return b._dxinfo - a._dxinfo; });
  var hi = vals[0], lo = vals[vals.length-1];
  var czTotal = 0, uncTotal = 0;
  STATE.scoring.forEach(function(x){
    if(x.status === '未確認') uncTotal++;
    else if(String(x.status).indexOf('確認済み') !== -1) czTotal++;
  });
  var scoreSorted = STATE.muni.slice().sort(function(a,b){ return b._impl - a._impl; });

  var confirmed = [
    '<b>5本のDeep Researchを正式統合し、11市×21項目＝231レコードを凍結ルーブリックで採点し直した。</b>' +
      'Deep Research本文の得点候補（配点超過を含む）は採用せず、<code>data/scoring_rubric.csv</code> のみを正として' +
      '「証拠 → ルーブリック条件 → 点数」の順で判定している。',
    '<b>被説明変数を2層に分けた。</b>主分析は<b>実装成果スコア</b>' +
      '（II行政手続DX＋III内部業務DX＋IV-2 BPR実績＋VI住民サービス／60点）。' +
      '総合100点スコアには「全庁的推進本部」「BPR専管組織」「外部専門人材」「デジタル人材の採用・配置」など' +
      '<b>説明変数（人的・組織体制）と構成概念が重複する項目</b>が含まれ、' +
      '人員数と相関させると採点設計に由来する相関が構造的に生じうるため、感度分析に限定している。',
    '<b>実装成果スコアはトップが' + esc(scoreSorted[0]._name) + ' ' + fmt(scoreSorted[0]._impl,1) + '点／60点。</b>' +
      '未確認率30%以下はこの尺度で <b>' + eligI.length + '市</b>' +
      (eligI.length ? '（' + esc(eligI.join('、')) + '）' : '') + '、' +
      '総合スコアでは ' + eligT.length + '市' + (eligT.length ? '（' + esc(eligT.join('、')) + '）' : '') + 'である。',
    '<b>補集合からの否定推定（旧・導出規則R3）を廃止した。</b>' +
      '第5回Deep Researchは末尾で途切れており列挙が網羅的である保証が無いため、' +
      '「取組ありに挙がっていないから0点」とした28レコードを<b>未確認へ差し戻した</b>。' +
      '確認済み0点は自治体を名指しで「無い／未実施」と報告しているもの' + czTotal + '件のみで、' +
      '未確認は' + uncTotal + '件である。',
    '<b>DX・情報関係業務担当職員数は ' + dxinfoKnown + '/' + total + '市で確定（確度A・2024年4月1日基準）。</b>' +
      '最多は' + esc(hi._name) + ' ' + hi._dxinfo + '人、最少は' + esc(lo._name) + ' ' + lo._dxinfo + '人。' +
      '那覇市・宜野湾市・浦添市は同一資料に収録されているが値が未取得。',
    '<b>人口は ' + popKnown + '/' + total + '市、普通会計職員数は ' + staffKnown + '/' + total + '市しか確定していない。</b>' +
      'このため人口補正（指標B）・職員数補正（指標C）の相関は算出できない。'
  ];

  var implication = [
    '<b>人数とDX推進度の関係は、正・無・負のいずれとも確定していない。</b>' +
      '主分析の対が作れず、感度分析の値は主結論に使えない。' +
      'この仮説が否定されること自体も成果として受け入れる設計にしている。',
    '<b>組織構造の差は事実として確認できる。</b>' +
      'DX専管組織の有無、DX企画と情報システム運用の分離、BPR専管組織の有無、外部専門人材の任用は11市で明確に分かれており、' +
      '同じ人数でも実質的にDX企画へ充てられる人員は異なる。',
    '<b>総務省の広義人員は「県内で自団体がどの位置にあるか」を同一の物差しで示す材料にはなる。</b>' +
      'ただし情報政策担当を含む合計値であり、DX専任人数として引用してはならない。'
  ];

  var cannot = [
    '<b>因果関係は主張できない。</b>係数が得られても「人を増やせばDXが進む」とは言えない。' +
      '本分析は2024年度の人員と2026年9月時点のDX推進状況を比較する約2年のラグ分析であり、逆因果を多少避けられる可能性はあるが証明にはならない。',
    '<b>感度分析の値を主結論に使ってはならない。</b>実装成果スコア（n = ' + sensI.n + '）で ' +
      'Pearson r = ' + (sensI.r===null?'—':sensI.r.toFixed(3)) + ' ' + ciText(sensI.rci) +
      '、Spearman ρ = ' + (sensI.rho===null?'—':sensI.rho.toFixed(3)) + ' ' + ciText(sensI.rhoci) + '。' +
      '<b>信頼区間はいずれも0をまたいでおり、符号すら確定していない。</b>',
    '<b>「確認できない」を「実施していない」と読み替えてはならない。</b>' +
      '未確認' + uncTotal + '件は根拠を確認できていない項目であり、非実施を意味しない。',
    '<b>有意でないことは「関係がない」ことを意味しない。</b>n が小さいため検出力が低く、中程度の関係があっても検出できない。'
  ];

  function list(items){ return '<ul>' + items.map(function(t){ return '<li>' + t + '</li>'; }).join('') + '</ul>'; }
  /* 階層：確認できた事実・示唆（本文）＞ 言えないこと（解釈上の注意として唯一枠で強調） */
  document.getElementById('conclusion').innerHTML =
    '<div class="fbox"><h3>調査から確認できたこと</h3>' + list(confirmed) + '</div>' +
    '<div class="fbox"><h3>人員配置への示唆</h3>' + list(implication) + '</div>' +
    '<div class="caution wide"><p class="caution-title">この調査だけでは言えないこと</p>' + list(cannot) + '</div>';
}

/* ---------- 3. 人的体制 ---------- */

function renderStaffing(){
  var rows = STATE.muni.slice().sort(function(a,b){
    if(a._dxinfo === null && b._dxinfo === null) return a._code - b._code;
    if(a._dxinfo === null) return 1;
    if(b._dxinfo === null) return -1;
    return b._dxinfo - a._dxinfo;
  });
  var maxV = Math.max.apply(null, rows.filter(function(r){return r._dxinfo!==null;})
                                      .map(function(r){return r._dxinfo;}));
  var html = '<table><thead><tr><th class="stick">市</th><th class="barcol">DX・情報関係業務担当職員数（2024-04-01・総務省）</th>' +
    '<th class="n">人数</th><th class="n">人口1万人あたり</th><th class="n">職員100人あたり</th><th>確度</th></tr></thead><tbody>' +
    rows.map(function(r){
      var bar = r._dxinfo === null ? '<span class="chip miss">総務省値 未取得</span>'
        : '<span class="hbar"><i style="width:' + (r._dxinfo/maxV*100).toFixed(1) + '%"></i></span>';
      return focusTr(r) +
        '<td class="stick">' + esc(r._name) + '</td><td>' + bar + '</td>' +
        '<td class="n' + (r._dxinfo===null?' missing':'') + '">' + (r._dxinfo===null?'不明':fmt(r._dxinfo)+'人') + '</td>' +
        '<td class="n' + (r._dxinfoPer10k===null?' missing':'') + '">' + (r._dxinfoPer10k===null?'不明':fmt(r._dxinfoPer10k,2)) + '</td>' +
        '<td class="n' + (r._dxinfoPer100===null?' missing':'') + '">' + (r._dxinfoPer100===null?'不明':fmt(r._dxinfoPer100,2)) + '</td>' +
        '<td>' + confChip(r.dx_info_staff_confidence) + '</td></tr>';
    }).join('') + '</tbody></table>';
  document.getElementById('staffMain').innerHTML = html;

  /* 補助分析：狭義の職務別人数（データがある市のみ） */
  var sub = STATE.muni.filter(function(r){
    return r._dx !== null || r._infra !== null || r._bpr !== null ||
           r._infoDept !== null || r._combined !== null;
  });
  var sh = '';
  if(sub.length){
    sh = '<table><thead><tr><th class="stick">市</th><th>年度</th>' +
      '<th class="n">DX専任・主担当</th><th class="n">BPR</th><th class="n">情報システム運用</th>' +
      '<th class="n">DX・BPR統合部署</th><th class="n">情報政策担当課室</th></tr></thead><tbody>' +
      sub.map(function(r){
        function c(v){ return '<td class="n' + (v===null?' missing':'') + '">' + (v===null?'不明':fmt(v)+'人') + '</td>'; }
        return focusTr(r) +
          '<td class="stick">' + esc(r._name) + '</td>' +
          '<td class="nowrap">' + esc(txt(r.dx_staff_fiscal_year)) + '</td>' +
          c(r._dx) + c(r._bpr) + c(r._infra) + c(r._combined) + c(r._infoDept) + '</tr>';
      }).join('') + '</tbody></table>';
  }else{
    sh = '<p class="tmeta">狭義の職務別人数を確認できた市はありません。</p>';
  }
  document.getElementById('staffSub').innerHTML = sh;
}

/* ---------- 4. DX推進度の採点 ---------- */

function renderScoring(){
  var rows = STATE.muni.slice().sort(function(a,b){
    if(a._impl === null && b._impl === null) return a._code - b._code;
    if(a._impl === null) return 1; if(b._impl === null) return -1;
    return b._impl - a._impl;
  });
  var implMax = rows[0] ? rows[0]._implMax : 60;
  /* 主分析の被説明変数（実装成果）と感度分析用（総合）を列グループで分け、左側を主とする */
  var html = '<table class="grouped"><thead><tr><th class="stick" rowspan="2">市</th>' +
    '<th colspan="4" class="grp grp-main">主分析の被説明変数：実装成果スコア（' + fmt(implMax,0) + '点）</th>' +
    '<th colspan="4" class="grp">参考（感度分析のみ）：総合DXスコア（100点）</th></tr>' +
    '<tr><th class="n">素点</th><th class="n">補正</th><th class="n">未確認率</th><th class="grp-end">主分析</th>' +
    '<th class="n">素点</th><th class="n">補正</th><th class="n">未確認率</th><th>30%以下</th></tr></thead><tbody>' +
    rows.map(function(r){
      return focusTr(r) +
        '<td class="stick">' + esc(r._name) + '</td>' +
        '<td class="n strong">' + fmt(r._impl,1) + '</td>' +
        '<td class="n' + (r._implA===null?' missing':'') + '">' +
          (r._implA===null?'算出不能':fmt(r._implA,1)) + '</td>' +
        '<td class="n">' + fmt(r._implRate,1) + '%</td>' +
        '<td class="grp-end"><span class="chip ' + (r._implEligible?'ok':'miss') + '">' +
          esc(txt(r.impl_main_analysis_eligible)) + '</span></td>' +
        '<td class="n">' + fmt(r._score,1) + '</td>' +
        '<td class="n' + (r._scoreA===null?' missing':'') + '">' + (r._scoreA===null?'算出不能':fmt(r._scoreA,1)) + '</td>' +
        '<td class="n">' + fmt(r._unconfRate,1) + '%</td>' +
        '<td><span class="chip ' + (r._eligible?'ok':'miss') + '">' + (r._eligible?'該当':'除外') + '</span></td></tr>';
    }).join('') + '</tbody></table>';
  document.getElementById('scoreTable').innerHTML = html;

  /* 軸別の確認済み配点 */
  var axes = {};
  STATE.rubric.forEach(function(it){ axes[it.axis_name] = axes[it.axis_name] || {max:0, got:0}; 
                                     axes[it.axis_name].max += parseFloat(it.max_points); });
  STATE.scoring.forEach(function(s){
    if(axes[s.axis_name]) axes[s.axis_name].got += parseFloat(s.points || 0);
  });
  var nCity = STATE.muni.length;
  var scaleSet = {};
  STATE.scoring.forEach(function(x){
    if(!x.scale) return;
    scaleSet[x.axis_name] = scaleSet[x.axis_name] || {};
    scaleSet[x.axis_name][x.scale] = true;
  });
  var scaleOf = {};
  Object.keys(scaleSet).forEach(function(k){
    var ks = Object.keys(scaleSet[k]).sort();
    scaleOf[k] = ks.length > 1 ? '実装成果＋体制' : ks[0];
  });
  document.getElementById('axisBreak').innerHTML =
    '<table><thead><tr><th>評価軸</th><th>尺度</th><th class="n">配点</th><th class="n">11市合計で確認できた得点</th><th>確認密度</th></tr></thead><tbody>' +
    Object.keys(axes).map(function(k){
      var a = axes[k], denom = a.max * nCity, pct = denom ? a.got/denom*100 : 0;
      var sc = scaleOf[k] || '—';
      return '<tr><td>' + esc(k) + '</td>' +
        '<td><span class="chip ' + (sc === '実装成果' ? 'ok' : '') + '">' + esc(sc) + '</span></td>' +
        '<td class="n">' + fmt(a.max,0) + '点</td>' +
        '<td class="n">' + fmt(a.got,1) + ' / ' + fmt(denom,0) + '</td>' +
        '<td><span class="hbar"><i style="width:' + pct.toFixed(1) + '%"></i></span> ' +
        '<span class="num">' + pct.toFixed(1) + '%</span></td></tr>';
    }).join('') + '</tbody></table>' +
    '<p class="hint">「実装成果」の軸だけで主分析の被説明変数を構成している。' +
    'IV BPR・業務改革は IV-2（実績の公表）のみが実装成果側、IV-1（専管組織の有無）は体制側。</p>';
}

/* ---------- 5. 人的体制 × DX推進度 ---------- */

function availableMetrics(){
  var list = MAIN_METRICS.slice();
  SUB_METRICS.forEach(function(m){
    if(STATE.muni.some(function(r){ return r[m.key] !== null; })) list.push(m);
  });
  return list;
}

function renderAnalysis(){
  var sel = document.getElementById('metricSel');
  if(!sel.options.length){
    var mains = document.createElement('optgroup'); mains.label = '主分析（総務省・広義・11市共通指標）';
    var subs  = document.createElement('optgroup'); subs.label  = '補助分析（自治体資料・狭義）';
    availableMetrics().forEach(function(m){
      var o = document.createElement('option'); o.value = m.key; o.textContent = m.label;
      (m.tier === 'main' ? mains : subs).appendChild(o);
    });
    sel.appendChild(mains);
    if(subs.children.length) sel.appendChild(subs);
    sel.addEventListener('change', function(){ renderAnalysis(); });
    document.getElementById('scoreSel').addEventListener('change', function(){ renderAnalysis(); });
    document.getElementById('scopeSel').addEventListener('change', function(e){
      STATE.scope = e.target.value; renderAnalysis();
    });
    var rt = document.getElementById('refToggle');
    if(rt) rt.addEventListener('change', function(){ renderAnalysis(); });
  }
  var mKey = sel.value || MAIN_METRICS[0].key;
  var yKey = document.getElementById('scoreSel').value || '_impl';
  var metric = availableMetrics().filter(function(m){ return m.key === mKey; })[0];
  var scope = STATE.scope;
  var p = pairsFor(mKey, yKey, scope);

  var box = document.getElementById('analysisBox');
  var rt = document.getElementById('refToggle');
  if(rt){   /* 参考値の重ね表示は主分析でのみ意味を持つ */
    rt.disabled = scope !== 'main';
    rt.parentNode.classList.toggle('is-disabled', rt.disabled);
  }
  var showRef = scope === 'main' && rt && rt.checked;
  var refs = (scope === 'main' && showRef) ? p.refOnly : [];
  var oc = outcomeOf(yKey);
  if(p.used.length >= MIN_N_CALC){
    var f = focusRow();
    var tag = scope === 'main'
      ? (p.used.length < MIN_N_MAIN ? '<span class="tag tag-warn">探索的（n&lt;' + MIN_N_MAIN + '）</span>' : '<span class="tag tag-main">主分析</span>')
      : '<span class="tag">感度分析（参考値）</span>';
    var legend = '<ul class="chart-legend">' +
      '<li><span class="lg lg-pt" aria-hidden="true"></span>' + (scope === 'main' ? '主分析対象の市' : '分析対象の市') + '（n = ' + p.used.length + '）</li>' +
      (refs.length ? '<li><span class="lg lg-ref" aria-hidden="true"></span>参考値自治体（未確認率30%超・統計に含めない）</li>' : '') +
      (f && (p.used.indexOf(f) !== -1 || refs.indexOf(f) !== -1) ? '<li><span class="lg lg-focus" aria-hidden="true"></span>注目する市（' + esc(f._name) + '）</li>' : '') +
      '<li><span class="lg lg-fit" aria-hidden="true"></span>回帰直線（参考線。因果を示さない）</li></ul>';
    box.innerHTML = '<figure class="chartbox">' +
      '<figcaption class="chart-head"><span class="chart-title">' + esc(metric.label) + ' × ' + esc(Y_LABEL[yKey] || '') + '</span>' + tag + '</figcaption>' +
      legend + scatterSVG(p.used, metric, yKey, refs) + '</figure>' +
      '<p class="tmeta">' +
      (scope === 'main'
        ? (p.used.length < MIN_N_MAIN
             ? '<b>n = ' + p.used.length + ' は methodology §9.2.1 の運用基準（n≥' + MIN_N_MAIN +
               '）に達していないため、これは<u>探索的</u>な表示です。主分析とは呼びません。</b>'
             : '<b>主分析対象 ' + p.used.length + '市のみで回帰・相関を算出しています。</b>')
        : '<b>これは感度分析（参考値）です。主結論には用いません。</b>' +
          (oc.main ? '' : '総合100点スコアは説明変数と構成概念が重複する項目を含みます。')) +
      ' プロット ' + p.used.length + '市 ／ 欠損・対象外により除外 ' + p.excluded.length + '市' +
      (p.excluded.length ? '（' + esc(p.excluded.map(function(r){return r._name;}).join('、')) + '）' : '') +
      (refs.length ? ' ／ 薄い灰色の点は<b>参考値自治体（未確認率30%超）' + refs.length +
                     '市で、統計計算には含めていません</b>' : '') +
      '。欠損値は0として扱っていません。' + focusPlotNote(p, refs) + '</p>';
  }else{
    box.innerHTML = shortageHTML(p, metric, scope);
  }
  renderCorrelation(yKey, scope);
}

/* 選択市が散布図に描かれていない場合の理由。強調のみで分析対象は変えない */
function focusPlotNote(p, refs){
  var f = focusRow();
  if(!f || p.used.indexOf(f) !== -1) return '';
  return ' <b>注目する市（' + esc(f._name) + '）</b>は' +
    (refs.indexOf(f) !== -1 ? '参考値（統計計算の対象外）として表示しています。'
     : (p.refOnly.indexOf(f) !== -1 ? '未確認率30%超のため主分析の対象外です（参考値自治体の表示で確認できます）。'
                                     : 'この組み合わせの値が欠損または対象外のため表示していません。'));
}

function shortageHTML(p, metric, scope){
  var total = STATE.muni.length;
  var reqs = [
    {label:'DX・情報関係業務担当職員数', n:countBy(function(r){ return r._dxinfo !== null; })},
    {label:'人口',                      n:countBy(function(r){ return r._pop   !== null; })},
    {label:'総職員数',                  n:countBy(function(r){ return r._staff !== null; })},
    {label:'実装成果スコア（未確認率30%以下）', n:countBy(function(r){ return r._implEligible; })}
  ];
  var ocS = outcomeOf(document.getElementById('scoreSel').value || '_impl');
  var elig = names(function(r){ return r[ocS.elig]; });
  var lack = STATE.muni.filter(function(r){ return r[ocS.elig] && r[metric.key] === null; })
                       .map(function(r){ return r._name; });
  var why = scope === 'main'
    ? '<b>主分析の対象市が' + MIN_N_CALC + '市未満です。</b>' + esc(ocS.axis) + 'の未確認率30%以下の市は ' +
      elig.length + '市' + (elig.length ? '（' + esc(elig.join('、')) + '）' : '') + 'で、' +
      (lack.length ? (lack.length === elig.length ? 'いずれも' : esc(lack.join('、')) + 'は') +
        '「' + esc(metric.label) + '」が未取得のため対が作れません。<b>スコアが確定した市と人員が確定した市が重なっていない</b>ことが直接の原因です。'
        : '凍結ルール（methodology §6）により他市は除外されています。') +
      '上の「分析範囲」を「感度分析」に切り替えると参考値を表示します。'
    : '<b>この指標の対を' + MIN_N_CALC + '件以上作れません。</b>「' + esc(metric.label) + '」の分母となるデータが不足しています。';
  return '<div class="shortage"><p class="shortage-tag">' +
    (scope === 'main' ? '<span class="tag tag-main">主分析</span>' : '<span class="tag">感度分析（参考値）</span>') +
    ' 有効な対 n = ' + p.used.length + '</p>' +
    '<h3>この組み合わせでは散布図を表示できません</h3><p>' + why +
    'これは「相関がない」という結果ではなく、<b>判定に必要な数値が揃っていない</b>という意味です。</p>' +
    '<div class="reqgrid">' + reqs.map(function(q){
      return '<div class="req"><div class="r-label">' + q.label + ' 確認済み</div>' +
        '<div class="r-value num">' + q.n + '<span class="of"> / ' + total + '市</span></div>' +
        '<div class="bar"><i style="width:' + Math.round(q.n/total*100) + '%"></i></div></div>';
    }).join('') + '</div>' +
    '<div class="nextstep"><p class="nextstep-title">あと何が分かれば仮説を検証できるか（優先順）</p><ol>' +
    '<li>総務省資料の Excel 1753／1754／1756行から<b>那覇市・宜野湾市・浦添市の広義人員</b>を取得する。' +
    'この3市は現在スコアの確定度が最も高く、値が入れば主分析が直ちに成立します。</li>' +
    '<li>J-LIS「コンビニ交付提供市区町村」一覧で<b>VI-2を11市分</b>確定する（現在は自治体名が特定できず9市が未確認）。</li>' +
    '<li>総務省調査の工程表・KPI欄（I-4）と、III-4・VI-4・II-2 の自治体別確認を進める。</li>' +
    '<li>11市同一定義の人口と普通会計職員数を取得すれば、人口補正・職員数補正の分析が自動的に有効になります。</li></ol></div></div>';
}

var Y_LABEL = {'_impl':'実装成果スコア（素点・60点）','_implA':'実装成果スコア（補正）',
               '_score':'総合DXスコア（素点・100点）','_scoreA':'総合DXスコア（補正）'};

function scatterSVG(rows, metric, yKey, refRows){
  refRows = refRows || [];
  var W = 880, H = 430, m = {t:14, r:30, b:56, l:62};
  var xs = rows.map(function(r){ return r[metric.key]; });
  var ys = rows.map(function(r){ return r[yKey]; });
  /* 軸の範囲は参考値も収まるように取るが、回帰・相関は主分析対象のみで計算する */
  var axs = xs.concat(refRows.map(function(r){ return r[metric.key]; }));
  var ays = ys.concat(refRows.map(function(r){ return r[yKey]; }));
  var xMin = Math.min.apply(null, axs), xMax = Math.max.apply(null, axs);
  var yMin = Math.min.apply(null, ays), yMax = Math.max.apply(null, ays);
  var padX = (xMax - xMin) * 0.12 || Math.max(1, Math.abs(xMax) * 0.1);
  var padY = (yMax - yMin) * 0.12 || Math.max(1, Math.abs(yMax) * 0.1);
  xMin -= padX; xMax += padX; yMin -= padY; yMax += padY;
  yMin = Math.min(yMin, 0); yMax = Math.max(yMax, 20);

  function sx(v){ return m.l + (v - xMin) / (xMax - xMin) * (W - m.l - m.r); }
  function sy(v){ return H - m.b - (v - yMin) / (yMax - yMin) * (H - m.t - m.b); }
  function ticks(lo, hi, c){
    var span = hi - lo, step = Math.pow(10, Math.floor(Math.log(span/c)/Math.LN10));
    var err = span / c / step;
    if(err >= 7.5) step *= 10; else if(err >= 3) step *= 5; else if(err >= 1.5) step *= 2;
    var out = [], v = Math.ceil(lo/step)*step;
    for(; v <= hi + step*1e-6; v += step){
      var t = Math.round(v*1e6)/1e6;
      if(Math.abs(t) < 1e-9) t = 0;   /* -0 と表示されるのを防ぐ */
      out.push(t);
    }
    return out;
  }

  var s = '<svg class="scatter" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="人的体制とDX推進度の散布図">';
  s += '<g class="grid">';
  ticks(yMin,yMax,6).forEach(function(t){ s += '<line x1="'+m.l+'" x2="'+(W-m.r)+'" y1="'+sy(t).toFixed(1)+'" y2="'+sy(t).toFixed(1)+'"/>'; });
  s += '</g><g class="axis"><line x1="'+m.l+'" x2="'+(W-m.r)+'" y1="'+(H-m.b)+'" y2="'+(H-m.b)+'"/>' +
       '<line x1="'+m.l+'" x2="'+m.l+'" y1="'+m.t+'" y2="'+(H-m.b)+'"/></g>';
  ticks(xMin,xMax,6).forEach(function(t){ s += '<text x="'+sx(t).toFixed(1)+'" y="'+(H-m.b+17)+'" text-anchor="middle">'+fmt(t)+'</text>'; });
  ticks(yMin,yMax,6).forEach(function(t){ s += '<text x="'+(m.l-9)+'" y="'+(sy(t)+4).toFixed(1)+'" text-anchor="end">'+fmt(t)+'</text>'; });
  s += '<text class="atitle" x="'+((m.l+W-m.r)/2)+'" y="'+(H-10)+'" text-anchor="middle">'+esc(metric.label)+'（'+esc(metric.unit)+'）</text>';
  s += '<text class="atitle" transform="translate(16,'+((m.t+H-m.b)/2)+') rotate(-90)" text-anchor="middle">' +
       (Y_LABEL[yKey] || 'DX推進度') + '</text>';

  /* 回帰直線（最小二乗）。参考線であり、因果を示すものではない。 */
  if(rows.length >= 3){
    var n = xs.length, mx = xs.reduce(function(a,b){return a+b;},0)/n, my = ys.reduce(function(a,b){return a+b;},0)/n;
    var sxy = 0, sxx = 0;
    for(var i=0;i<n;i++){ sxy += (xs[i]-mx)*(ys[i]-my); sxx += (xs[i]-mx)*(xs[i]-mx); }
    if(sxx > 0){
      var b1 = sxy/sxx, b0 = my - b1*mx;
      s += '<line class="fit" x1="'+sx(xMin).toFixed(1)+'" y1="'+sy(b0+b1*xMin).toFixed(1)+
           '" x2="'+sx(xMax).toFixed(1)+'" y2="'+sy(b0+b1*xMax).toFixed(1)+'"/>';
    }
  }
  /* 参考値自治体（未確認率30%超）。薄く別マーカーで描き、統計には含めない。 */
  refRows.forEach(function(r){
    var cx = sx(r[metric.key]), cy = sy(r[yKey]), f = isFocus(r);
    if(f) s += '<circle class="ring" cx="'+cx.toFixed(1)+'" cy="'+cy.toFixed(1)+'" r="10"/>';
    s += '<circle class="pt is-ref'+(f?' focus':'')+'" cx="'+cx.toFixed(1)+'" cy="'+cy.toFixed(1)+'" r="'+(f?6:4.5)+'">' +
         '<title>'+esc(r._name)+'（参考値・主分析対象外）\n'+esc(metric.label)+': '+fmt(r[metric.key])+
         '\n'+esc(Y_LABEL[yKey]||'DX推進度')+': '+fmt(r[yKey],1)+
         '\n未確認率: '+fmt(r[outcomeOf(yKey).rateKey],1)+'%</title></circle>';
    s += '<text class="lbl is-ref'+(f?' focus':'')+'" x="'+(cx+7).toFixed(1)+'" y="'+(cy+3.5).toFixed(1)+'">'+esc(r._name)+'</text>';
  });

  /* ラベルの重なり回避：既に置いたラベルと近接する場合は下方向へずらす */
  var placed = [];
  function labelY(cx, cy){
    var y = cy + 3.5, guard = 0;
    while(guard++ < 12 && placed.some(function(q){
      return Math.abs(q.x - cx) < 66 && Math.abs(q.y - y) < 12;
    })) y += 12.5;
    placed.push({x:cx, y:y});
    return y;
  }
  rows.forEach(function(r){
    var cx = sx(r[metric.key]), cy = sy(r[yKey]), f = isFocus(r);
    /* 注目する市は色だけでなく外周リング（形）でも区別する */
    if(f) s += '<circle class="ring" cx="'+cx.toFixed(1)+'" cy="'+cy.toFixed(1)+'" r="10"/>';
    s += '<circle class="pt'+(f?' focus':'')+'" cx="'+cx.toFixed(1)+'" cy="'+cy.toFixed(1)+'" r="'+(f?6:5)+'">' +
         '<title>'+esc(r._name)+'\n'+esc(metric.label)+': '+fmt(r[metric.key])+
         '\n'+esc(Y_LABEL[yKey]||'DX推進度')+': '+fmt(r[yKey],1)+
         '\n未確認率: '+fmt(r[outcomeOf(yKey).rateKey],1)+'%</title></circle>';
    var ly = labelY(cx, cy);
    if(ly > cy + 6){   /* ずらした場合は引き出し線を引く */
      s += '<line class="lead" x1="'+(cx+5).toFixed(1)+'" y1="'+cy.toFixed(1)+
           '" x2="'+(cx+7).toFixed(1)+'" y2="'+(ly-3.5).toFixed(1)+'"/>';
    }
    s += '<text class="lbl'+(f?' focus':'')+'" x="'+(cx+8).toFixed(1)+'" y="'+ly.toFixed(1)+'">'+esc(r._name)+'</text>';
  });
  return s + '</svg>';
}

function renderCorrelation(yKey, scope){
  var oc = outcomeOf(yKey);
  var head = '<p class="hint">' +
    '被説明変数：<b>' + esc(Y_LABEL[yKey] || '') + '</b>' +
    (oc.main
      ? '（主分析の被説明変数。人的・組織体制そのものを測る項目を除いた部分尺度）'
      : '（<b>参考</b>。説明変数と構成概念が重複する I-3・IV-1・V-2・V-3 等を含むため主結論に用いない）') +
    '／範囲：' + (scope==='main' ? '主分析（未確認率30%以下）' : '感度分析（参考値を含む全市）') +
    '。95%信頼区間は Fisher z 変換による（Spearman は Bonett–Wright: SE=√((1+ρ²/2)/(n−3))）。</p>';

  /* 1指標＝1行。係数・信頼区間・判定を同じ列に揃え、指標間で横断比較できるようにする */
  function coefCell(v, ci, n, crit){
    if(v === null) return '<td class="coef missing">算出不能</td>';
    return '<td class="coef"><span class="cv num">' + v.toFixed(3) + '</span>' +
      '<span class="ci">' + ciText(ci) + '</span><span class="ci">' + strengthWord(v,n,crit) + '</span></td>';
  }
  var rows = availableMetrics().map(function(m){
    var p = pairsFor(m.key, yKey, scope);
    var n = p.used.length;
    var tier = m.tier === 'main' ? '<span class="tag">主分析指標</span>' : '<span class="tag tag-warn">補助・狭義</span>';
    var exc = '除外 ' + p.excluded.length + '市' +
      (p.excluded.length ? '<span class="ci">' + esc(p.excluded.map(function(x){return x._name;}).join('、')) + '</span>' : '');
    function label(tl, cls){
      return '<th scope="row">' + esc(m.label) + ' × ' + esc(Y_LABEL[yKey] || '') +
        '<span class="tags">' + tier + '<span class="tag' + (cls||'') + '">' + tl + '</span></span></th>';
    }
    if(n < MIN_N_CALC){
      return '<tr class="unavailable">' + label('算出不能') +
        '<td class="n">有効な対 n = ' + n + '<span class="ci">' + exc + '</span></td>' +
        '<td class="coef missing">算出不能</td><td class="coef missing">算出不能</td>' +
        '<td>データ不足のため算出していません。<b>相関がないという意味ではありません。</b></td></tr>';
    }
    var xs = p.used.map(function(r){ return r[m.key]; });
    var ys = p.used.map(function(r){ return r[yKey]; });
    var r = pearson(xs,ys), rho = spearman(xs,ys);
    var rci = fisherCI(r,n,'pearson'), rhoci = fisherCI(rho,n,'spearman');
    var rc = critical(R_CRIT,n), rhoc = critical(RHO_CRIT,n);
    var tl = tierLabel(n, scope);
    var weak = (scope === 'main' && n < MIN_N_MAIN);
    return '<tr' + (weak ? ' class="unavailable"' : '') + '>' +
      label(tl, scope === 'main' && !weak ? ' tag-main' : (weak ? ' tag-warn' : '')) +
      '<td class="n">分析対象 n = ' + n + '市<span class="ci">' + exc + '</span></td>' +
      coefCell(rho, rhoci, n, rhoc) + coefCell(r, rci, n, rc) +
      '<td>有意水準5%（両側）臨界値：ρ = ' + (rhoc===null?'—':rhoc.toFixed(3)) + ' ／ r = ' + (rc===null?'—':rc.toFixed(3)) +
      (weak ? '<br><b>n&lt;' + MIN_N_MAIN + ' のため探索的な値です。主分析とは呼びません。</b>' : '') + '</td></tr>';
  });
  document.getElementById('corrgrid').innerHTML = head +
    '<div class="tablewrap"><table class="corrtable"><thead><tr><th>指標の組み合わせ・位置づけ</th><th class="n">対象数</th>' +
    '<th class="n">Spearman ρ<small>（主指標）</small></th><th class="n">Pearson r<small>（併記）</small></th><th>備考</th></tr></thead><tbody>' +
    rows.join('') + '</tbody></table></div>';
}

/* ---------- 6. 選択市の相対的位置 ---------- */

/* 選択市の組織構造に関する説明。CSVの分類結果だけから組み立て、市固有の文言は持たない */
var FUNC_NOTE = {
  'integrated': 'DX企画と情報システム運用が同一組織であり、広義人員のうちDX企画に充てられる人数は本数値からは分離できない。',
  'separated':  'DX企画と情報システム運用が別組織である。広義人員は両担当課室の合計であり、DX企画の人数そのものではない。',
  'split-dept': 'DX担当が複数の部署に分かれており、広義人員を部署別・職務別に按分することはできない。',
  'unknown':    '情報政策担当部署の情報が不足しており、DX企画と情報システム運用の分離状況は分類できない。'
};

function renderFocus(){
  var box = document.getElementById('focusBox');
  var known = STATE.muni.filter(function(r){ return r._dxinfo !== null; });
  var vals = known.map(function(r){ return r._dxinfo; });
  var med = vals.length ? (function(a){ var s=a.slice().sort(function(x,y){return x-y;}), k=Math.floor(s.length/2);
             return s.length%2 ? s[k] : (s[k-1]+s[k])/2; })(vals) : null;
  var mean = vals.length ? vals.reduce(function(a,b){return a+b;},0)/vals.length : null;

  function stat(l,v,n){ return '<div class="req"><div class="r-label">'+l+'</div><div class="r-value num">'+v+'</div>' +
    (n?'<div class="r-note">'+n+'</div>':'') + '</div>'; }
  var distStat = stat('広義人員 確認済み市の中央値', med===null?'算出不能':fmt(med)+'<span class="of">人</span>',
    mean===null?'確認済みの市がない':'平均 '+fmt(mean,1)+'人（確認済み '+known.length+'市 / 全'+STATE.muni.length+'市）');

  var f = focusRow();
  if(!f){
    box.innerHTML = '<div class="reqgrid single">' + distStat + '</div>' +
      '<p class="hint">ページ上部の「注目する市」で<b>市を選択すると相対的位置を確認できます</b>。</p>' +
      '<p class="hint">比較方法：総務省の広義人員（DX・情報関係業務担当職員数）は、値が確認できた市の中で多い順の位置と、' +
      '確認済み市の中央値・平均値を示す。人口1万人あたり・職員100人あたりは分母が取得できた場合のみ算出する。' +
      '組織類型と実装成果スコア（未確認率つき）は全市共通の分類・採点結果をそのまま示す。' +
      '<b>未取得値は「不明」「算出不能」とし、0で補完しない。</b>どの市を選んでも評価・統計処理は変わらない。</p>';
    return;
  }

  /* 同値は同順位（多い順）。値が欠損の市は順位付けしない */
  var rankTxt;
  if(f._dxinfo === null){
    rankTxt = '総務省値 未取得のため相対的位置は算出不能';
  }else{
    var above = vals.filter(function(v){ return v > f._dxinfo; }).length;
    var tie   = vals.filter(function(v){ return v === f._dxinfo; }).length;
    rankTxt = '確認済み' + known.length + '市中 多い方から' + (above+1) + '番目' +
      (tie > 1 ? '（同数' + tie + '市）' : '') + '／中央値' +
      (f._dxinfo > med ? 'より多い' : (f._dxinfo < med ? 'より少ない' : 'と同じ'));
  }
  var org = ORG_GROUPS.filter(function(g){ return g.id === f._orgGroup; })[0];
  var ratioNote = function(v, denomMissing){
    if(v !== null) return '';
    return f._dxinfo === null ? '広義人員が未取得のため算出不能' : denomMissing + 'が未取得のため算出不能';
  };
  var same = names(function(r){ return r._orgGroup === f._orgGroup && !isFocus(r); });

  box.innerHTML =
    '<p class="focushead"><span class="chip focus">選択中</span> <b>' + esc(f._name) + '</b>' +
      '<span class="tmeta">団体コード ' + esc(txt(f.municipality_code)) + '</span></p>' +
    '<div class="reqgrid">' +
      stat('DX・情報関係業務担当職員数', (f._dxinfo===null?'不明':fmt(f._dxinfo)+'<span class="of">人</span>'), rankTxt) +
      distStat +
      stat('人口1万人あたり', (f._dxinfoPer10k===null?'算出不能':fmt(f._dxinfoPer10k,2)), ratioNote(f._dxinfoPer10k,'人口')) +
      stat('職員100人あたり', (f._dxinfoPer100===null?'算出不能':fmt(f._dxinfoPer100,2)), ratioNote(f._dxinfoPer100,'総職員数')) +
      stat('DX専管組織・組織類型', (org?org.name:'不明'), esc(txt(f.dedicated_dx_org)) + '／' + FUNC_LABEL[f._funcType]) +
      stat('実装成果スコア', (f._impl===null?'不明':fmt(f._impl,1)+'<span class="of"> / '+fmt(f._implMax,0)+'</span>'),
           '未確認率 '+(f._implRate===null?'不明':fmt(f._implRate,1)+'%')+'（主分析 '+esc(txt(f.impl_main_analysis_eligible))+'）') +
    '</div>' +

    '<p class="hint">' + esc(f._name) + 'のDX担当部署は「' + esc(txt(f.dx_department)) + '」、情報政策担当は「' +
    esc(txt(f.info_policy_department)) + '」で、「' + (org?org.name:'不明') + '」かつ「' + FUNC_LABEL[f._funcType] + '」に分類される。' +
    FUNC_NOTE[f._funcType] +
    (same.length ? '同じ区分（' + (org?org.name:'不明') + '）の市は' + joinNames(same) + '。' : '') +
    '<b>これは順位付けを目的とした表示ではなく、県内での相対的位置の確認である。</b></p>';
}

/* ---------- 7. 事前登録ペア比較 ---------- */

function renderPairs(){
  var by = {}; STATE.muni.forEach(function(r){ by[r._name] = r; });
  function cell(r,k,d,suf){
    var v = r[k];
    return '<td class="n' + (v===null?' missing':'') + '">' + (v===null?'不明':fmt(v,d)+(suf||'')) + '</td>';
  }
  function orgName(r){ var g = ORG_GROUPS.filter(function(x){return x.id===r._orgGroup;})[0]; return g?g.name:'不明'; }

  var html = PRESET_PAIRS.map(function(p){
    var a = by[p.a], b = by[p.b];
    if(!a || !b) return '';
    /* 選択市を含むペアは枠と見出しで強調するだけで、並び順・組み合わせは変えない */
    var fa = isFocus(a), fb = isFocus(b), feat = fa || fb;
    function th(r, f){ return '<th class="n' + (f ? ' is-focus' : '') + '">' + esc(r._name) + '</th>'; }
    return '<div class="pair' + (feat?' is-focus':'') + '">' +
      '<div class="phead"><b>' + esc(p.a) + '</b> ⇔ <b>' + esc(p.b) + '</b>' +
      (feat ? ' <span class="chip focus">選択中の市を含む</span>' : '') +
      '<span class="pnote">' + esc(p.note) + '</span></div>' +
      '<table><thead><tr><th>指標</th>' + th(a, fa) + th(b, fb) + '</tr></thead><tbody>' +
      '<tr><td>人口</td>' + cell(a,'_pop',0,'人') + cell(b,'_pop',0,'人') + '</tr>' +
      '<tr><td>DX・情報関係業務担当職員数</td>' + cell(a,'_dxinfo',0,'人') + cell(b,'_dxinfo',0,'人') + '</tr>' +
      '<tr><td>人口1万人あたり</td>' + cell(a,'_dxinfoPer10k',2) + cell(b,'_dxinfoPer10k',2) + '</tr>' +
      '<tr><td>職員100人あたり</td>' + cell(a,'_dxinfoPer100',2) + cell(b,'_dxinfoPer100',2) + '</tr>' +
      '<tr><td>実装成果スコア（60点）</td>' + cell(a,'_impl',1) + cell(b,'_impl',1) + '</tr>' +
      '<tr><td>　同 未確認率</td>' + cell(a,'_implRate',1,'%') + cell(b,'_implRate',1,'%') + '</tr>' +
      '<tr><td>総合DXスコア（100点）</td>' + cell(a,'_score',1) + cell(b,'_score',1) + '</tr>' +
      '<tr><td>　同 未確認率</td>' + cell(a,'_unconfRate',1,'%') + cell(b,'_unconfRate',1,'%') + '</tr>' +
      '<tr><td>組織類型</td><td>' + orgName(a) + '<br><span class="sub">' + FUNC_LABEL[a._funcType] + '</span></td>' +
      '<td>' + orgName(b) + '<br><span class="sub">' + FUNC_LABEL[b._funcType] + '</span></td></tr>' +
      '</tbody></table></div>';
  }).join('');
  document.getElementById('pairs').innerHTML = html;
}

/* ---------- 8. 組織類型 ---------- */

function confChip(v){
  var c = txt(v, '不明');
  var ok = (c === 'A' || c === 'B' || c === 'C');
  return '<span class="conf ' + (ok?'conf-'+c:'conf-X') + '" title="確度' + esc(c) + '：' +
    esc(CONF_DESC[c] || '判断できない') + '">' + (ok?c:'?') + '</span>';
}

function renderTypology(){
  var html = ORG_GROUPS.map(function(g){
    var rows = STATE.muni.filter(function(r){ return r._orgGroup === g.id; });
    if(!rows.length) return '';
    return '<div class="grouprow"><div class="grouphead">' +
      '<span class="gname">' + g.name + '</span><span class="gcount num">' + rows.length + '市</span>' +
      '<span class="gdesc">' + g.desc + '</span></div><div class="cards">' +
      rows.map(function(r){
        return '<div class="card' + (isFocus(r) ? ' is-focus' : '') + '">' +
          '<div class="cname">' + esc(r._name) +
            (isFocus(r) ? ' <span class="chip focus">選択中</span>' : '') +
            confChip(r.dx_department_confidence) + '</div>' +
          '<div class="cdept">' + esc(txt(r.dx_department)) + '</div>' +
          '<div class="cmeta"><span class="chip">' + esc(txt(r.org_hierarchy)) + '</span>' +
          '<span class="chip ' + (r._funcType==='unknown'?'miss':'') + '">' + FUNC_LABEL[r._funcType] + '</span>' +
          (r._hasBpr ? '<span class="chip ok">業務改善組織あり</span>' : '<span class="chip miss">業務改善組織 未確認</span>') +
          '</div>' +
          '<div class="cstat">広義人員 <b class="num">' + (r._dxinfo===null?'不明':fmt(r._dxinfo)+'人') + '</b>' +
          '　実装成果 <b class="num">' + fmt(r._impl,1) + '</b>/' + fmt(r._implMax,0) + '</div>' +
          '<details data-key="org:' + esc(r._name) + '"><summary>詳細</summary><dl>' +
            '<dt>情報政策担当</dt><dd>' + esc(txt(r.info_policy_department)) + '</dd>' +
            '<dt>業務改善担当</dt><dd>' + esc(txt(r.bpr_department)) + '</dd>' +
            '<dt>設置時期</dt><dd>' + esc(txt(r.dx_org_established)) + '</dd>' +
            '<dt>狭義DX人数</dt><dd>' + (r._dx===null?'不明':fmt(r._dx)+'人（'+esc(txt(r.dx_staff_fiscal_year))+'）') + '</dd>' +
            '<dt>未確認率</dt><dd>' + fmt(r._unconfRate,1) + '%</dd>' +
          '</dl></details></div>';
      }).join('') + '</div></div>';
  }).join('');
  document.getElementById('typology').innerHTML = html;

  /* 組織構造の定性比較（新たなスコアは作らない。CSVの事実をそのまま並べる） */
  var OC = [
    {label:'DX専管組織', get:function(r){ return txt(r.dedicated_dx_org); }},
    {label:'DXと情報システム運用の分離', get:function(r){ return FUNC_LABEL[r._funcType]; }},
    {label:'BPR・業務改善組織', get:function(r){ return txt(r.bpr_department); }},
    {label:'DX＋BPR一体型', get:function(r){ return txt(r.dx_bpr_integrated); }},
    {label:'外部専門人材', get:function(r){ return txt(r.external_expert); }},
    {label:'情報政策課兼務型', get:function(r){
        return r._orgGroup === 'concurrent' ? '該当' : (r._orgGroup === 'dedicated' ? '非該当' : '要確認'); }}
  ];
  var ocEl = document.getElementById('orgmatrix');
  if(ocEl){
    ocEl.innerHTML = '<table><thead><tr><th class="stick">観点</th>' +
      STATE.muni.map(function(r){
        return '<th' + (isFocus(r) ? ' class="is-focus"' : '') + '>' + esc(r._name) + '</th>';
      }).join('') + '</tr></thead><tbody>' +
      OC.map(function(c){
        return '<tr><td class="stick">' + c.label + '</td>' +
          STATE.muni.map(function(r){
            var v = c.get(r);
            var cls = (isMissing(v) ? 'missing' : '') + (isFocus(r) ? ' is-focus' : '');
            return '<td' + (cls ? ' class="' + cls.trim() + '"' : '') + '>' + esc(v) + '</td>';
          }).join('') + '</tr>';
      }).join('') + '</tbody></table>';
  }

  var integ = names(function(r){ return r._funcType === 'integrated'; });
  var sep   = names(function(r){ return r._funcType === 'separated'; });
  document.getElementById('typonote').innerHTML =
    '<b>機能一体型（' + integ.length + '市）</b>：' + joinNames(integ) + ' — DX企画と情報システム運用が同一組織。広義人員のうちDX企画に充てられる人数は本数値からは分離できない。<br>' +
    '<b>機能分離型（' + sep.length + '市）</b>：' + joinNames(sep) + ' — 両機能が別組織。<br>' +
    '同じ人数でも実質的な体制は異なるため、<b>人数の比較だけでは体制の厚さを評価できない</b>。<br>' +
    'これらは<b>定性的な比較であり、新たなスコアは作っていない</b>。' +
    '未確認率が市によって大きく異なるため、<b>類型ごとのDX推進度の差を統計的に検証できる段階にはない</b>。';
}

/* ---------- 9. 市別比較表 ---------- */

var COLUMNS = [
  {key:'_name', label:'市', type:'text', stick:true, sortKey:'_code', sortType:'num'},
  {key:'dx_department', label:'DX担当部署', type:'text'},
  {key:'_orgGroup', label:'専任組織', type:'group'},
  {key:'bpr_department', label:'BPR・業務改善部署', type:'text'},
  {key:'_dxinfo', label:'DX・情報関係<br>業務担当職員数', type:'num', digits:0},
  {key:'_dx', label:'参考：DX専任<br>主担当（狭義）', type:'num', digits:0},
  {key:'_dxinfoPer10k', label:'人口1万人<br>あたり', type:'num', digits:2},
  {key:'_impl', label:'実装成果<br>スコア', type:'num', digits:1},
  {key:'_score', label:'総合DX<br>スコア', type:'num', digits:1},
  {key:'_implRate', label:'実装成果<br>未確認率', type:'num', digits:1},
  {key:'dx_info_staff_confidence', label:'人員確度', type:'conf'}
];

function renderTable(){
  var search = document.getElementById('tsearch'), filter = document.getElementById('tfilter');
  if(!filter.options.length){
    [['all','すべての市']].concat(ORG_GROUPS.map(function(g){ return [g.id, g.name]; }))
      .concat(Object.keys(FUNC_LABEL).map(function(k){ return ['f:'+k, FUNC_LABEL[k]]; }))
      .forEach(function(o){ var e = document.createElement('option'); e.value = o[0]; e.textContent = o[1]; filter.appendChild(e); });
    filter.addEventListener('change', renderTable);
    search.addEventListener('input', renderTable);
  }
  var q = search.value.trim(), f = filter.value;
  var rows = STATE.muni.filter(function(r){
    if(q && r._name.indexOf(q) === -1 && String(r.dx_department).indexOf(q) === -1) return false;
    if(f === 'all' || !f) return true;
    if(f.indexOf('f:') === 0) return r._funcType === f.slice(2);
    return r._orgGroup === f;
  });
  var sk = STATE.sort.key, dir = STATE.sort.dir;
  var col = COLUMNS.filter(function(c){ return (c.sortKey||c.key) === sk; })[0] || COLUMNS[0];
  var stype = col.sortType || col.type;
  rows = rows.slice().sort(function(a,b){
    var av = a[sk], bv = b[sk];
    if(stype === 'num'){
      if(av === null && bv === null) return a._code - b._code;
      if(av === null) return 1; if(bv === null) return -1;
      return (av - bv) * dir;
    }
    return String(av===undefined?'':av).localeCompare(String(bv===undefined?'':bv),'ja') * dir;
  });
  /* 並べ替えは見出し内のボタンで行う（キーボード操作可・aria-sort で状態を通知） */
  document.getElementById('thead').innerHTML = '<tr>' + COLUMNS.map(function(c){
    var k = c.sortKey || c.key, on = (k === sk);
    var ar = '<span class="arrow" aria-hidden="true">' + (on ? (dir>0?'▲':'▼') : '↕') + '</span>';
    return '<th class="sortable' + (c.stick?' stick':'') + (c.type==='num'?' n':'') + (on?' sorted':'') + '" data-key="' + k + '"' +
      ' aria-sort="' + (on ? (dir>0?'ascending':'descending') : 'none') + '">' +
      '<button type="button" class="sortbtn" data-key="' + k + '"><span>' + c.label + '</span>' + ar + '</button></th>';
  }).join('') + '</tr>';
  document.getElementById('tbody').innerHTML = rows.map(function(r){
    return focusTr(r) + COLUMNS.map(function(c){
      var v = r[c.key];
      if(c.type === 'num') return '<td class="n' + (v===null?' missing':'') + '">' + (v===null?'不明':fmt(v,c.digits)) + '</td>';
      if(c.type === 'conf') return '<td>' + confChip(v) + '</td>';
      if(c.type === 'group'){
        var g = ORG_GROUPS.filter(function(x){ return x.id === v; })[0];
        return '<td><span class="chip ' + (v==='dedicated'?'ok':(v==='unknown'?'miss':'')) + '">' + (g?g.name:'—') + '</span></td>';
      }
      return '<td class="' + (c.stick?'stick':'') + (isMissing(v)?' missing':'') + '">' + esc(txt(v)) + '</td>';
    }).join('') + '</tr>';
  }).join('') || '<tr><td colspan="' + COLUMNS.length + '" class="empty">該当する市がありません。検索語または絞り込みを変更してください。</td></tr>';
  document.getElementById('tcount').innerHTML = '表示 <b class="num">' + rows.length + '</b> 市 / 全' + STATE.muni.length + '市';
  document.getElementById('tmeta').innerHTML =
    '既定は団体コード順。' +
    '<b>「DX・情報関係業務担当職員数」（広義・総務省）と「DX専任・主担当（狭義）」は定義が異なる別の指標</b>であり、合算・比較してはいけません。' +
    '「不明」は欠損であり 0 ではありません。';
  Array.prototype.forEach.call(document.querySelectorAll('#thead .sortbtn'), function(btn){
    btn.addEventListener('click', function(){
      var k = btn.getAttribute('data-key');
      STATE.sort = (STATE.sort.key === k) ? {key:k, dir:-STATE.sort.dir} : {key:k, dir:1};
      renderTable();
      var again = document.querySelector('#thead .sortbtn[data-key="' + k + '"]');
      if(again) again.focus();
    });
  });
}

/* ---------- 10. データ充足度・情報確度 ---------- */

var COV_FIELDS = [
  {label:'広義人員<br>（総務省）', test:function(r){ return r._dxinfo !== null; }},
  {label:'狭義DX人数',   test:function(r){ return r._dx    !== null; }},
  {label:'人口',         test:function(r){ return r._pop   !== null; }},
  {label:'総職員数',     test:function(r){ return r._staff !== null; }},
  {label:'DX推進度<br>採点', test:function(r){ return r._score !== null; }},
  {label:'主分析<br>対象', test:function(r){ return r._implEligible; }}
];
function evidenceFor(n){ return STATE.evidence.filter(function(e){ return String(e.municipality).trim() === n; }); }

function renderCoverage(){
  document.getElementById('covhead').innerHTML = '<tr><th class="stick">市</th>' +
    COV_FIELDS.map(function(f){ return '<th class="c">' + f.label + '</th>'; }).join('') +
    '<th class="c">一次資料確認<br><span class="sub">確度A・B</span></th>' +
    '<th class="c">根拠件数</th></tr>';
  document.getElementById('covbody').innerHTML = STATE.muni.map(function(r){
    var ev = evidenceFor(r._name);
    var ab = ev.filter(function(e){ return e.confidence === 'A' || e.confidence === 'B'; }).length;
    return focusTr(r) +
      '<td class="stick">' + esc(r._name) + '</td>' +
      COV_FIELDS.map(function(f){ return '<td class="cell">' + (f.test(r) ? '<span class="dot y">確認済</span>' : '<span class="dot n">未確認</span>') + '</td>'; }).join('') +
      '<td class="cell">' + (ab>0 ? '<span class="dot y">' + ab + '件</span>' : '<span class="dot n">0件</span>') + '</td>' +
      '<td class="cell"><span class="dot p">' + ev.length + '件</span></td></tr>';
  }).join('');
  var tot = STATE.muni.length * COV_FIELDS.length, filled = 0;
  STATE.muni.forEach(function(r){ COV_FIELDS.forEach(function(f){ if(f.test(r)) filled++; }); });
  document.getElementById('covmeta').innerHTML =
    '充足率：<b class="num">' + filled + ' / ' + tot + '</b>（' + Math.round(filled/tot*100) + '%）。' +
    '「未確認」は調査が及んでいないことを示し、<b>取り組んでいないことを意味しません</b>。';
}

function renderConfidence(){
  document.getElementById('legend').innerHTML = ['A','B','C','不明'].map(function(c){
    return '<div class="li"><div class="lh"><span class="conf ' + (c==='不明'?'conf-X':'conf-'+c) + '" title="' +
      esc(CONF_DESC[c]) + '">' + (c==='不明'?'?':c) + '</span><span>確度' + c + '</span></div><p>' + esc(CONF_DESC[c]) + '</p></div>';
  }).join('');
  var dist = {};
  STATE.evidence.forEach(function(e){ var c = txt(e.confidence,'不明'); dist[c] = (dist[c]||0)+1; });
  var total = STATE.evidence.length, ab = (dist['A']||0) + (dist['B']||0);
  document.getElementById('confdist').innerHTML =
    '<b>evidence.csv の根拠 ' + total + '件の内訳</b> — ' +
    Object.keys(dist).sort().map(function(k){ return '確度' + k + '：<b class="num">' + dist[k] + '件</b>'; }).join(' ／ ') +
    '。<br>採点・相関分析に投入できる確度A・Bの根拠は <b>' + ab + '件</b>。' +
    '確度Cの根拠は本文の参考情報にとどめ、スコアには反映していない（methodology §5）。';
}

function renderEvidence(){
  var g = STATE.muni.map(function(r){ return r._name; }), others = [];
  STATE.evidence.forEach(function(e){
    var m = String(e.municipality).trim();
    if(g.indexOf(m) === -1 && others.indexOf(m) === -1) others.push(m);
  });
  document.getElementById('evlist').innerHTML = others.concat(g).map(function(name){
    var list = evidenceFor(name);
    if(!list.length) return '';
    var ab = list.filter(function(e){ return e.confidence==='A'||e.confidence==='B'; }).length;
    var f = focusRow(), focus = !!(f && f._name === name);
    return '<details class="ev' + (focus?' is-focus':'') + '" data-key="ev:' + esc(name) + '"><summary>' + esc(name) +
      (focus?' <span class="chip focus">選択中</span>':'') +
      '<span class="evcount">根拠 ' + list.length + '件（うち確度A・B ' + ab + '件）</span></summary>' +
      '<div class="evtable"><table><thead><tr><th>項目</th><th>値</th><th>出典</th><th>確度</th><th>検証状態</th></tr></thead><tbody>' +
      list.map(function(e){
        var url = String(e.source_url||'').trim();
        var link = /^https?:\/\//.test(url) ? '<br><a class="src" href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">' + esc(url) + '</a>' : '';
        return '<tr><td>' + esc(txt(e.field)) + '</td>' +
          '<td' + (isMissing(e.value)?' class="missing"':'') + '>' + esc(txt(e.value)) + '</td>' +
          '<td>' + esc(txt(e.source_name)) + link +
          (e.note ? '<div class="sub">' + esc(e.note) + '</div>' : '') + '</td>' +
          '<td>' + confChip(e.confidence) + '</td><td>' + esc(txt(e.verification_status)) + '</td></tr>';
      }).join('') + '</tbody></table></div></details>';
  }).join('');
}

function renderFooterMeta(){
  var el = document.getElementById('rubricmeta');
  if(!STATE.rubric.length){ el.textContent = ''; return; }
  var total = 0; STATE.rubric.forEach(function(x){ total += (num(x.max_points)||0); });
  el.innerHTML = 'DX推進度は <code>data/scoring_rubric.csv</code> の ' + STATE.rubric.length +
    '項目・' + fmt(total) + '点満点で採点（2026-09-15に凍結、以後変更なし）。' +
    '採点の1項目ごとの根拠は <code>data/scoring_results.csv</code>（' + STATE.scoring.length + '行）に記録。';
}

/* 目次：PCでは左側に常時表示、モバイルでは「目次」ボタンで開閉する。
   スクロール位置に応じて現在のセクションを示す（aria-current）。 */
function initScrollSpy(){
  var links = Array.prototype.slice.call(document.querySelectorAll('nav.toc a'));
  var secs = links.map(function(a){ return document.querySelector(a.getAttribute('href')); });
  var nav = document.getElementById('sidenav'), btn = document.getElementById('tocToggle');
  var cur = document.getElementById('tocCurrent');
  function onScroll(){
    var y = window.scrollY + 100, act = 0;
    secs.forEach(function(s,i){ if(s && s.offsetTop <= y) act = i; });
    links.forEach(function(a,i){
      a.classList.toggle('active', i === act);
      if(i === act) a.setAttribute('aria-current', 'location'); else a.removeAttribute('aria-current');
    });
    if(cur && links[act]) cur.textContent = links[act].textContent;
  }
  function setOpen(open){
    if(!nav || !btn) return;
    nav.classList.toggle('open', open);
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  }
  if(btn){
    btn.addEventListener('click', function(){ setOpen(!nav.classList.contains('open')); });
    links.forEach(function(a){ a.addEventListener('click', function(){ setOpen(false); }); });
    document.addEventListener('keydown', function(e){
      if(e.key === 'Escape' && nav.classList.contains('open')){ setOpen(false); btn.focus(); }
    });
    document.addEventListener('click', function(e){
      if(nav.classList.contains('open') && !nav.contains(e.target)) setOpen(false);
    });
  }
  window.addEventListener('scroll', onScroll, {passive:true});
  onScroll();
}

/* 印刷時は補足説明（details.more）を展開して、注意事項の欠落を防ぐ */
(function(){
  var opened = [];
  window.addEventListener('beforeprint', function(){
    var closed = Array.prototype.filter.call(document.querySelectorAll('details.more'), function(d){ return !d.open; });
    closed.forEach(function(d){ d.open = true; });
    opened = opened.concat(closed);
  });
  window.addEventListener('afterprint', function(){
    opened.forEach(function(d){ d.open = false; }); opened = [];
  });
})();

document.addEventListener('DOMContentLoaded', boot);
