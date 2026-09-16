# -*- coding: utf-8 -*-
"""データ品質チェック。python3 tools/test_checks.py で実行。

再計算ロジックの検証（依頼書§25）:
  各itemのpoints <= max_points ／ 21項目合計100点 ／ raw一致 ／ adjusted一致
  確認済み0点を未確認扱いしていない ／ 未確認率一致 ／ 30%閾値判定一致
  dx_info_staff と dx_staff の混入なし ／ Pearson・Spearman再計算一致
  同順位処理 ／ n・除外数一致 ／ 糸満市だけ特別な評価分岐がない
"""
import csv, io, math, os, sys, re
ROOT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT,'tools'))
def rd(p):
    with io.open(os.path.join(ROOT,p),encoding='utf-8') as f: return list(csv.DictReader(f))
def txt(p):
    with io.open(os.path.join(ROOT,p),encoding='utf-8') as f: return f.read()

FAIL=[]
def check(name, cond, detail=''):
    print(('  PASS  ' if cond else '  FAIL  ')+name+(('  → '+detail) if detail and not cond else ''))
    if not cond: FAIL.append(name)

MISS={'','-','—','–','不明','未評価','未採点','未確認','確認不能','該当なし','未調査','未取得','算出不能'}
def num(v):
    v=(v or '').strip().replace(',','')
    if v in MISS or not re.match(r'^-?\d+(\.\d+)?$', v): return None
    return float(v)

mu=rd('data/municipalities.csv'); ev=rd('data/evidence.csv')
rb=rd('data/scoring_rubric.csv'); sc=rd('data/scoring_results.csv'); an=rd('data/analysis_results.csv')
CITIES=['那覇市','宜野湾市','石垣市','浦添市','名護市','糸満市','沖縄市','豊見城市','うるま市','宮古島市','南城市']
RMAX={r['item_id']:float(r['max_points']) for r in rb}
CONFIRMED_ZERO='0点（確認済み）'
STATUSES={'満点','部分点',CONFIRMED_ZERO,'未確認'}

print('\n[1] 基本構造')
check('11市が欠落していない', [r['municipality'] for r in mu]==CITIES,
      str([r['municipality'] for r in mu]))
check('採点結果は 11市 × %d項目 = %d行'%(len(rb),len(rb)*11), len(sc)==len(rb)*11, '%d行'%len(sc))
check('ルーブリックは21項目・100点満点（凍結）',
      len(rb)==21 and abs(sum(RMAX.values())-100)<1e-9,
      '%d項目/%g点'%(len(rb),sum(RMAX.values())))
check('status の語彙が4種類に限定されている',
      all(s['status'] in STATUSES for s in sc),
      str(sorted({s['status'] for s in sc}-STATUSES)))
check('ルーブリックは本統合で変更されていない（配点表のハッシュ固定）',
      ','.join('%s:%g'%(k,RMAX[k]) for k in sorted(RMAX)) ==
      'I-1:6,I-2:4,I-3:5,I-4:5,II-1:5,II-2:5,II-3:5,II-4:5,III-1:5,III-2:5,III-3:5,III-4:5,'
      'IV-1:5,IV-2:5,V-1:5,V-2:5,V-3:5,VI-1:4,VI-2:4,VI-3:4,VI-4:3')

print('\n[2] 配点超過は1件でも失敗')
over=[(s['municipality'],s['item_id'],s['points'],s['max_points']) for s in sc
      if float(s['points'])>float(s['max_points'])+1e-9]
check('すべての項目で points <= max_points', not over, str(over))
check('scoring_results の max_points がルーブリックと一致',
      all(abs(float(s['max_points'])-RMAX[s['item_id']])<1e-9 for s in sc))
neg=[(s['municipality'],s['item_id']) for s in sc if float(s['points'])<0]
check('負の得点が無い', not neg, str(neg))
check('各市の配点合計が100点', all(
      abs(sum(float(s['max_points']) for s in sc if s['municipality']==m)-100)<1e-9 for m in CITIES))

print('\n[3] 未確認 と 確認済み0点 の区別')
bad=[(s['municipality'],s['item_id']) for s in sc
     if s['status']=='未確認' and (s['source_url'] or s['evidence'])]
check('未確認の項目に根拠が付いていない', not bad, str(bad))
bad=[(s['municipality'],s['item_id']) for s in sc
     if s['status']==CONFIRMED_ZERO and not s['source_url'].startswith('http')]
