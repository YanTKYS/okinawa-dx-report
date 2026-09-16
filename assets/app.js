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

var MAIN_MIN_N = 3;          /* 主分析の散布図を描く最小対象数（methodology §9.1） */

var FOCUS_CITY = '糸満市';   /* 本調査の利用主体。強調のみで、評価・統計処理は一切変えない */

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
  {a:'糸満市',  b:'豊見城市', note:'本島南部・同規模。情報政策課兼務型 ⇔ デジタル推進課設置', featured:true},
  {a:'沖縄市',  b:'うるま市', note:'本島中部・同規模。機能分離型 ⇔ 機能一体型'},
  {a:'浦添市',  b:'宜野湾市', note:'本島中南部・同規模。分担型 ⇔ 単独課型'},
  {a:'石垣市',  b:'宮古島市', note:'離島・同規模。専管課あり ⇔ 情報政策課兼務'}
];

var STATE = {muni:[], evidence:[], rubric:[], scoring:[], focusOn:true,
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
    /* 庁内実態ベースの実働体制。広義人員とは定義が異なるため必ず別変数で保持する。 */
    r._fieldTeam = num(r.field_team_staff);

    /* スコア */
    r._score  = num(r.dx_score);
    r._scoreA = num(r.dx_score_adjusted);
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
    r._isFocus = (r._name === FOCUS_CITY);
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
function critical(tbl, n){ if(n < 5) return null; return tbl[n] !== undefined ? tbl[n] : (n > 15 ? tbl[15] : null); }

/* 指標の対を作る。scope='main' は未確認率30%以下の市に限る（methodology §6） */
function pairsFor(xKey, yKey, scope){
  var used = [], excluded = [], refOnly = [];
  STATE.muni.forEach(function(r){
    var hasVals = !(r[xKey] === null || r[xKey] === undefined ||
                    r[yKey] === null || r[yKey] === undefined);
    if(scope === 'main' && !r._eligible){
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
    renderAll();
  }).catch(showLoadError);
}

function showLoadError(err){
  var isFile = location.protocol === 'file:';
  var el = document.getElementById('loaderr');
  el.className = 'banner err';
  el.innerHTML = '<h3>データを読み込めませんでした</h3>' +
    (isFile
      ? '<p>ローカルファイル（<code>file://</code>）として開かれています。ブラウザのセキュリティ制限により CSV を読み込めません。</p>' +
        '<p>リポジトリのルートで <code>python3 -m http.server 8000</code> を実行し <code>http://localhost:8000/</code> を開くか、GitHub Pages 上で閲覧してください。</p>'
      : '<p><code>data/</code> 配下の CSV を取得できませんでした。</p>') +
    '<p style="color:#6b757e;font-size:12px;margin-top:8px">' + esc(err && err.message ? err.message : err) + '</p>';
  el.classList.remove('hidden');
  document.getElementById('content').classList.add('hidden');
}

/* ============================ 描画 ============================ */

function renderAll(){
  renderSummary(); renderConclusion(); renderStaffing(); renderScoring();
  renderAnalysis(); renderFocus(); renderPairs(); renderTypology();
  renderTable(); renderCoverage(); renderConfidence(); renderEvidence(); renderFooterMeta();
  initScrollSpy();
  if(location.hash){ var t = document.querySelector(location.hash); if(t) t.scrollIntoView(); }
}

function countBy(p){ return STATE.muni.filter(p).length; }
function names(p){ return STATE.muni.filter(p).map(function(r){ return r._name; }); }
function joinNames(a){
  return a.map(function(n){ return n === FOCUS_CITY ? '<b>' + esc(n) + '</b>' : esc(n); }).join('、');
}

/* 主分析に使う既定の相関（絶対人数 × raw score） */
function headline(scope){
  var p = pairsFor('_dxinfo', '_score', scope);
  var xs = p.used.map(function(r){ return r._dxinfo; });
  var ys = p.used.map(function(r){ return r._score; });
  return {n:p.used.length, ex:p.excluded.length,
          r:pearson(xs,ys), rho:spearman(xs,ys),
          rc:critical(R_CRIT,p.used.length), rhoc:critical(RHO_CRIT,p.used.length)};
}

/* ---------- 1. サマリー ---------- */

function renderSummary(){
  var total = STATE.muni.length;
  var dxinfoKnown = countBy(function(r){ return r._dxinfo !== null; });
  var scored      = countBy(function(r){ return r._score !== null; });
  var eligible    = countBy(function(r){ return r._eligible; });
  var main = headline('main'), sens = headline('sensitivity');
  var useMain = (main.n >= MAIN_MIN_N);
  var h = useMain ? main : sens;
  var srcLabel = useMain ? '主分析' : '感度分析（参考値）';

  function kpi(label, value, note, cls){
    return '<div class="kpi ' + (cls||'') + '"><div class="k-label">' + label + '</div>' +
      '<div class="k-value num">' + value + '</div>' +
      (note ? '<div class="k-note">' + note + '</div>' : '') + '</div>';
  }
  var of = ' <span class="of">/ ' + total + '市</span>';
  document.getElementById('kpis').innerHTML =
    kpi('調査対象', total + '<span class="of">市</span>', '沖縄県内の全「市」') +
    kpi('広義人員データ 確認済み', dxinfoKnown + of,
        '総務省・同一定義・2024-04-01基準・確度A<br>那覇市・宜野湾市・浦添市は未取得') +
    kpi('DX推進度 採点済み', scored + of, '凍結ルーブリック21項目・100点満点') +
    kpi('主分析 対象', eligible + of,
        eligible === 0 ? '<b>未確認率30%超のため全市が除外</b>'
                       : '未確認率30%以下の市（' + esc(names(function(r){ return r._eligible; }).join('、')) + '）',
        eligible === 0 ? 'alert' : '') +
    kpi('Pearson r（' + srcLabel + '）', h.r === null ? '算出不能' : h.r.toFixed(3),
        h.r === null ? '対が' + MAIN_MIN_N + '件未満のため算出していない'
                     : 'n = ' + h.n + '／' + strengthWord(h.r, h.n, h.rc)) +
    kpi('Spearman ρ（' + srcLabel + '）', h.rho === null ? '算出不能' : h.rho.toFixed(3),
        h.rho === null ? '対が' + MAIN_MIN_N + '件未満のため算出していない'
                       : 'n = ' + h.n + '／' + strengthWord(h.rho, h.n, h.rhoc));

  /* 現時点の結論（ファーストビュー必須表示） */
  var badge = document.getElementById('readiness');
  var lackStaff = STATE.muni.filter(function(r){ return r._eligible && r._dxinfo === null; })
                            .map(function(r){ return r._name; });
  if(useMain){
    badge.className = 'kpi';
    badge.innerHTML = '<div class="k-label">現時点の結論（仮説H1：人的体制が厚いほどDXが進んでいる）</div>' +
      '<div class="k-value" style="font-size:17px;padding-top:5px">主分析 n=' + main.n + ' で評価</div>' +
      '<div class="k-note">Pearson r = ' + (main.r===null?'—':main.r.toFixed(3)) +
      '／Spearman ρ = ' + (main.rho===null?'—':main.rho.toFixed(3)) + '。' +
      'n が小さいため検出力は低く、<b>有意でないことは「関係がない」ことを意味しない</b>。</div>';
  }else{
    badge.className = 'kpi alert';
    badge.innerHTML = '<div class="k-label">現時点の結論（仮説H1：人的体制が厚いほどDXが進んでいる）</div>' +
      '<div class="k-value">主分析では判定できない（n = ' + main.n + '）</div>' +
      '<div class="k-note">正式再採点の結果、未確認率30%以下は <b>' + eligible + '市</b>（' +
      esc(names(function(r){ return r._eligible; }).join('、') || 'なし') + '）。' +
      (lackStaff.length
        ? 'ただし' + (lackStaff.length === eligible ? 'この全市' : esc(lackStaff.join('、'))) +
          'で総務省の広義人員が未取得であり、<b>スコアが確定した市と人員が確定した市が重なっていない</b>ため対が作れない。'
        : '') +
      '感度分析の値は参考であり、DX推進度の実態ではなく<b>調査の到達度</b>を強く反映している。</div>';
  }
}

/* ---------- 2. 結論 ---------- */

function renderConclusion(){
  var main = headline('main'), sens = headline('sensitivity');
  var total = STATE.muni.length;
  var dxinfoKnown = countBy(function(r){ return r._dxinfo !== null; });
  var popKnown = countBy(function(r){ return r._pop !== null; });
  var staffKnown = countBy(function(r){ return r._staff !== null; });
  var eligible = names(function(r){ return r._eligible; });
  var vals = STATE.muni.filter(function(r){ return r._dxinfo !== null; })
                       .sort(function(a,b){ return b._dxinfo - a._dxinfo; });
  var hi = vals[0], lo = vals[vals.length-1];
  var czTotal = 0, uncTotal = 0;
  STATE.scoring.forEach(function(x){
    if(x.status === '未確認') uncTotal++;
    else if(String(x.status).indexOf('確認済み') !== -1) czTotal++;
  });
  var scoreSorted = STATE.muni.slice().sort(function(a,b){ return b._score - a._score; });

  var confirmed = [
    '<b>5本のDeep Researchを正式統合し、11市×21項目＝231レコードを凍結ルーブリックで採点し直した。</b>' +
      'Deep Research本文の得点候補（配点超過を含む）は採用せず、<code>data/scoring_rubric.csv</code> のみを正として' +
      '「証拠 → ルーブリック条件 → 点数」の順で判定している。',
    '<b>素点はトップが' + esc(scoreSorted[0]._name) + ' ' + fmt(scoreSorted[0]._score,1) + '点、' +
      '最下位が' + esc(scoreSorted[scoreSorted.length-1]._name) + ' ' + fmt(scoreSorted[scoreSorted.length-1]._score,1) + '点。</b>' +
      '公的資料に「未導入・機能なし・未実施」が明示された<b>確認済み0点は' + czTotal + '件</b>で、' +
      '単に情報を確認できていない<b>未確認' + uncTotal + '件</b>とは区別して集計している。',
    '<b>未確認率30%以下（主分析対象）は ' + eligible.length + '市</b>' +
      (eligible.length ? '（' + esc(eligible.join('、')) + '）' : '') + '。' +
      '第5回Deep Researchは6市が30%以下になると報告していたが、' +
      '当該ファイルが末尾で途切れており<b>9市分の項目別根拠が届いていない</b>ため、' +
      '根拠を確認できた項目だけで再計算するとこの結果になる。',
    '<b>DX・情報関係業務担当職員数は ' + dxinfoKnown + '/' + total + '市で確定（確度A・2024年4月1日基準）。</b>' +
      '最多は' + esc(hi._name) + ' ' + hi._dxinfo + '人、最少は' + esc(lo._name) + ' ' + lo._dxinfo + '人。' +
      '那覇市・宜野湾市・浦添市は同一資料に収録されているが値が未取得。',
    '<b>人口は ' + popKnown + '/' + total + '市、普通会計職員数は ' + staffKnown + '/' + total + '市しか確定していない。</b>' +
      'このため人口補正（指標B）・職員数補正（指標C）の相関は算出できない。'
  ];

  var implication = [
    '<b>増員の必要性を先に置いた結論は、現時点のデータからは導けない。</b>' +
      '主分析の対が作れないため、人数とDX推進度の関係は正・無・負のいずれとも確定していない。',
    '<b>一方、組織構造の差は事実として確認できる。</b>' +
      'DX専管組織の有無、DX企画と情報システム運用の分離、BPR専管組織の有無、外部専門人材の任用は11市で明確に分かれており、' +
      '同じ人数でも実質的にDX企画へ充てられる人員は異なる。',
    '<b>総務省の広義人員は「県内で自団体がどの位置にあるか」を同一の物差しで示す材料にはなる。</b>' +
      'ただし情報政策担当を含む合計値であり、DX専任人数として引用してはならない。'
  ];

  var cannot = [
    '<b>因果関係は主張できない。</b>係数が得られても「人を増やせばDXが進む」とは言えない。' +
      '本分析は2024年度の人員と2026年9月時点のDX推進状況を比較する約2年のラグ分析であり、逆因果を多少避けられる可能性はあるが証明にはならない。',
    '<b>感度分析の値を主結論に使ってはならない。</b>' +
      '感度分析（n = ' + sens.n + '、Pearson r = ' + (sens.r===null?'—':sens.r.toFixed(3)) +
      '／Spearman ρ = ' + (sens.rho===null?'—':sens.rho.toFixed(3)) + '）の対象は全市が未確認率30%超であり、' +
      'スコアは各市の取り組みの実態ではなく<b>調査の到達度</b>を強く反映している。',
    '<b>「確認できない」を「実施していない」と読み替えてはならない。</b>' +
      '未確認' + uncTotal + '件は根拠を確認できていない項目であり、非実施を意味しない。' +
      '非実施が公的資料で明示された項目は確認済み0点として別に数えている。',
    '<b>有意でないことは「関係がない」ことを意味しない。</b>n が小さいため検出力が低く、中程度の関係があっても検出できない。'
  ];

  function box(cls, head, items){
    return '<div class="fbox ' + cls + '"><div class="fhead">' + head + '</div><ul>' +
      items.map(function(t){ return '<li>' + t + '</li>'; }).join('') + '</ul></div>';
  }
  document.getElementById('conclusion').innerHTML =
    box('fact', '調査から確認できたこと', confirmed) +
    box('note', '人員配置への示唆', implication) +
    box('warn', 'この調査だけでは言えないこと', cannot);
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
  var html = '<table><thead><tr><th class="stick">市</th><th style="width:46%">DX・情報関係業務担当職員数（2024-04-01・総務省）</th>' +
    '<th>人数</th><th>人口1万人あたり</th><th>職員100人あたり</th><th>確度</th></tr></thead><tbody>' +
    rows.map(function(r){
      var bar = r._dxinfo === null ? '<span class="chip miss">総務省値 未取得</span>'
        : '<span class="hbar"><i style="width:' + (r._dxinfo/maxV*100).toFixed(1) + '%"></i></span>';
      return '<tr' + (r._isFocus && STATE.focusOn ? ' class="is-focus"' : '') + '>' +
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
      '<th>DX専任・主担当</th><th>BPR</th><th>情報システム運用</th>' +
      '<th>DX・BPR統合部署</th><th>情報政策担当課室</th></tr></thead><tbody>' +
      sub.map(function(r){
        function c(v){ return '<td class="n' + (v===null?' missing':'') + '">' + (v===null?'不明':fmt(v)+'人') + '</td>'; }
        return '<tr' + (r._isFocus && STATE.focusOn ? ' class="is-focus"' : '') + '>' +
          '<td class="stick">' + esc(r._name) + '</td>' +
          '<td style="white-space:nowrap">' + esc(txt(r.dx_staff_fiscal_year)) + '</td>' +
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
    if(a._score === null && b._score === null) return a._code - b._code;
    if(a._score === null) return 1; if(b._score === null) return -1;
    return b._score - a._score;
  });
  var html = '<table><thead><tr><th class="stick">市</th><th>素点（raw）</th><th>判定可能配点</th>' +
    '<th>補正スコア（adjusted）</th><th>未確認項目</th><th>未確認率</th><th>主分析</th></tr></thead><tbody>' +
    rows.map(function(r){
      var cls = r._eligible ? 'ok' : 'miss';
      return '<tr' + (r._isFocus && STATE.focusOn ? ' class="is-focus"' : '') + '>' +
        '<td class="stick">' + esc(r._name) + '</td>' +
        '<td class="n">' + fmt(r._score,1) + ' <span style="color:var(--muted)">/ 100</span></td>' +
        '<td class="n">' + fmt(r._judge,0) + '</td>' +
        '<td class="n' + (r._scoreA===null?' missing':'') + '">' + (r._scoreA===null?'算出不能':fmt(r._scoreA,1)) + '</td>' +
        '<td class="n">' + esc(txt(r.unconfirmed_items)) + ' / ' + STATE.rubric.length + '項目</td>' +
        '<td class="n">' + fmt(r._unconfRate,1) + '%</td>' +
        '<td><span class="chip ' + cls + '">' + esc(txt(r.main_analysis_eligible)) + '</span></td></tr>';
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
  document.getElementById('axisBreak').innerHTML =
    '<table><thead><tr><th>評価軸</th><th>配点</th><th>11市合計で確認できた得点</th><th>確認密度</th></tr></thead><tbody>' +
    Object.keys(axes).map(function(k){
      var a = axes[k], denom = a.max * nCity, pct = denom ? a.got/denom*100 : 0;
      return '<tr><td>' + esc(k) + '</td><td class="n">' + fmt(a.max,0) + '点</td>' +
        '<td class="n">' + fmt(a.got,1) + ' / ' + fmt(denom,0) + '</td>' +
        '<td><span class="hbar"><i style="width:' + pct.toFixed(1) + '%"></i></span> ' +
        '<span class="num">' + pct.toFixed(1) + '%</span></td></tr>';
    }).join('') + '</tbody></table>';
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
  var yKey = document.getElementById('scoreSel').value || '_score';
  var metric = availableMetrics().filter(function(m){ return m.key === mKey; })[0];
  var scope = STATE.scope;
  var p = pairsFor(mKey, yKey, scope);

  var box = document.getElementById('analysisBox');
  var showRef = scope === 'main' && document.getElementById('refToggle') &&
                document.getElementById('refToggle').checked;
  var refs = (scope === 'main' && showRef) ? p.refOnly : [];
  if(p.used.length >= MAIN_MIN_N){
    box.innerHTML = '<div class="chartbox">' + scatterSVG(p.used, metric, yKey, refs) + '</div>' +
      '<p class="tmeta">' +
      (scope === 'main'
        ? '<b>主分析対象 ' + p.used.length + '市のみで回帰・相関を算出しています。</b>'
        : '<b>これは感度分析（参考値）です。主結論には用いません。</b>') +
      ' プロット ' + p.used.length + '市 ／ 欠損・対象外により除外 ' + p.excluded.length + '市' +
      (p.excluded.length ? '（' + esc(p.excluded.map(function(r){return r._name;}).join('、')) + '）' : '') +
      (refs.length ? ' ／ 薄い灰色の点は<b>参考値自治体（未確認率30%超）' + refs.length +
                     '市で、統計計算には含めていません</b>' : '') +
      '。欠損値は0として扱っていません。</p>';
  }else{
    box.innerHTML = shortageHTML(p, metric, scope);
  }
  renderCorrelation(yKey, scope);
}

function shortageHTML(p, metric, scope){
  var total = STATE.muni.length;
  var reqs = [
    {label:'DX・情報関係業務担当職員数', n:countBy(function(r){ return r._dxinfo !== null; })},
    {label:'人口',                      n:countBy(function(r){ return r._pop   !== null; })},
    {label:'総職員数',                  n:countBy(function(r){ return r._staff !== null; })},
    {label:'DX推進度（未確認率30%以下）', n:countBy(function(r){ return r._eligible; })}
  ];
  var elig = names(function(r){ return r._eligible; });
  var lack = STATE.muni.filter(function(r){ return r._eligible && r[metric.key] === null; })
                       .map(function(r){ return r._name; });
  var why = scope === 'main'
    ? '<b>主分析の対象市が' + MAIN_MIN_N + '市未満です。</b>未確認率30%以下の市は ' +
      elig.length + '市' + (elig.length ? '（' + esc(elig.join('、')) + '）' : '') + 'で、' +
      (lack.length ? 'そのうち ' + lack.length + '市（' + esc(lack.join('、')) +
        '）は「' + esc(metric.label) + '」が未取得のため対が作れません。<b>スコアが確定した市と人員が確定した市が重なっていない</b>ことが直接の原因です。'
        : '凍結ルール（methodology §6）により他市は除外されています。') +
      '上の「分析範囲」を「感度分析」に切り替えると参考値を表示します。'
    : '<b>この指標の対を' + MAIN_MIN_N + '件以上作れません。</b>「' + esc(metric.label) + '」の分母となるデータが不足しています。';
  return '<div class="shortage"><h3>この組み合わせでは散布図を表示できません</h3><p>' + why +
    'これは「相関がない」という結果ではなく、<b>判定に必要な数値が揃っていない</b>という意味です。</p>' +
    '<div class="reqgrid">' + reqs.map(function(q){
      return '<div class="req"><div class="r-label">' + q.label + ' 確認済み</div>' +
        '<div class="r-value num">' + q.n + '<span class="of"> / ' + total + '市</span></div>' +
        '<div class="bar"><i style="width:' + Math.round(q.n/total*100) + '%"></i></div></div>';
    }).join('') + '</div>' +
    '<div class="nextstep"><b>あと何が分かれば仮説を検証できるか（優先順）：</b><br>' +
    '① 総務省資料の Excel 1753／1754／1756行から<b>那覇市・宜野湾市・浦添市の広義人員</b>を取得する。' +
    'この3市は現在スコアの確定度が最も高く、値が入れば主分析が直ちに成立します。<br>' +
    '② J-LIS「コンビニ交付提供市区町村」一覧で<b>VI-2を11市分</b>確定する（現在は自治体名が特定できず9市が未確認）。<br>' +
    '③ 総務省調査の工程表・KPI欄（I-4）と、III-4・VI-4・II-2 の自治体別確認を進める。<br>' +
    '④ 11市同一定義の人口と普通会計職員数を取得すれば、人口補正・職員数補正の分析が自動的に有効になります。</div></div>';
}

function scatterSVG(rows, metric, yKey, refRows){
  refRows = refRows || [];
  var W = 880, H = 430, m = {t:18, r:26, b:54, l:66};
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
  if(yKey === '_score' || yKey === '_scoreA'){ yMin = Math.min(yMin, 0); yMax = Math.max(yMax, 20); }

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
  s += '<text x="'+((m.l+W-m.r)/2)+'" y="'+(H-10)+'" text-anchor="middle">'+esc(metric.label)+'（'+esc(metric.unit)+'）</text>';
  s += '<text transform="translate(15,'+((m.t+H-m.b)/2)+') rotate(-90)" text-anchor="middle">' +
       (yKey === '_scoreA' ? 'DX推進度 補正スコア' : 'DX推進度 素点スコア') + '</text>';

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
    var cx = sx(r[metric.key]), cy = sy(r[yKey]);
    s += '<circle class="pt is-ref" cx="'+cx.toFixed(1)+'" cy="'+cy.toFixed(1)+'" r="4.5">' +
         '<title>'+esc(r._name)+'（参考値・主分析対象外）\n'+esc(metric.label)+': '+fmt(r[metric.key])+
         '\nDX推進度: '+fmt(r[yKey],1)+'\n未確認率: '+fmt(r._unconfRate,1)+'%</title></circle>';
    s += '<text class="lbl is-ref" x="'+(cx+7).toFixed(1)+'" y="'+(cy+3.5).toFixed(1)+'">'+esc(r._name)+'</text>';
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
    var cx = sx(r[metric.key]), cy = sy(r[yKey]), f = r._isFocus && STATE.focusOn;
    s += '<circle class="pt'+(f?' focus':'')+'" cx="'+cx.toFixed(1)+'" cy="'+cy.toFixed(1)+'" r="'+(f?6.5:5)+'">' +
         '<title>'+esc(r._name)+'\n'+esc(metric.label)+': '+fmt(r[metric.key])+
         '\nDX推進度: '+fmt(r[yKey],1)+'\n未確認率: '+fmt(r._unconfRate,1)+'%</title></circle>';
    var ly = labelY(cx, cy);
    if(ly > cy + 6){   /* ずらした場合は引き出し線を引く */
      s += '<line class="lead" x1="'+(cx+5).toFixed(1)+'" y1="'+cy.toFixed(1)+
           '" x2="'+(cx+7).toFixed(1)+'" y2="'+(ly-3.5).toFixed(1)+'"/>';
    }
    s += '<text class="lbl" x="'+(cx+8).toFixed(1)+'" y="'+ly.toFixed(1)+'"'+
         (f?' style="font-weight:700;fill:var(--focus)"':'')+'>'+esc(r._name)+'</text>';
  });
  return s + '</svg>';
}

function renderCorrelation(yKey, scope){
  var html = availableMetrics().map(function(m){
    var p = pairsFor(m.key, yKey, scope);
    var n = p.used.length;
    var tier = m.tier === 'main' ? '<span class="chip">主分析指標</span>' : '<span class="chip warn">補助・狭義</span>';
    if(n < 5){
      return '<div class="corr unavailable"><div class="c-label">' + esc(m.label) + ' × DX推進度 ' + tier + '</div>' +
        '<div class="c-row"><span>Pearson r</span><span class="cv">評価不能</span></div>' +
        '<div class="c-row"><span>Spearman ρ</span><span class="cv">評価不能</span></div>' +
        '<div class="c-n">有効な対 n = ' + n + ' ／ 除外 ' + p.excluded.length + '市<br>' +
        'データ不足のため算出していません。<b>相関がないという意味ではありません。</b></div></div>';
    }
    var xs = p.used.map(function(r){ return r[m.key]; });
    var ys = p.used.map(function(r){ return r[yKey]; });
    var r = pearson(xs,ys), rho = spearman(xs,ys);
    var rc = critical(R_CRIT,n), rhoc = critical(RHO_CRIT,n);
    return '<div class="corr"><div class="c-label">' + esc(m.label) + ' × DX推進度 ' + tier + '</div>' +
      '<div class="c-row"><span>Pearson r</span><span class="cv num">' + (r===null?'—':r.toFixed(3)) + '</span></div>' +
      '<div class="c-row"><span></span><span style="font-size:11.5px;color:var(--muted)">' + strengthWord(r,n,rc) + '</span></div>' +
      '<div class="c-row"><span>Spearman ρ</span><span class="cv num">' + (rho===null?'—':rho.toFixed(3)) + '</span></div>' +
      '<div class="c-row"><span></span><span style="font-size:11.5px;color:var(--muted)">' + strengthWord(rho,n,rhoc) + '</span></div>' +
      '<div class="c-n">使用指標：' + (yKey==='_scoreA'?'補正スコア':'素点スコア') + '／範囲：' +
      (scope==='main'?'主分析':'感度分析（参考値含む）') + '<br>' +
      '分析対象 n = ' + n + '市 ／ 除外 ' + p.excluded.length + '市' +
      (p.excluded.length ? '（' + esc(p.excluded.map(function(x){return x._name;}).join('、')) + '）' : '') +
      '<br>有意水準5%（両側）臨界値：r = ' + (rc===null?'—':rc.toFixed(3)) + ' ／ ρ = ' + (rhoc===null?'—':rhoc.toFixed(3)) +
      '</div></div>';
  }).join('');
  document.getElementById('corrgrid').innerHTML = html;
}

/* ---------- 6. 糸満市の位置 ---------- */

function renderFocus(){
  var f = STATE.muni.filter(function(r){ return r._isFocus; })[0];
  if(!f){ document.getElementById('focusBox').innerHTML = ''; return; }
  var known = STATE.muni.filter(function(r){ return r._dxinfo !== null; })
                        .sort(function(a,b){ return b._dxinfo - a._dxinfo; });
  var rank = known.map(function(r){ return r._name; }).indexOf(f._name) + 1;
  var vals = known.map(function(r){ return r._dxinfo; });
  var med = (function(a){ var s=a.slice().sort(function(x,y){return x-y;}), k=Math.floor(s.length/2);
             return s.length%2 ? s[k] : (s[k-1]+s[k])/2; })(vals);
  var mean = vals.reduce(function(a,b){return a+b;},0)/vals.length;

  function stat(l,v,n){ return '<div class="req"><div class="r-label">'+l+'</div><div class="r-value num">'+v+'</div>' +
    (n?'<div style="font-size:11px;color:var(--muted);margin-top:4px">'+n+'</div>':'') + '</div>'; }

  var org = ORG_GROUPS.filter(function(g){ return g.id === f._orgGroup; })[0];
  document.getElementById('focusBox').innerHTML =
    '<div class="reqgrid">' +
      stat('DX・情報関係業務担当職員数', (f._dxinfo===null?'不明':fmt(f._dxinfo)+'<span class="of">人</span>'),
           f._dxinfo===null?'総務省値':'確定'+known.length+'市中 '+rank+'番目（多い順）') +
      stat('確定11市中の中央値', fmt(med)+'<span class="of">人</span>', '平均 '+fmt(mean,1)+'人（n='+known.length+'）') +
      stat('人口1万人あたり', (f._dxinfoPer10k===null?'不明':fmt(f._dxinfoPer10k,2)), f._dxinfoPer10k===null?'人口が未取得のため算出不能':'') +
      stat('職員100人あたり', (f._dxinfoPer100===null?'不明':fmt(f._dxinfoPer100,2)), f._dxinfoPer100===null?'総職員数が未取得のため算出不能':'') +
      stat('DX専任組織', (org?org.name:'不明'), esc(txt(f.dedicated_dx_org))) +
      stat('DX推進度 素点', fmt(f._score,1)+'<span class="of"> / 100</span>', '未確認率 '+fmt(f._unconfRate,1)+'%') +
    '</div>' +
    (f._fieldTeam === null ? '' :
      '<div class="banner" style="margin-top:14px"><p><b>人員は定義の異なる2つの指標を分けて読む必要がある。</b></p>' +
      '<ul style="margin:6px 0 0 18px">' +
      '<li><b>2024年度 総務省広義人員：' + fmt(f._dxinfo) + '人</b> — ' +
        'DX推進担当課室と情報政策担当課室の合計（同一定義で県内比較できる唯一の指標）</li>' +
      '<li><b>' + esc(txt(f.field_team_fiscal_year)) + ' DX推進実働体制：' + fmt(f._fieldTeam) + '人</b>' +
        '（前年度3人）— ' + esc(txt(f.field_team_note)) + '</li></ul>' +
      '<p style="margin-top:8px">両者は<b>集計範囲も基準日も異なるため、増減として接続してはならない</b>。' +
      '後者は公開一次資料で確認できていないため、県内比較の統計には投入していない。</p></div>') +
    '<p class="hint">' + esc(FOCUS_CITY) + 'は「' + (org?org.name:'不明') + '」かつ「' + FUNC_LABEL[f._funcType] + '」。' +
    'DX専管組織を置かず情報政策課（ＩＴ推進係・システム管理係）が所掌しているため、' +
    '広義人員' + (f._dxinfo===null?'':fmt(f._dxinfo)+'人') + 'のうちDX企画に充てられる人数は本数値からは分からない。' +
    '同型（情報政策部署が兼務）は' + joinNames(names(function(r){ return r._orgGroup===f._orgGroup && !r._isFocus; })) + '。' +
    '<b>これは順位付けを目的とした表示ではなく、人員配置を検討するための相対的位置の確認である。</b></p>';
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
    var feat = p.featured;
    return '<div class="pair' + (feat?' featured':'') + '">' +
      '<div class="phead"><b>' + esc(p.a) + '</b> ⇔ <b>' + esc(p.b) + '</b>' +
      (feat ? ' <span class="chip focus">人員配置検討の主要比較</span>' : '') +
      '<span class="pnote">' + esc(p.note) + '</span></div>' +
      '<table><thead><tr><th>指標</th><th>' + esc(p.a) + '</th><th>' + esc(p.b) + '</th></tr></thead><tbody>' +
      '<tr><td>人口</td>' + cell(a,'_pop',0,'人') + cell(b,'_pop',0,'人') + '</tr>' +
      '<tr><td>DX・情報関係業務担当職員数</td>' + cell(a,'_dxinfo',0,'人') + cell(b,'_dxinfo',0,'人') + '</tr>' +
      '<tr><td>人口1万人あたり</td>' + cell(a,'_dxinfoPer10k',2) + cell(b,'_dxinfoPer10k',2) + '</tr>' +
      '<tr><td>職員100人あたり</td>' + cell(a,'_dxinfoPer100',2) + cell(b,'_dxinfoPer100',2) + '</tr>' +
      '<tr><td>DX推進度 素点</td>' + cell(a,'_score',1) + cell(b,'_score',1) + '</tr>' +
      '<tr><td>未確認率</td>' + cell(a,'_unconfRate',1,'%') + cell(b,'_unconfRate',1,'%') + '</tr>' +
      '<tr><td>組織類型</td><td>' + orgName(a) + '<br><span style="color:var(--muted);font-size:11px">' + FUNC_LABEL[a._funcType] + '</span></td>' +
      '<td>' + orgName(b) + '<br><span style="color:var(--muted);font-size:11px">' + FUNC_LABEL[b._funcType] + '</span></td></tr>' +
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
        return '<div class="card' + (r._isFocus && STATE.focusOn ? ' is-focus' : '') + '">' +
          '<div class="cname">' + esc(r._name) +
            (r._isFocus && STATE.focusOn ? ' <span class="chip focus">本庁</span>' : '') +
            confChip(r.dx_department_confidence) + '</div>' +
          '<div class="cdept">' + esc(txt(r.dx_department)) + '</div>' +
          '<div class="cmeta"><span class="chip">' + esc(txt(r.org_hierarchy)) + '</span>' +
          '<span class="chip ' + (r._funcType==='unknown'?'miss':'') + '">' + FUNC_LABEL[r._funcType] + '</span>' +
          (r._hasBpr ? '<span class="chip ok">業務改善組織あり</span>' : '<span class="chip miss">業務改善組織 未確認</span>') +
          '</div>' +
          '<div class="cstat">広義人員 <b class="num">' + (r._dxinfo===null?'不明':fmt(r._dxinfo)+'人') + '</b>' +
          '　DX推進度 <b class="num">' + fmt(r._score,1) + '</b></div>' +
          '<details><summary>詳細</summary><dl>' +
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
        return '<th' + (r._isFocus && STATE.focusOn ? ' class="is-focus"' : '') + '>' + esc(r._name) + '</th>';
      }).join('') + '</tr></thead><tbody>' +
      OC.map(function(c){
        return '<tr><td class="stick">' + c.label + '</td>' +
          STATE.muni.map(function(r){
            var v = c.get(r);
            return '<td' + (isMissing(v) ? ' class="missing"' : '') +
                   (r._isFocus && STATE.focusOn ? ' style="background:var(--focus-bg,#fff8e6)"' : '') +
                   '>' + esc(v) + '</td>';
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
  {key:'_score', label:'DX推進度', type:'num', digits:1},
  {key:'_unconfRate', label:'未確認率', type:'num', digits:1},
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
    document.getElementById('focusToggle').addEventListener('change', function(e){
      STATE.focusOn = e.target.checked; renderAll();
    });
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
  document.getElementById('thead').innerHTML = '<tr>' + COLUMNS.map(function(c){
    var k = c.sortKey || c.key;
    var ar = (k === sk) ? '<span class="arrow">' + (dir>0?'▲':'▼') + '</span>' : '';
    return '<th class="sortable' + (c.stick?' stick':'') + '" data-key="' + k + '">' + c.label + ar + '</th>';
  }).join('') + '</tr>';
  document.getElementById('tbody').innerHTML = rows.map(function(r){
    return '<tr' + (r._isFocus && STATE.focusOn ? ' class="is-focus"' : '') + '>' + COLUMNS.map(function(c){
      var v = r[c.key];
      if(c.type === 'num') return '<td class="n' + (v===null?' missing':'') + '">' + (v===null?'不明':fmt(v,c.digits)) + '</td>';
      if(c.type === 'conf') return '<td>' + confChip(v) + '</td>';
      if(c.type === 'group'){
        var g = ORG_GROUPS.filter(function(x){ return x.id === v; })[0];
        return '<td><span class="chip ' + (v==='dedicated'?'ok':(v==='unknown'?'miss':'')) + '">' + (g?g.name:'—') + '</span></td>';
      }
      return '<td class="' + (c.stick?'stick':'') + (isMissing(v)?' missing':'') + '">' + esc(txt(v)) + '</td>';
    }).join('') + '</tr>';
  }).join('') || '<tr><td colspan="' + COLUMNS.length + '" style="color:var(--muted);padding:18px">該当する市がありません。</td></tr>';
  document.getElementById('tmeta').innerHTML =
    '表示 ' + rows.length + '市 / 全' + STATE.muni.length + '市。既定は団体コード順。' +
    '<b>「DX・情報関係業務担当職員数」（広義・総務省）と「DX専任・主担当（狭義）」は定義が異なる別の指標</b>であり、合算・比較してはいけません。' +
    '「不明」は欠損であり 0 ではありません。';
  Array.prototype.forEach.call(document.querySelectorAll('#thead th'), function(th){
    th.addEventListener('click', function(){
      var k = th.getAttribute('data-key');
      STATE.sort = (STATE.sort.key === k) ? {key:k, dir:-STATE.sort.dir} : {key:k, dir:1};
      renderTable();
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
  {label:'主分析<br>対象', test:function(r){ return r._eligible; }}
];
function evidenceFor(n){ return STATE.evidence.filter(function(e){ return String(e.municipality).trim() === n; }); }

function renderCoverage(){
  document.getElementById('covhead').innerHTML = '<tr><th class="stick">市</th>' +
    COV_FIELDS.map(function(f){ return '<th style="text-align:center">' + f.label + '</th>'; }).join('') +
    '<th style="text-align:center">一次資料確認<br><span style="font-weight:400;color:var(--muted)">確度A・B</span></th>' +
    '<th style="text-align:center">根拠件数</th></tr>';
  document.getElementById('covbody').innerHTML = STATE.muni.map(function(r){
    var ev = evidenceFor(r._name);
    var ab = ev.filter(function(e){ return e.confidence === 'A' || e.confidence === 'B'; }).length;
    return '<tr' + (r._isFocus && STATE.focusOn ? ' class="is-focus"' : '') + '>' +
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
    var focus = (name === FOCUS_CITY && STATE.focusOn);
    return '<details class="ev"' + (focus?' style="border-color:var(--focus)"':'') + '><summary>' + esc(name) +
      (focus?' <span class="chip focus">本庁</span>':'') +
      '<span class="evcount">根拠 ' + list.length + '件（うち確度A・B ' + ab + '件）</span></summary>' +
      '<table><thead><tr><th>項目</th><th>値</th><th>出典</th><th>確度</th><th>検証状態</th></tr></thead><tbody>' +
      list.map(function(e){
        var url = String(e.source_url||'').trim();
        var link = /^https?:\/\//.test(url) ? '<br><a class="src" href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">' + esc(url) + '</a>' : '';
        return '<tr><td>' + esc(txt(e.field)) + '</td>' +
          '<td' + (isMissing(e.value)?' class="missing"':'') + '>' + esc(txt(e.value)) + '</td>' +
          '<td>' + esc(txt(e.source_name)) + link +
          (e.note ? '<div style="color:var(--muted);font-size:10.5px;margin-top:3px">' + esc(e.note) + '</div>' : '') + '</td>' +
          '<td>' + confChip(e.confidence) + '</td><td>' + esc(txt(e.verification_status)) + '</td></tr>';
      }).join('') + '</tbody></table></details>';
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

function initScrollSpy(){
  var links = Array.prototype.slice.call(document.querySelectorAll('nav.toc a'));
  var secs = links.map(function(a){ return document.querySelector(a.getAttribute('href')); });
  function onScroll(){
    var y = window.scrollY + 90, act = 0;
    secs.forEach(function(s,i){ if(s && s.offsetTop <= y) act = i; });
    links.forEach(function(a,i){ a.classList.toggle('active', i === act); });
  }
  window.addEventListener('scroll', onScroll, {passive:true});
  onScroll();
}

document.addEventListener('DOMContentLoaded', boot);
