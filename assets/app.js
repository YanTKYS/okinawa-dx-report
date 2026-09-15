/* 沖縄県内11市 DX推進体制比較
 * 静的ページ。data/*.csv を読み込んで描画する。ビルド不要・外部依存なし。
 *
 * 設計上の鉄則:
 *  - 「不明」「未評価」「未確認」等は欠損として扱い、決して 0 に置き換えない。
 *  - 欠損を含む市は、その指標の集計・相関から除外し、除外数を必ず表示する。
 *  - 推測値の補完は一切行わない。
 */
'use strict';

/* ============================ 定数 ============================ */

var DATA_FILES = {
  municipalities: 'data/municipalities.csv',
  evidence:       'data/evidence.csv',
  rubric:         'data/scoring_rubric.csv'
};

var FOCUS_CITY = '糸満市';   /* 本調査の利用主体。強調のみで、評価は一切変えない */

/* 欠損とみなす文字列。0 として扱ってはならない値の一覧 */
var MISSING_TOKENS = ['', '-', '—', '–', '不明', '未評価', '未採点', '未確認',
  '確認不能', '該当なし', '未調査', '未取得', 'N/A', 'n/a', 'NA', 'null', 'undefined'];

/* Spearman ρ の臨界値 (α=0.05, 両側) */
var RHO_CRIT = {5:1.000,6:.886,7:.786,8:.738,9:.700,10:.648,11:.618,12:.587,13:.560,
  14:.538,15:.521,16:.503,17:.485,18:.472,19:.460,20:.447,21:.435,22:.425,23:.415,
  24:.406,25:.398,26:.390,27:.382,28:.375,29:.368,30:.362};
/* Pearson r の臨界値 (α=0.05, 両側) */
var R_CRIT = {5:.878,6:.811,7:.754,8:.707,9:.666,10:.632,11:.602,12:.576,13:.553,
  14:.532,15:.514,16:.497,17:.482,18:.468,19:.456,20:.444,21:.433,22:.423,23:.413,
  24:.404,25:.396,26:.388,27:.381,28:.374,29:.367,30:.361};

var METRICS = [
  {key:'_dx',     label:'DX担当人数',                 unit:'人',   csv:'dx_staff'},
  {key:'_per10k', label:'人口1万人あたりDX担当人数',   unit:'人',   csv:'dx_staff_per_10000_population'},
  {key:'_per100', label:'職員100人あたりDX担当人数',   unit:'人',   csv:'dx_staff_per_100_staff'}
];

var CONF_DESC = {
  'A':'一次資料から直接確認',
  'B':'複数情報から高い確度で確認',
  'C':'間接情報のみ（一次資料未確認）',
  '不明':'判断できない'
};

/* methodology.md §9.6 で事前登録した比較ペア（人口規模が近い市の対比） */
var PRESET_PAIRS = [
  {a:'沖縄市',   b:'うるま市',   note:'同規模・機能分離型 ⇔ 機能一体型'},
  {a:'浦添市',   b:'宜野湾市',   note:'同規模・分担型 ⇔ 単独課型'},
  {a:'石垣市',   b:'宮古島市',   note:'同規模・離島／専管課 ⇔ 情報政策課兼務'},
  {a:'糸満市',   b:'豊見城市',   note:'同規模・本島南部／情報政策課兼務 ⇔ デジタル推進課'}
];

var STATE = {muni:[], evidence:[], rubric:[], focusOn:true, sort:{key:'_code', dir:1}};

/* ============================ CSV ============================ */

/* RFC4180 準拠。引用符内のカンマ・改行・エスケープされた引用符を保持する */
function parseCSV(text){
  if(text.charCodeAt(0) === 0xFEFF) text = text.slice(1);   /* BOM 除去 */
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
  if(/^要確認/.test(s)) return true;           /* 「要確認（…）」も未確認として扱う */
  return false;
}

/* 表示用。欠損はそのまま「不明」等の語で見せ、0 にはしない */
function txt(v, fallback){
  return isMissing(v) ? (fallback === undefined ? '不明' : fallback) : String(v).trim();
}

/* 厳格な数値変換。数字だけで構成された値のみ採用し、それ以外は null（欠損） */
function num(v){
  if(isMissing(v)) return null;
  var s = String(v).trim().replace(/[,\s]/g, '');
  if(!/^-?\d+(\.\d+)?$/.test(s)) return null;
  var n = parseFloat(s);
  return isFinite(n) ? n : null;
}

function fmt(n, digits){
  if(n === null || n === undefined) return '—';
  var d = (digits === undefined) ? (Number.isInteger(n) ? 0 : 2) : digits;
  return n.toLocaleString('ja-JP', {minimumFractionDigits:d, maximumFractionDigits:d});
}