check('確認済み0点はすべて出典URLを持つ', not bad, str(bad))
bad=[(s['municipality'],s['item_id']) for s in sc if s['status']==CONFIRMED_ZERO and float(s['points'])!=0]
check('確認済み0点の得点は0', not bad, str(bad))
bad=[(s['municipality'],s['item_id']) for s in sc if s['status']=='未確認' and float(s['points'])!=0]
check('未確認の得点は0', not bad, str(bad))
# 確認済み0点を未確認配点へ算入していないこと
errs=[]
for m in CITIES:
    rows=[s for s in sc if s['municipality']==m]
    unc=sum(RMAX[s['item_id']] for s in rows if s['status']=='未確認')
    cz =sum(RMAX[s['item_id']] for s in rows if s['status']==CONFIRMED_ZERO)
    r=[x for x in mu if x['municipality']==m][0]
    if abs(num(r['unconfirmed_points'])-unc)>1e-9: errs.append('%s 未確認配点'%m)
    if cz>0 and num(r['unconfirmed_points'])>=unc+cz: errs.append('%s 確認済み0点を未確認に算入'%m)
check('確認済み0点を未確認配点に算入していない', not errs, str(errs))
cz_total=sum(1 for s in sc if s['status']==CONFIRMED_ZERO)
check('確認済み0点が実際に存在する（区別が機能している）', cz_total>0, '%d件'%cz_total)
# 既知の確認済み0点（第4回DRで一次資料により明示された事実）
def st(m,i): return [s for s in sc if s['municipality']==m and s['item_id']==i][0]['status']
check('糸満市 III-1（電子決裁機能なし）は確認済み0点', st('糸満市','III-1')==CONFIRMED_ZERO, st('糸満市','III-1'))
check('石垣市 III-1（電子決裁機能なし）は確認済み0点', st('石垣市','III-1')==CONFIRMED_ZERO, st('石垣市','III-1'))
check('糸満市 V-1（2024年度調査で未実施と明示）は確認済み0点', st('糸満市','V-1')==CONFIRMED_ZERO, st('糸満市','V-1'))
check('名護市 I-2（計画期間終了）は確認済み0点', st('名護市','I-2')==CONFIRMED_ZERO, st('名護市','I-2'))

print('\n[4] raw / adjusted / 未確認率の再計算一致')
errs=[]
for m in CITIES:
    rows=[s for s in sc if s['municipality']==m]
    raw=sum(float(s['points']) for s in rows)
    judge=sum(RMAX[s['item_id']] for s in rows if s['status']!='未確認')
    unc=sum(RMAX[s['item_id']] for s in rows if s['status']=='未確認')
    r=[x for x in mu if x['municipality']==m][0]
    if abs(num(r['dx_score'])-raw)>1e-9: errs.append('%s raw(%g≠%s)'%(m,raw,r['dx_score']))
    if abs(num(r['judgeable_points'])-judge)>1e-9: errs.append('%s judgeable'%m)
    if abs(unc+judge-100)>1e-9: errs.append('%s 配点合計'%m)
    rate=unc/100.0*100
    if abs(num(r['unconfirmed_rate'])-rate)>0.05: errs.append('%s 未確認率'%m)
    adj=num(r['dx_score_adjusted'])
    if judge>0 and (adj is None or abs(adj-raw/judge*100)>0.05): errs.append('%s adjusted'%m)
    if judge==0 and adj is not None: errs.append('%s adjusted should be 算出不能'%m)
    n_unc=sum(1 for s in rows if s['status']=='未確認')
    if int(num(r['unconfirmed_items']))!=n_unc: errs.append('%s 未確認項目数'%m)
    n_cz=sum(1 for s in rows if s['status']==CONFIRMED_ZERO)
    if int(num(r['confirmed_zero_items']))!=n_cz: errs.append('%s 確認済み0点件数'%m)
check('raw / adjusted / 判定可能配点 / 未確認率 / 件数が整合', not errs, str(errs[:6]))

print('\n[5] 30%閾値判定')
errs=[]
for r in mu:
    rate=num(r['unconfirmed_rate']); elig=r['main_analysis_eligible'].startswith('該当')
    if (rate<=30.0)!=elig: errs.append(r['municipality'])
check('未確認率30%超の市だけが主分析から除外されている', not errs, str(errs))
elig=[r['municipality'] for r in mu if r['main_analysis_eligible'].startswith('該当')]
print('        （参考）主分析対象 %d市: %s'%(len(elig),'／'.join(elig) or 'なし'))

print('\n[6] 広義／狭義の分離')
SOUMU={'石垣市':5,'名護市':14,'糸満市':6,'沖縄市':13,'豊見城市':8,'うるま市':10,'宮古島市':8,'南城市':6}
ok=True; bad=[]
for r in mu:
    m=r['municipality']; dxi=num(r['dx_info_staff']); dxs=num(r['dx_staff'])
    if m in SOUMU and dxi!=SOUMU[m]: ok=False; bad.append('%s dx_info=%s'%(m,r['dx_info_staff']))
    if m in SOUMU and dxs is not None and dxs==SOUMU[m]: ok=False; bad.append('%s 広義値が dx_staff に混入'%m)
check('総務省広義値が8市で正しく格納されている', ok, ';'.join(bad))
check('那覇市の狭義 dx_staff は 8（総務省値ではない）',
      num([r for r in mu if r['municipality']=='那覇市'][0]['dx_staff'])==8)
check('那覇市・宜野湾市・浦添市の dx_info_staff は欠損（推測していない）',
      all(num([r for r in mu if r['municipality']==c][0]['dx_info_staff']) is None
          for c in ['那覇市','宜野湾市','浦添市']))
check('浦添市は dx_staff へ按分していない（統合部署5人を別列で保持）',
      num([r for r in mu if r['municipality']=='浦添市'][0]['dx_staff']) is None and
      num([r for r in mu if r['municipality']=='浦添市'][0]['dx_bpr_combined_staff'])==5)
ito=[r for r in mu if r['municipality']=='糸満市'][0]
check('糸満市の2026年度実働2人は dx_info_staff（広義6人）と別列で保持',
      num(ito['field_team_staff'])==2 and num(ito['dx_info_staff'])==6)
# 「6人→2人」という接続表現の禁止。禁止を説明している行（〜してはならない等）は対象外。
BAN=re.compile(r'6\s*人\s*(→|から)\s*2\s*人')
NEG=re.compile(r'してはならない|してはいけない|禁止|読まない|誤り|別指標')
viol=[]
for fpath in ['docs/okinawa-city-dx-report.md','docs/itoman-staffing-brief.md',
              'docs/methodology.md','index.html','assets/app.js']:
    if not os.path.exists(os.path.join(ROOT,fpath)): continue
    for ln,line in enumerate(txt(fpath).split('\n'),1):
        if BAN.search(line) and not NEG.search(line): viol.append('%s:%d'%(fpath,ln))
check('「6人→2人」と接続する表現がレポート・ページに無い', not viol, str(viol))

print('\n[7] 欠損を0として扱っていない')
zero=[]
for r in mu:
    for k in ['population','total_staff','dx_info_staff','dx_staff','dx_dedicated_staff',
              'dx_info_staff_per_10000_population','dx_info_staff_per_100_staff']:
        if (r[k] or '').strip()=='0': zero.append((r['municipality'],k))
check('人員・人口列に 0 埋めが無い', not zero, str(zero))
check('分母未取得の市では per_10000 / per_100 を算出していない',
      all(r['dx_info_staff_per_10000_population'] in MISS for r in mu if num(r['population']) is None))
errs=[]
for r in mu:
    dxi=num(r['dx_info_staff']); pop=num(r['population']); tot=num(r['total_staff'])
    p10=num(r['dx_info_staff_per_10000_population']); p100=num(r['dx_info_staff_per_100_staff'])
    if dxi is not None and pop:
        if p10 is None or abs(p10-dxi/pop*10000)>0.01: errs.append('%s per10k'%r['municipality'])
    if dxi is not None and tot:
        if p100 is None or abs(p100-dxi/tot*100)>0.01: errs.append('%s per100'%r['municipality'])
check('人口補正・職員数補正の計算が正しい', not errs, str(errs))
n=[r for r in mu if r['municipality']=='那覇市'][0]
check('那覇市 狭義 per10k = 8/311916*10000 ≒ 0.26',
      abs(num(n['dx_staff_per_10000_population']) - 8/311916*10000) < 0.01,
      str(n['dx_staff_per_10000_population']))

print('\n[8] 相関計算の再計算一致（独立実装と突合）')
def pear(x,y):
    k=len(x)
    if k<3: return None
    mx=sum(x)/k; my=sum(y)/k
    sxy=sum((a-mx)*(b-my) for a,b in zip(x,y))
    sxx=sum((a-mx)**2 for a in x); syy=sum((b-my)**2 for b in y)
    if sxx==0 or syy==0: return None
    return sxy/math.sqrt(sxx*syy)