function esc(s){
  return String(s === null || s === undefined ? '' : s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

/* 「企画部 情報政策課（同一）」→「企画部 情報政策課」 */
function stripParen(s){
  return String(s || '').replace(/[（(][^）)]*[）)]/g, '').replace(/\s+/g,' ').trim();
}

/* ============================ 派生値 ============================ */

function derive(rows){
  return rows.map(function(r){
    r._name   = String(r.municipality || '').trim();
    r._code   = num(r.municipality_code);
    r._pop    = num(r.population);
    r._staff  = num(r.total_staff);
    r._dx     = num(r.dx_staff);
    r._ded    = num(r.dx_dedicated_staff);
    r._ext    = num(r.external_dx_staff);
    r._score  = num(r.dx_score);
    r._scoreA = num(r.dx_score_adjusted);

    /* CSV に明示値があればそれを使い、無ければ人口・職員数から算出する。
       将来 dx_staff と population が入力された時点で自動的に有効になる。 */
    r._per10k = num(r.dx_staff_per_10000_population);
    if(r._per10k === null && r._dx !== null && r._pop) r._per10k = r._dx / r._pop * 10000;
    r._per100 = num(r.dx_staff_per_100_staff);
    if(r._per100 === null && r._dx !== null && r._staff) r._per100 = r._dx / r._staff * 100;

    /* 軸1: 専任組織の有無 */
    var ded = String(r.dedicated_dx_org || '').trim();
    if(/^有/.test(ded))       r._orgGroup = 'dedicated';
    else if(/^無/.test(ded))  r._orgGroup = 'concurrent';
    else                      r._orgGroup = 'unknown';

    /* 軸2: DX企画機能と情報システム運用機能の分離状況 */
    var info = String(r.info_policy_department || '').trim();
    if(String(r.dx_department || '').indexOf('／') !== -1) r._funcType = 'split-dept';
    else if(/同一/.test(info))                             r._funcType = 'integrated';
    else if(isMissing(info))                               r._funcType = 'unknown';
    else                                                   r._funcType = 'separated';

    /* BPR組織: 判明しているか、DX主管と同一組織か */
    r._hasBpr = !isMissing(r.bpr_department);
    r._bprUnified = r._hasBpr &&
      stripParen(r.dx_department) === stripParen(r.bpr_department);

    r._isFocus = (r._name === FOCUS_CITY);
    return r;
  });
}

var ORG_GROUPS = [
  {id:'dedicated',  name:'DX専任組織あり',            desc:'DX推進を主たる所掌とする課・室を設置'},
  {id:'concurrent', name:'情報政策部署がDXを兼務',    desc:'DX専管組織を置かず情報政策課等が所掌'},
  {id:'unknown',    name:'要確認',                    desc:'情報不足により分類できない'}
];

var FUNC_LABEL = {
  'separated':'機能分離型', 'integrated':'機能一体型',
  'split-dept':'分担型（複数部署）', 'unknown':'要確認'
};

/* ============================ 統計 ============================ */

function pearson(xs, ys){
  var n = xs.length; if(n < 3) return null;
  var mx = 0, my = 0, i;
  for(i=0;i<n;i++){ mx += xs[i]; my += ys[i]; }
  mx /= n; my /= n;
  var sxy=0, sxx=0, syy=0, dx, dy;
  for(i=0;i<n;i++){ dx = xs[i]-mx; dy = ys[i]-my; sxy += dx*dy; sxx += dx*dx; syy += dy*dy; }
  if(sxx === 0 || syy === 0) return null;      /* 分散ゼロ → 相関は定義されない */
  return sxy / Math.sqrt(sxx * syy);
}

/* 同順位は平均順位 */
function rankAvg(arr){
  var idx = arr.map(function(v,i){ return [v,i]; })
               .sort(function(a,b){ return a[0]-b[0]; });
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

function spearman(xs, ys){
  if(xs.length < 3) return null;
  return pearson(rankAvg(xs), rankAvg(ys));
}

function critical(table, n){
  if(n < 5) return null;
  if(table[n] !== undefined) return table[n];
  return n > 30 ? table[30] : null;
}

/* x 指標と y 指標がともに数値である市だけを対にする。欠損市は除外して数える */
function pairsFor(xKey, yKey){
  var used = [], excluded = [];
  STATE.muni.forEach(function(r){
    if(r[xKey] !== null && r[xKey] !== undefined && r[yKey] !== null && r[yKey] !== undefined) used.push(r);
    else excluded.push(r);
  });
  return {used:used, excluded:excluded};
}

/* ============================ 読み込み ============================ */

function loadCSV(path){
  /* GitHub Pages のサブパス配下でも動くよう相対パスで取得し、
     サーバの charset 指定に依存せず UTF-8 として復号する（文字化け防止） */
  return fetch(path, {cache:'no-cache'}).then(function(res){
    if(!res.ok) throw new Error(path + ' : HTTP ' + res.status);
    return res.arrayBuffer();
  }).then(function(buf){
    return new TextDecoder('utf-8').decode(buf);
  }).then(function(t){
    return toObjects(parseCSV(t));
  });
}

function boot(){
  Promise.all([
    loadCSV(DATA_FILES.municipalities),
    loadCSV(DATA_FILES.evidence),
    loadCSV(DATA_FILES.rubric)
  ]).then(function(res){
    STATE.muni     = derive(res[0]);
    STATE.evidence = res[1];
    STATE.rubric   = res[2];
    renderAll();
  }).catch(function(err){
    showLoadError(err);
  });
}

function showLoadError(err){
  var isFile = location.protocol === 'file:';
  var el = document.getElementById('loaderr');
  el.className = 'banner err';
  el.innerHTML =
    '<h3>データを読み込めませんでした</h3>' +
    (isFile
      ? '<p>ローカルファイル（<code>file://</code>）として開かれています。ブラウザのセキュリティ制限により CSV を読み込めません。</p>' +
        '<p>リポジトリのルートで <code>python3 -m http.server 8000</code> を実行し <code>http://localhost:8000/</code> を開くか、GitHub Pages 上で閲覧してください。</p>'
      : '<p><code>data/</code> 配下の CSV を取得できませんでした。ファイルの配置とパスを確認してください。</p>') +
    '<p style="color:#6b757e;font-size:12px;margin-top:8px">' + esc(err && err.message ? err.message : err) + '</p>';
  el.classList.remove('hidden');
  document.getElementById('content').classList.add('hidden');
}

/* ============================ 描画 ============================ */

function renderAll(){
  renderSummary();
  renderFindings();
  renderMap();
  renderAnalysis();
  renderCorrelation();
  renderTable();
  renderCoverage();
  renderConfidence();
  renderEvidence();
  renderFooterMeta();
  initScrollSpy();
  /* 描画後にページ高さが変わるため、#アンカー付きで開かれた場合は再スクロールする */
  if(location.hash){
    var target = document.querySelector(location.hash);
    if(target) target.scrollIntoView();
  }
}

/* ---------- 1. ファーストビュー ---------- */

function countBy(pred){ return STATE.muni.filter(pred).length; }

function analysisReadiness(){
  /* 3指標のうち最も対が多いものを基準に、相関分析が可能かを判定する */
  var best = 0;
  METRICS.forEach(function(m){
    var p = pairsFor(m.key, '_score');
    if(p.used.length > best) best = p.used.length;
  });
  return {n:best, ok:best >= 5};   /* n<5 は臨界値表の下限を下回るため評価不能とする */
}

function renderSummary(){
  var total = STATE.muni.length;
  var dedicated  = countBy(function(r){ return r._orgGroup === 'dedicated'; });
  var concurrent = countBy(function(r){ return r._orgGroup === 'concurrent'; });
  var bpr        = countBy(function(r){ return r._hasBpr; });
  var dxKnown    = countBy(function(r){ return r._dx !== null; });
  var scoreKnown = countBy(function(r){ return r._score !== null; });
  var ready      = analysisReadiness();

  function kpi(label, value, note, cls){
    return '<div class="kpi ' + (cls || '') + '">' +
      '<div class="k-label">' + label + '</div>' +
      '<div class="k-value num">' + value + '</div>' +
      (note ? '<div class="k-note">' + note + '</div>' : '') + '</div>';
  }
  var of = ' <span class="of">/ ' + total + '市</span>';

  document.getElementById('kpis').innerHTML =
    kpi('調査対象', total + '<span class="of">市</span>', '沖縄県内の全「市」（町村を除く）') +
    kpi('DX専任組織あり', dedicated + of, 'DX推進を主所掌とする課・室を設置') +
    kpi('情報政策部署が兼務', concurrent + of, 'DX専管組織を置かない市') +
    kpi('業務改善組織 確認済み', bpr + of, '残り' + (total-bpr) + '市は<b>未確認</b>（不存在ではない）') +
    kpi('DX担当人数 確認済み', dxKnown + of, dxKnown === 0 ? '一次資料未取得のため全市未確認' : '数値が確定した市') +
    kpi('DX推進度 評価済み', scoreKnown + of, scoreKnown === 0 ? '確度A・Bのデータが無く未採点' : '採点済みの市');

  var badge = document.getElementById('readiness');
  if(ready.ok){
    badge.className = 'kpi';
    badge.innerHTML = '<div class="k-label">相関分析</div><div class="k-value" style="font-size:17px;color:var(--ok);padding-top:5px">評価可能</div>' +
      '<div class="k-note">有効な対 n = ' + ready.n + '</div>';
  }else{
    badge.className = 'kpi alert';
    badge.innerHTML = '<div class="k-label">相関分析</div><div class="k-value">データ不足により評価不能</div>' +
      '<div class="k-note">有効な対 n = ' + ready.n + '（判定に必要な最小 n = 5）<br>「相関なし」という意味ではありません</div>';
  }
}

/* ---------- 2. 現時点で分かること ---------- */

function names(pred){
  return STATE.muni.filter(pred).map(function(r){ return r._name; });
}
function joinNames(arr){
  return arr.map(function(n){
    return n === FOCUS_CITY ? '<b>' + esc(n) + '</b>' : esc(n);
  }).join('、');
}

function renderFindings(){
  var total = STATE.muni.length;
  var ded  = names(function(r){ return r._orgGroup === 'dedicated'; });
  var con  = names(function(r){ return r._orgGroup === 'concurrent'; });
  var unk  = names(function(r){ return r._orgGroup === 'unknown'; });
  var integ= names(function(r){ return r._funcType === 'integrated'; });
  var sep  = names(function(r){ return r._funcType === 'separated'; });
  var bprN = names(function(r){ return r._hasBpr; });
  var uni  = names(function(r){ return r._bprUnified; });
  var dxKnown = countBy(function(r){ return r._dx !== null; });
  var popKnown= countBy(function(r){ return r._pop !== null; });
  var scKnown = countBy(function(r){ return r._score !== null; });

  var src = '<span class="tag-src">municipalities.csv から自動算出</span>';

  var facts = [];
  facts.push('<b>DX専任の課・室を置く市は ' + ded.length + '市</b>：' + joinNames(ded) + '。' +
             '情報政策部署が兼務する市は ' + con.length + '市：' + joinNames(con) +
             (unk.length ? '。分類できない市が ' + unk.length + '市：' + joinNames(unk) : '') + '。' + src);
  facts.push('<b>DX企画と情報システム運用が同一組織の「機能一体型」が ' + integ.length + '市</b>：' +
             joinNames(integ) + '。分離している「機能分離型」は ' + sep.length + '市：' + joinNames(sep) + '。' + src);
  facts.push('<b>BPR・業務改善の担当組織を確認できたのは ' + bprN.length + '市のみ</b>：' + joinNames(bprN) + '。' +
             'うち ' + uni.length + '市（' + joinNames(uni) + '）はDX主管組織と同一で、DXと業務改善を一体推進している。' +
             '<br>残り ' + (total - bprN.length) + '市は<b>未確認</b>であり、組織が存在しないことを意味しない。' + src);
  facts.push('<b>人的体制の数値は未取得</b>：DX担当人数 ' + dxKnown + '/' + total + '市、人口 ' + popKnown + '/' + total +
             '市、DX推進度 ' + scKnown + '/' + total + '市。' +
             'このため<b>人的体制とDX推進度の関係は現時点では評価不能</b>である。' + src);

  var notes = [];
  notes.push('<b>「相関なし」ではなく「評価不能」である。</b>必要な数値が揃っていないため、正の相関・無相関・負の相関のいずれとも判定できない。');
  notes.push('<b>機能一体型の市では、部署の職員数をそのままDX担当人数として扱えない。</b>' +
             '標準化・共通化対応やシステム運用が人員を吸収するため、機能区分（①DX・業務改革／②システム運用／③セキュリティ／④その他）への分解が必要。' +
             'この分解を行わない人数比較は仮説の検証として成立しない。');
  notes.push('<b>組織情報は全件が確度C（間接情報）であり、一次資料で未検証である。</b>' +
             '取得元の多くは令和4〜7年度時点の情報で、現行の組織を反映していない可能性がある。' +
             '庁内の意思決定資料に引用する前に原資料の確認が必要。');
  notes.push('<b>組織の「格」「人員規模」「設置年数」は別の変数である。</b>' +
             '本ページが示すのは体制の<b>所在</b>であって<b>規模</b>ではない。');

  document.getElementById('findings').innerHTML =
    '<div class="fbox fact"><div class="fhead">事実（CSVから機械的に算出）</div><ul>' +
      facts.map(function(f){ return '<li>' + f + '</li>'; }).join('') + '</ul></div>' +
    '<div class="fbox note"><div class="fhead">解釈上の注意（事実ではなく読み方）</div><ul>' +
      notes.map(function(f){ return '<li>' + f + '</li>'; }).join('') + '</ul></div>';
}

/* ---------- 3. DX推進体制マップ ---------- */

function confChip(v){
  var c = txt(v, '不明');
  var cls = (c === 'A' || c === 'B' || c === 'C') ? 'conf-' + c : 'conf-X';
  var label = (c === 'A' || c === 'B' || c === 'C') ? c : '?';
  return '<span class="conf ' + cls + '" title="確度' + esc(c) + '：' + esc(CONF_DESC[c] || '判断できない') + '">' + label + '</span>';
}

function card(r){
  var planShort = txt(r.dx_plan).replace(/（確度[A-C]）/g, '').trim();
  return '<div class="card' + (r._isFocus && STATE.focusOn ? ' is-focus' : '') + '">' +
    '<div class="cname">' + esc(r._name) +
      (r._isFocus && STATE.focusOn ? ' <span class="chip focus">本庁</span>' : '') +
      confChip(r.dx_department_confidence) + '</div>' +
    '<div class="cdept">' + esc(txt(r.dx_department)) + '</div>' +
    '<div class="cmeta">' +
      '<span class="chip">' + esc(txt(r.org_hierarchy)) + '</span>' +
      '<span class="chip ' + (r._funcType === 'unknown' ? 'miss' : '') + '">' + FUNC_LABEL[r._funcType] + '</span>' +
      (r._hasBpr ? '<span class="chip ok">業務改善組織あり</span>' : '<span class="chip miss">業務改善組織 未確認</span>') +
    '</div>' +
    '<details><summary>詳細</summary><dl>' +
      '<dt>情報政策担当</dt><dd>' + esc(txt(r.info_policy_department)) + '</dd>' +
      '<dt>業務改善担当</dt><dd>' + esc(txt(r.bpr_department)) + '</dd>' +
      '<dt>専任組織</dt><dd>' + esc(txt(r.dedicated_dx_org)) + '</dd>' +
      '<dt>設置時期</dt><dd>' + esc(txt(r.dx_org_established)) + '</dd>' +
      '<dt>DX計画</dt><dd>' + esc(planShort || '不明') + '</dd>' +
      '<dt>CIO補佐官等</dt><dd>' + esc(txt(r.cio_advisor)) + '</dd>' +
      '<dt>DX担当人数</dt><dd>' + (r._dx === null ? '<span style="color:var(--miss)">不明（未取得）</span>' : fmt(r._dx) + '人') + '</dd>' +
    '</dl></details></div>';
}

function renderMap(){
  var html = ORG_GROUPS.map(function(g){
    var rows = STATE.muni.filter(function(r){ return r._orgGroup === g.id; });
    if(!rows.length) return '';
    return '<div class="grouprow"><div class="grouphead">' +
      '<span class="gname">' + g.name + '</span>' +
      '<span class="gcount num">' + rows.length + '市</span>' +
      '<span class="gdesc">' + g.desc + '</span></div>' +
      '<div class="cards">' + rows.map(card).join('') + '</div></div>';
  }).join('');
  document.getElementById('map').innerHTML = html;

  /* 糸満市と同型（情報政策部署兼務）の市を明示し、比較の手がかりにする */
  var focus = STATE.muni.filter(function(r){ return r._isFocus; })[0];
  var peerNote = document.getElementById('peernote');
  if(focus){
    var sameOrg = STATE.muni.filter(function(r){ return r._orgGroup === focus._orgGroup && !r._isFocus; });
    var sameFunc= STATE.muni.filter(function(r){ return r._funcType === focus._funcType && !r._isFocus; });
    peerNote.innerHTML =
      '<b>' + esc(FOCUS_CITY) + '</b> は「' +
      ORG_GROUPS.filter(function(g){return g.id===focus._orgGroup;})[0].name + '」かつ「' + FUNC_LABEL[focus._funcType] + '」。' +
      '同じ「' + ORG_GROUPS.filter(function(g){return g.id===focus._orgGroup;})[0].name + '」は ' +
      (sameOrg.length ? joinNames(sameOrg.map(function(r){return r._name;})) : 'なし') + '、' +
      '同じ「' + FUNC_LABEL[focus._funcType] + '」は ' +
      (sameFunc.length ? joinNames(sameFunc.map(function(r){return r._name;})) : 'なし') + '。' +
      '<span class="tag-src">分類はCSVから自動判定／評価上の優遇はしていない</span>';
  }
}

/* ---------- 4. 人的体制 × DX推進度 ---------- */

function renderAnalysis(){
  var sel = document.getElementById('metricSel');
  if(!sel.options.length){
    METRICS.forEach(function(m){
      var o = document.createElement('option');
      o.value = m.key; o.textContent = m.label;
      sel.appendChild(o);
    });
    sel.addEventListener('change', function(){ renderAnalysis(); renderCorrelation(); });
    document.getElementById('scoreSel').addEventListener('change', function(){ renderAnalysis(); renderCorrelation(); });
  }
  var mKey = sel.value || METRICS[0].key;
  var yKey = document.getElementById('scoreSel').value || '_score';
  var metric = METRICS.filter(function(m){ return m.key === mKey; })[0];
  var p = pairsFor(mKey, yKey);

  var box = document.getElementById('analysisBox');
  if(p.used.length >= 3){
    box.innerHTML = '<div class="chartbox">' + scatterSVG(p.used, metric, yKey) + '</div>' +
      '<p class="tmeta">プロット対象 ' + p.used.length + '市 ／ 欠損により除外 ' + p.excluded.length + '市' +
      (p.excluded.length ? '（' + esc(p.excluded.map(function(r){return r._name;}).join('、')) + '）' : '') +
      '。欠損値は0として扱っていません。</p>' + rankingHTML(yKey);
  }else{
    box.innerHTML = shortageHTML(p);
  }
}

function shortageHTML(p){
  var total = STATE.muni.length;
  var reqs = [
    {label:'DX担当人数',   n:countBy(function(r){ return r._dx    !== null; })},
    {label:'人口',         n:countBy(function(r){ return r._pop   !== null; })},
    {label:'総職員数',     n:countBy(function(r){ return r._staff !== null; })},
    {label:'DX推進度スコア',n:countBy(function(r){ return r._score !== null; })}
  ];
  return '<div class="shortage">' +
    '<h3>相関分析に必要なデータが不足しています</h3>' +
    '<p>グラフは表示しません。これは「相関がない」という結果ではなく、<b>判定に必要な数値がまだ揃っていない</b>という意味です。' +
    '有効な対は ' + p.used.length + '件で、判定に必要な最小件数（5件）に達していません。</p>' +
    '<div class="reqgrid">' + reqs.map(function(q){
      var pct = Math.round(q.n / total * 100);
      return '<div class="req"><div class="r-label">' + q.label + ' 確認済み</div>' +
        '<div class="r-value num">' + q.n + '<span class="of"> / ' + total + '市</span></div>' +
        '<div class="bar"><i style="width:' + pct + '%"></i></div></div>';
    }).join('') + '</div>' +
    '<div class="nextstep"><b>あと何が分かれば仮説を検証できるか：</b><br>' +
    '上記4項目が最低5市で揃えば、このページは自動的に散布図と相関係数の表示に切り替わります。' +
    'DX担当人数は、機能区分（①DX・業務改革／②システム運用／③セキュリティ／④その他）に分解したうえで ' +
    '<code>data/municipalities.csv</code> の <code>dx_staff</code> 列に入力してください。' +
    '推測値は入力せず、確認できないものは「不明」のままとしてください。</div></div>';
}

function scatterSVG(rows, metric, yKey){
  var W = 880, H = 420, m = {t:18, r:24, b:52, l:66};
  var xs = rows.map(function(r){ return r[metric.key]; });
  var ys = rows.map(function(r){ return r[yKey]; });
  var xMin = Math.min.apply(null, xs), xMax = Math.max.apply(null, xs);
  var yMin = Math.min.apply(null, ys), yMax = Math.max.apply(null, ys);
  var padX = (xMax - xMin) * 0.12 || Math.max(1, Math.abs(xMax) * 0.1);
  var padY = (yMax - yMin) * 0.12 || Math.max(1, Math.abs(yMax) * 0.1);
  xMin -= padX; xMax += padX; yMin -= padY; yMax += padY;
  if(yKey === '_score' || yKey === '_scoreA'){ yMin = Math.min(yMin, 0); yMax = Math.max(yMax, 100); }

  function sx(v){ return m.l + (v - xMin) / (xMax - xMin) * (W - m.l - m.r); }
  function sy(v){ return H - m.b - (v - yMin) / (yMax - yMin) * (H - m.t - m.b); }

  function ticks(lo, hi, count){
    var span = hi - lo, step = Math.pow(10, Math.floor(Math.log(span / count) / Math.LN10));
    var err = span / count / step;
    if(err >= 7.5) step *= 10; else if(err >= 3) step *= 5; else if(err >= 1.5) step *= 2;
    var out = [], v = Math.ceil(lo / step) * step;
    for(; v <= hi + step * 1e-6; v += step) out.push(Math.round(v * 1e6) / 1e6);
    return out;
  }

  var s = '<svg class="scatter" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="人的体制とDX推進度の散布図">';
  s += '<g class="grid">';
  ticks(yMin, yMax, 6).forEach(function(t){
    s += '<line x1="' + m.l + '" x2="' + (W-m.r) + '" y1="' + sy(t).toFixed(1) + '" y2="' + sy(t).toFixed(1) + '"/>';
  });
  s += '</g><g class="axis">';
  s += '<line x1="' + m.l + '" x2="' + (W-m.r) + '" y1="' + (H-m.b) + '" y2="' + (H-m.b) + '"/>';
  s += '<line x1="' + m.l + '" x2="' + m.l + '" y1="' + m.t + '" y2="' + (H-m.b) + '"/></g>';
  ticks(xMin, xMax, 6).forEach(function(t){
    s += '<text x="' + sx(t).toFixed(1) + '" y="' + (H-m.b+17) + '" text-anchor="middle">' + fmt(t) + '</text>';
  });
  ticks(yMin, yMax, 6).forEach(function(t){
    s += '<text x="' + (m.l-9) + '" y="' + (sy(t)+4).toFixed(1) + '" text-anchor="end">' + fmt(t) + '</text>';
  });
  s += '<text x="' + ((m.l + W - m.r)/2) + '" y="' + (H-10) + '" text-anchor="middle">' +
       esc(metric.label) + '（' + esc(metric.unit) + '）</text>';
  s += '<text transform="translate(15,' + ((m.t + H - m.b)/2) + ') rotate(-90)" text-anchor="middle">' +
       (yKey === '_scoreA' ? 'DX推進度 補正スコア' : 'DX推進度スコア') + '</text>';

  rows.forEach(function(r){
    var cx = sx(r[metric.key]), cy = sy(r[yKey]);
    var f = r._isFocus && STATE.focusOn;
    s += '<circle class="pt' + (f ? ' focus' : '') + '" cx="' + cx.toFixed(1) + '" cy="' + cy.toFixed(1) + '" r="' + (f ? 6.5 : 5) + '">' +
         '<title>' + esc(r._name) + '\n' + esc(metric.label) + ': ' + fmt(r[metric.key]) +
         '\nDX推進度: ' + fmt(r[yKey]) + '</title></circle>';
    s += '<text class="lbl" x="' + (cx + 8).toFixed(1) + '" y="' + (cy + 3.5).toFixed(1) + '"' +
         (f ? ' style="font-weight:700;fill:var(--focus)"' : '') + '>' + esc(r._name) + '</text>';
  });
  return s + '</svg>';
}

/* 散布図が出せる状態になったときだけ表示する補助パネル（主役にはしない） */
function rankingHTML(yKey){
  var rows = STATE.muni.filter(function(r){ return r[yKey] !== null; })
    .slice().sort(function(a,b){ return b[yKey] - a[yKey]; });
  if(rows.length < 3) return '';
  return '<details style="margin-top:14px"><summary style="cursor:pointer;font-size:12.5px;color:var(--accent)">' +
    'DX推進度スコアの分布を表示（参考・優劣の判定ではありません）</summary>' +
    '<p class="tmeta" style="margin-top:8px">本調査の目的は自治体の優劣決定ではなく、人的体制とDX推進状況の関係を見ることです。' +
    '順位は相関分析のための順位付けであり、評価・格付けではありません。</p>' +
    '<table style="margin-top:6px"><thead><tr><th>順位</th><th>市</th><th>スコア</th><th>DX担当人数</th></tr></thead><tbody>' +
    rows.map(function(r,i){
      return '<tr' + (r._isFocus && STATE.focusOn ? ' class="is-focus"' : '') + '><td class="n">' + (i+1) + '</td><td>' + esc(r._name) + '</td>' +
        '<td class="n">' + fmt(r[yKey]) + '</td>' +
        '<td class="n' + (r._dx===null?' missing':'') + '">' + (r._dx===null?'不明':fmt(r._dx)) + '</td></tr>';
    }).join('') + '</tbody></table></details>' + pairsHTML();
}

/* 類似規模自治体比較（事前登録ペア）。数値が入れば自動的に中身が埋まる */
function pairsHTML(){
  var byName = {};
  STATE.muni.forEach(function(r){ byName[r._name] = r; });
  var rows = PRESET_PAIRS.map(function(p){
    var a = byName[p.a], b = byName[p.b];
    if(!a || !b) return '';
    function cell(r, k, d){ return '<td class="n' + (r[k]===null?' missing':'') + '">' + (r[k]===null?'不明':fmt(r[k], d)) + '</td>'; }
    return '<tr><td>' + esc(p.a) + ' ⇔ ' + esc(p.b) + '<div style="font-size:11px;color:var(--muted)">' + esc(p.note) + '</div></td>' +
      cell(a,'_pop',0) + cell(b,'_pop',0) + cell(a,'_dx',0) + cell(b,'_dx',0) + cell(a,'_score',1) + cell(b,'_score',1) + '</tr>';
  }).join('');
  return '<details style="margin-top:10px"><summary style="cursor:pointer;font-size:12.5px;color:var(--accent)">' +
    '類似規模自治体の対比（methodology.md §9.6 の事前登録ペア）</summary>' +
    '<table style="margin-top:6px"><thead><tr><th>ペア</th><th>人口A</th><th>人口B</th><th>DX人数A</th><th>DX人数B</th><th>スコアA</th><th>スコアB</th></tr></thead>' +
    '<tbody>' + rows + '</tbody></table></details>';
}

/* ---------- 5. 相関係数 ---------- */

function renderCorrelation(){
  var yKey = document.getElementById('scoreSel').value || '_score';
  var html = METRICS.map(function(m){
    var p = pairsFor(m.key, yKey);
    var n = p.used.length;
    if(n < 5){
      return '<div class="corr unavailable"><div class="c-label">' + esc(m.label) + ' × DX推進度</div>' +
        '<div class="c-row"><span>Pearson r</span><span class="cv">評価不能</span></div>' +
        '<div class="c-row"><span>Spearman ρ</span><span class="cv">評価不能</span></div>' +
        '<div class="c-n">有効な対 n = ' + n + ' ／ 欠損により除外 ' + p.excluded.length + '市<br>' +
        'データ不足のため算出していません。<b>相関がないという意味ではありません。</b></div></div>';
    }
    var xs = p.used.map(function(r){ return r[m.key]; });
    var ys = p.used.map(function(r){ return r[yKey]; });
    var r = pearson(xs, ys), rho = spearman(xs, ys);
    var rc = critical(R_CRIT, n), rhoc = critical(RHO_CRIT, n);
    function verdict(v, c){
      if(v === null || c === null) return '';
      return Math.abs(v) >= c
        ? '<span class="chip warn">|値| ≥ ' + c.toFixed(3) + '</span>'
        : '<span class="chip miss">有意でない（|値| &lt; ' + c.toFixed(3) + '）</span>';
    }
    return '<div class="corr"><div class="c-label">' + esc(m.label) + ' × DX推進度</div>' +
      '<div class="c-row"><span>Pearson r</span><span><span class="cv num">' + (r===null?'—':r.toFixed(3)) + '</span> ' + verdict(r, rc) + '</span></div>' +
      '<div class="c-row"><span>Spearman ρ</span><span><span class="cv num">' + (rho===null?'—':rho.toFixed(3)) + '</span> ' + verdict(rho, rhoc) + '</span></div>' +
      '<div class="c-n">分析対象 n = ' + n + '市 ／ 欠損により除外 ' + p.excluded.length + '市' +
      (p.excluded.length ? '（' + esc(p.excluded.map(function(x){return x._name;}).join('、')) + '）' : '') +
      '<br>有意水準5%（両側）の臨界値：ρ = ' + (rhoc===null?'—':rhoc.toFixed(3)) + ' / r = ' + (rc===null?'—':rc.toFixed(3)) +
      '</div></div>';
  }).join('');
  document.getElementById('corrgrid').innerHTML = html;
}

/* ---------- 6. 市別比較表 ---------- */

var COLUMNS = [
  {key:'_name',   label:'市',                    type:'text',  stick:true, sortKey:'_code', sortType:'num'},
  {key:'dx_department', label:'DX担当部署',       type:'text'},
  {key:'_orgGroup', label:'専任組織',             type:'group'},
  {key:'_funcType', label:'機能区分',             type:'func'},
  {key:'bpr_department', label:'BPR・業務改善部署', type:'text'},
  {key:'_dx',     label:'DX担当人数',             type:'num', digits:0},
  {key:'_per10k', label:'人口1万人あたり',        type:'num', digits:2},
  {key:'_per100', label:'職員100人あたり',        type:'num', digits:2},
  {key:'_score',  label:'DX推進度',               type:'num', digits:1},
  {key:'dx_department_confidence', label:'情報確度', type:'conf'}
];

function renderTable(){
  var search = document.getElementById('tsearch');
  var filter = document.getElementById('tfilter');
  if(!filter.options.length){
    [['all','すべての市']].concat(ORG_GROUPS.map(function(g){ return [g.id, g.name]; }))
      .concat(Object.keys(FUNC_LABEL).map(function(k){ return ['f:'+k, FUNC_LABEL[k]]; }))
      .forEach(function(o){
        var el = document.createElement('option'); el.value = o[0]; el.textContent = o[1]; filter.appendChild(el);
      });
    filter.addEventListener('change', renderTable);
    search.addEventListener('input', renderTable);
    document.getElementById('focusToggle').addEventListener('change', function(e){
      STATE.focusOn = e.target.checked; renderAll();
    });
  }

  var q = search.value.trim();
  var f = filter.value;
  var rows = STATE.muni.filter(function(r){
    if(q && r._name.indexOf(q) === -1 && String(r.dx_department).indexOf(q) === -1) return false;
    if(f === 'all' || !f) return true;
    if(f.indexOf('f:') === 0) return r._funcType === f.slice(2);
    return r._orgGroup === f;
  });

  var sk = STATE.sort.key, dir = STATE.sort.dir;
  var col = COLUMNS.filter(function(c){ return (c.sortKey || c.key) === sk; })[0] || COLUMNS[0];
  var stype = col.sortType || col.type;
  rows = rows.slice().sort(function(a, b){
    var av = a[sk], bv = b[sk];
    if(stype === 'num'){
      /* 欠損は方向によらず常に末尾。0 として並べ替えてはならない */
      if(av === null && bv === null) return a._name.localeCompare(b._name, 'ja');
      if(av === null) return 1;
      if(bv === null) return -1;
      return (av - bv) * dir;
    }
    return String(av === undefined ? '' : av).localeCompare(String(bv === undefined ? '' : bv), 'ja') * dir;
  });

  var thead = '<tr>' + COLUMNS.map(function(c){
    var k = c.sortKey || c.key;
    var arrow = (k === sk) ? '<span class="arrow">' + (dir > 0 ? '▲' : '▼') + '</span>' : '';
    return '<th class="sortable' + (c.stick ? ' stick' : '') + '" data-key="' + k + '"' +
      (c.sortKey === '_code' ? ' title="団体コード順で並べ替えます"' : '') + '>' + c.label + arrow + '</th>';
  }).join('') + '</tr>';

  var tbody = rows.map(function(r){
    return '<tr' + (r._isFocus && STATE.focusOn ? ' class="is-focus"' : '') + '>' + COLUMNS.map(function(c){
      var v = r[c.key];
      if(c.type === 'num'){
        return '<td class="n' + (v === null ? ' missing' : '') + '">' + (v === null ? '不明' : fmt(v, c.digits)) + '</td>';
      }
      if(c.type === 'conf')  return '<td class="' + (c.stick?'stick':'') + '">' + confChip(v) + '</td>';
      if(c.type === 'group'){
        var g = ORG_GROUPS.filter(function(x){ return x.id === v; })[0];
        var cls = v === 'dedicated' ? 'ok' : (v === 'unknown' ? 'miss' : '');
        return '<td><span class="chip ' + cls + '">' + (g ? g.name : '—') + '</span></td>';
      }
      if(c.type === 'func')  return '<td><span class="chip ' + (v === 'unknown' ? 'miss' : '') + '">' + FUNC_LABEL[v] + '</span></td>';
      var t = txt(v);
      return '<td class="' + (c.stick ? 'stick' : '') + (isMissing(v) ? ' missing' : '') + '">' + esc(t) + '</td>';
    }).join('') + '</tr>';
  }).join('');

  document.getElementById('thead').innerHTML = thead;
  document.getElementById('tbody').innerHTML = tbody ||
    '<tr><td colspan="' + COLUMNS.length + '" style="color:var(--muted);padding:18px">該当する市がありません。</td></tr>';
  document.getElementById('tmeta').innerHTML =
    '表示 ' + rows.length + '市 / 全' + STATE.muni.length + '市。' +
    '既定の並びは団体コード順。「不明」は欠損であり 0 ではありません。数値列の並べ替えでは欠損を常に末尾に配置しています。';

  Array.prototype.forEach.call(document.querySelectorAll('#thead th'), function(th){
    th.addEventListener('click', function(){
      var k = th.getAttribute('data-key');
      STATE.sort = (STATE.sort.key === k) ? {key:k, dir:-STATE.sort.dir} : {key:k, dir:1};
      renderTable();
    });
  });
}

/* ---------- 7. データ充足度 ---------- */

var COV_FIELDS = [
  {label:'人口',        test:function(r){ return r._pop   !== null; }},
  {label:'総職員数',    test:function(r){ return r._staff !== null; }},
  {label:'DX担当人数',  test:function(r){ return r._dx    !== null; }},
  {label:'専任職員数',  test:function(r){ return r._ded   !== null; }},
  {label:'外部人材数',  test:function(r){ return r._ext   !== null; }},
  {label:'DX推進度',    test:function(r){ return r._score !== null; }}
];

function evidenceFor(name){
  return STATE.evidence.filter(function(e){ return String(e.municipality).trim() === name; });
}

function renderCoverage(){
  var head = '<tr><th class="stick">市</th>' +
    COV_FIELDS.map(function(f){ return '<th style="text-align:center">' + f.label + '</th>'; }).join('') +
    '<th style="text-align:center">一次資料確認<br><span style="font-weight:400;color:var(--muted)">確度A・B</span></th>' +
    '<th style="text-align:center">根拠件数</th></tr>';

  var body = STATE.muni.map(function(r){
    var ev = evidenceFor(r._name);
    var ab = ev.filter(function(e){ return e.confidence === 'A' || e.confidence === 'B'; }).length;
    var cells = COV_FIELDS.map(function(f){
      return '<td class="cell">' + (f.test(r)
        ? '<span class="dot y">確認済</span>'
        : '<span class="dot n">未確認</span>') + '</td>';
    }).join('');
    return '<tr' + (r._isFocus && STATE.focusOn ? ' class="is-focus"' : '') + '>' +
      '<td class="stick">' + esc(r._name) + '</td>' + cells +
      '<td class="cell">' + (ab > 0 ? '<span class="dot y">' + ab + '件</span>' : '<span class="dot n">0件</span>') + '</td>' +
      '<td class="cell"><span class="dot p">' + ev.length + '件</span></td></tr>';
  }).join('');

  document.getElementById('covhead').innerHTML = head;
  document.getElementById('covbody').innerHTML = body;

  var totalCells = STATE.muni.length * COV_FIELDS.length;
  var filled = 0;
  STATE.muni.forEach(function(r){ COV_FIELDS.forEach(function(f){ if(f.test(r)) filled++; }); });
  document.getElementById('covmeta').innerHTML =
    '数値項目の充足率：<b class="num">' + filled + ' / ' + totalCells + '</b>（' +
    (totalCells ? Math.round(filled/totalCells*100) : 0) + '%）。' +
    '「未確認」は調査が及んでいないことを示し、<b>取り組んでいないことを意味しません</b>。';
}

/* ---------- 8. 情報確度 ---------- */

function renderConfidence(){
  document.getElementById('legend').innerHTML = ['A','B','C','不明'].map(function(c){
    var cls = (c === '不明') ? 'conf-X' : 'conf-' + c;
    return '<div class="li"><div class="lh"><span class="conf ' + cls + '" title="' + esc(CONF_DESC[c]) + '">' +
      (c === '不明' ? '?' : c) + '</span><span>確度' + c + '</span></div><p>' + esc(CONF_DESC[c]) + '</p></div>';
  }).join('');

  var dist = {};
  STATE.evidence.forEach(function(e){
    var c = txt(e.confidence, '不明'); dist[c] = (dist[c] || 0) + 1;
  });
  var total = STATE.evidence.length;
  var parts = Object.keys(dist).sort().map(function(k){
    return '確度' + k + '：<b class="num">' + dist[k] + '件</b>（' + Math.round(dist[k]/total*100) + '%）';
  });
  var ab = (dist['A'] || 0) + (dist['B'] || 0);
  document.getElementById('confdist').innerHTML =
    '<b>evidence.csv の根拠 ' + total + '件の内訳</b> — ' + parts.join(' ／ ') + '。' +
    (ab === 0
      ? '<br><b>分析に用いる確度A・Bのデータは0件です。</b>methodology.md の規定により、確度Cのみでは採点・相関分析を行いません。'
      : '<br>分析に投入可能な確度A・Bのデータは ' + ab + '件です。');
}

/* ---------- 9. 根拠資料 ---------- */

function evidenceTable(list){
  return '<table><thead><tr><th>項目</th><th>値</th><th>出典</th><th>公開主体</th><th>確度</th><th>検証状態</th></tr></thead><tbody>' +
    list.map(function(e){
      var url = String(e.source_url || '').trim();
      var link = /^https?:\/\//.test(url)
        ? '<br><a class="src" href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">' + esc(url) + '</a>' : '';
      return '<tr><td>' + esc(txt(e.field)) + '</td>' +
        '<td' + (isMissing(e.value) ? ' class="missing"' : '') + '>' + esc(txt(e.value)) + '</td>' +
        '<td>' + esc(txt(e.source_name)) + link + '</td>' +
        '<td>' + esc(txt(e.publisher)) + '</td>' +
        '<td>' + confChip(e.confidence) + '</td>' +
        '<td>' + esc(txt(e.verification_status)) + '</td></tr>';
    }).join('') + '</tbody></table>';
}

function renderEvidence(){
  var groups = STATE.muni.map(function(r){ return r._name; });
  var others = [];
  STATE.evidence.forEach(function(e){
    var m = String(e.municipality).trim();
    if(groups.indexOf(m) === -1 && others.indexOf(m) === -1) others.push(m);
  });
  var html = others.concat(groups).map(function(name){
    var list = evidenceFor(name);
    if(!list.length) return '';
    var focus = (name === FOCUS_CITY && STATE.focusOn);
    return '<details class="ev"' + (focus ? ' style="border-color:var(--focus)"' : '') + '>' +
      '<summary>' + esc(name) + (focus ? ' <span class="chip focus">本庁</span>' : '') +
      '<span class="evcount">根拠 ' + list.length + '件</span></summary>' +
      evidenceTable(list) + '</details>';
  }).join('');
  document.getElementById('evlist').innerHTML = html;
}

/* ---------- メタ ---------- */

function renderFooterMeta(){
  var el = document.getElementById('rubricmeta');
  if(!STATE.rubric.length){ el.textContent = ''; return; }
  var total = 0, axes = {};
  STATE.rubric.forEach(function(x){
    var p = num(x.max_points) || 0;
    total += p;
    axes[x.axis_name] = (axes[x.axis_name] || 0) + p;
  });
  el.innerHTML = 'DX推進度は <code>data/scoring_rubric.csv</code> に定義された ' +
    STATE.rubric.length + '項目・' + fmt(total) + '点満点で採点します（採点着手前に凍結済み）：' +
    Object.keys(axes).map(function(k){ return esc(k) + ' ' + fmt(axes[k]) + '点'; }).join(' ／ ') + '。';
}

function initScrollSpy(){
  var links = Array.prototype.slice.call(document.querySelectorAll('nav.toc a'));
  var secs = links.map(function(a){ return document.querySelector(a.getAttribute('href')); });
  function onScroll(){
    var y = window.scrollY + 90, active = 0;
    secs.forEach(function(s, i){ if(s && s.offsetTop <= y) active = i; });
    links.forEach(function(a, i){ a.classList.toggle('active', i === active); });
  }
  window.addEventListener('scroll', onScroll, {passive:true});
  onScroll();
}

document.addEventListener('DOMContentLoaded', boot);