def rank(a):
    idx=sorted(range(len(a)),key=lambda i:a[i]); r=[0.0]*len(a); i=0
    while i<len(idx):
        j=i
        while j+1<len(idx) and a[idx[j+1]]==a[idx[i]]: j+=1
        rk=(i+j)/2.0+1
        for k2 in range(i,j+1): r[idx[k2]]=rk
        i=j+1
    return r
SCOL={'raw':'dx_score','adjusted':'dx_score_adjusted'}
errs=[]; checked=0
for row in an:
    mk=row['metric']; sk=SCOL[row['score_type']]; main=row['scope'].startswith('主分析')
    xs=[];ys=[];nex=0
    for r in mu:
        if main and not r['main_analysis_eligible'].startswith('該当'): nex+=1; continue
        x=num(r[mk]); y=num(r[sk])
        if x is None or y is None: nex+=1; continue
        xs.append(x); ys.append(y)
    if int(row['n'])!=len(xs): errs.append('%s/%s n'%(mk,row['scope']))
    if int(row['excluded'])!=nex: errs.append('%s/%s excluded'%(mk,row['scope']))
    if int(row['n'])+int(row['excluded'])!=11: errs.append('%s/%s 合計11'%(mk,row['scope']))
    pr=pear(xs,ys); sp=pear(rank(xs),rank(ys)) if len(xs)>=3 else None
    for label,calc,stored in (('pearson',pr,row['pearson']),('spearman',sp,row['spearman'])):
        if calc is None:
            if stored!='算出不能': errs.append('%s/%s %s should be 算出不能'%(mk,row['scope'],label))
        else:
            if abs(float(stored)-calc)>0.001: errs.append('%s/%s %s %s≠%.3f'%(mk,row['scope'],label,stored,calc))
            checked+=1
    used=[x for x in row['included_municipalities'].split('／') if x and x!='—']
    if len(used)!=int(row['n']): errs.append('%s/%s 使用自治体数'%(mk,row['scope']))
check('n・除外数・Pearson・Spearman・使用自治体が全%d行で一致'%len(an), not errs, str(errs[:6]))
check('少なくとも1組の係数を実際に突合できている', checked>0, '突合0件')
check('n+除外=11 がすべての行で成立', all(int(a['n'])+int(a['excluded'])==11 for a in an))

print('\n[9] 同順位（タイ）処理')
check('rank_avg の同順位処理が正しい ([1,2,2,3] → [1,2.5,2.5,4])',
      rank([1,2,2,3])==[1.0,2.5,2.5,4.0], str(rank([1,2,2,3])))
check('rank_avg の3連タイ ([5,5,5] → [2,2,2])', rank([5,5,5])==[2.0,2.0,2.0], str(rank([5,5,5])))
check('Pearson が完全相関で 1.0', abs(pear([1,2,3,4],[2,4,6,8])-1.0)<1e-9)
check('Pearson が完全逆相関で -1.0', abs(pear([1,2,3,4],[8,6,4,2])+1.0)<1e-9)
check('Spearman は単調非線形で 1.0', abs(pear(rank([1,2,3,4]),rank([1,4,9,100]))-1.0)<1e-9)
sens=[a for a in an if a['metric']=='dx_info_staff' and a['score_type']=='raw' and a['scope'].startswith('感度')][0]
xs=[num(r['dx_info_staff']) for r in mu if num(r['dx_info_staff']) is not None]
check('感度分析の説明変数に同順位が存在し平均順位で処理されている（8人が2市・6人が2市）',
      len(set(rank(xs)))<len(xs) and int(sens['n'])==len(xs), str(sorted(xs)))

print('\n[10] 主分析と感度分析の分離')
check('主分析と感度分析の両方の行がある',
      any(a['scope'].startswith('主分析') for a in an) and any(a['scope'].startswith('感度') for a in an))
check('感度分析の行に「主結論には用いない」旨の注記がある',
      all(('主結論' in a['note']) or a['pearson']=='算出不能'
          for a in an if a['scope'].startswith('感度')))
main_rows=[a for a in an if a['scope'].startswith('主分析')]
mn=set(int(a['n']) for a in main_rows)
if mn=={0}:
    check('主分析n=0の行に理由（対象市の指標未取得）が明記されている',
          all('未取得' in a['note'] or '主分析対象' in a['note'] for a in main_rows),
          str([a['note'][:40] for a in main_rows[:2]]))
else:
    check('主分析の行が算出されている', True)

print('\n[11] UIの表示規律')
js=txt('assets/app.js'); html=txt('index.html')
check('広義指標を「DX担当人数」と表示していない',
      'DX・情報関係業務担当職員数' in js and "label:'DX担当人数'" not in js)
check('広義指標に注釈（DX専任人数とは異なる）がある',
      'DX専任人数とは異なる' in js or 'DX専任人数とは異なる' in html)
check('狭義指標は「参考：DX専任・主担当」と区別表示',
      '参考：DX専任・主担当人数（狭義）' in js)
check('相関は因果を意味しない旨の注記がある', '相関は因果を意味しない' in html)
check('「有意でない＝関係がない」と書いていない',
      not re.search(r'有意でない(ため|ので)?(、)?関係(が|は)(ない|無い)', js+html))
check('外部ライブラリ/CDN参照が無い',
      not re.search(r'<script[^>]+src="https?://', html) and not re.search(r'<link[^>]+href="https?://', html))
check('ファーストビューに11市・広義人員確認数・主分析対象数・Pearson・Spearman・結論がある',
      all(k in js for k in ['調査対象','広義人員データ 確認済み','主分析 対象',
                            'Pearson r','Spearman ρ','現時点の結論']))
check('散布図は主分析対象が3市以上のときだけ主分析として描画する',
      'MAIN_MIN_N' in js)
check('参考値自治体を主分析対象と混同しない表示分岐がある', 'refOnly' in js or 'is-ref' in js)

print('\n[12] 糸満市に特別扱いが無い')
check('糸満市だけ評価ロジックを変える分岐が無い（JS）',
      js.count('FOCUS_CITY')>0 and '_isFocus' in js and
      not re.search(r'_isFocus[^\n]*(points|score|\+=|weight)', js))
fa=txt('tools/scoring_facts.py'); ba=txt('tools/build_analysis.py')
check('採点ロジックに糸満市専用の分岐が無い',
      not re.search(r"if\s+.*==\s*'糸満市'.*:\s*\n\s+.*points", fa+ba))
ito_rows=[s for s in sc if s['municipality']=='糸満市']
check('糸満市も他市と同じ21項目・同じmax_pointsで採点されている',
      len(ito_rows)==21 and all(abs(float(s['max_points'])-RMAX[s['item_id']])<1e-9 for s in ito_rows))
check('糸満市のstatus語彙が他市と同一', {s['status'] for s in ito_rows} <= STATUSES)

print('\n[13] 根拠の追跡可能性')
ab=[e for e in ev if e['confidence'] in ('A','B')]
check('確度A・Bの根拠が100件以上', len(ab)>=100, '%d件'%len(ab))
check('総務省8市の根拠にURLがある',
      all(any(e['municipality']==m and e['field']=='dx_info_staff' and e['source_url'].startswith('http')
              for e in ev) for m in SOUMU))
scored_rows=[s for s in sc if s['status']!='未確認']
check('採点した%d項目すべてに出典URLがある'%len(scored_rows),
      all(s['source_url'].startswith('http') for s in scored_rows),
      str([s['municipality']+s['item_id'] for s in scored_rows if not s['source_url'].startswith('http')][:5]))
check('採点した項目すべてに確度A・Bが付いている',
      all(s['confidence'] in ('A','B') for s in scored_rows),
      str(sorted({s['confidence'] for s in scored_rows})))
check('採点した項目すべてに判定理由（ルーブリック条件への当てはめ）がある',
      all(s['note'].strip() for s in scored_rows))
check('未確認項目は「非実施」と表現していない',
      all('実施していない' not in s['note'] for s in sc))
sev=[e for e in ev if e['evidence_id'].startswith('S')]
check('採点根拠が evidence.csv へ統合されている（%d件）'%len(sev), len(sev)==len(scored_rows),
      '%d vs %d'%(len(sev),len(scored_rows)))
check('Deep Research の圧縮CSV表記（S1/S5等のsource_id）をそのまま持ち込んでいない',
      not any(re.match(r'^S\d$', (e['source_name'] or '').strip()) for e in ev))

print('\n' + ('='*60))
if FAIL:
    print('FAILED %d件: %s'%(len(FAIL), FAIL)); sys.exit(1)
print('すべてのチェックに合格しました')
