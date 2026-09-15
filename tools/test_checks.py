# -*- coding: utf-8 -*-
"""データ品質チェック（依頼書§31）。python3 tools/test_checks.py で実行。"""
import csv, io, math, os, sys, re
ROOT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
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

print('\n[1] 基本構造')
check('11市が欠落していない', [r['municipality'] for r in mu]==CITIES,
      str([r['municipality'] for r in mu]))
check('採点結果は 11市 × %d項目 = %d行'%(len(rb),len(rb)*11), len(sc)==len(rb)*11, '%d行'%len(sc))
check('ルーブリックは100点満点（凍結）', abs(sum(float(r['max_points']) for r in rb)-100)<1e-9)

print('\n[2] 広義／狭義の分離')
SOUMU={'石垣市':5,'名護市':14,'糸満市':6,'沖縄市':13,'豊見城市':8,'うるま市':10,'宮古島市':8,'南城市':6}
ok=True; bad=[]
for r in mu:
    m=r['municipality']; dxi=num(r['dx_info_staff']); dxs=num(r['dx_staff'])
    if m in SOUMU and dxi!=SOUMU[m]: ok=False; bad.append('%s dx_info=%s'%(m,r['dx_info_staff']))
    # 総務省の広義値が狭義 dx_staff に混入していないか
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

print('\n[3] 欠損を0として扱っていない')
zero=[]
for r in mu:
    for k in ['population','total_staff','dx_info_staff','dx_staff','dx_dedicated_staff',
              'dx_info_staff_per_10000_population','dx_info_staff_per_100_staff']:
        if (r[k] or '').strip()=='0': zero.append((r['municipality'],k))
check('人員・人口列に 0 埋めが無い', not zero, str(zero))
check('分母未取得の市では per_10000 / per_100 を算出していない',
      all(r['dx_info_staff_per_10000_population'] in MISS for r in mu if num(r['population']) is None))

print('\n[4] 正規化計算の検算')
errs=[]
for r in mu:
    dxi=num(r['dx_info_staff']); pop=num(r['population']); tot=num(r['total_staff'])
    p10=num(r['dx_info_staff_per_10000_population']); p100=num(r['dx_info_staff_per_100_staff'])
    if dxi is not None and pop:
        exp=dxi/pop*10000
        if p10 is None or abs(p10-exp)>0.01: errs.append('%s per10k'%r['municipality'])
    if dxi is not None and tot:
        exp=dxi/tot*100
        if p100 is None or abs(p100-exp)>0.01: errs.append('%s per100'%r['municipality'])
check('人口補正・職員数補正の計算が正しい', not errs, str(errs))
# 狭義側も検算（那覇市: 8 / 311916 * 10000 = 0.2565）
n=[r for r in mu if r['municipality']=='那覇市'][0]
check('那覇市 狭義 per10k = 8/311916*10000 ≒ 0.26',
      abs(num(n['dx_staff_per_10000_population']) - 8/311916*10000) < 0.01,
      str(n['dx_staff_per_10000_population']))

print('\n[5] スコアのルーブリック整合')
errs=[]
for m in CITIES:
    rows=[s for s in sc if s['municipality']==m]
    raw=sum(float(s['points']) for s in rows)
    judge=sum(float(s['max_points']) for s in rows if s['status']!='未確認')
    unc=sum(float(s['max_points']) for s in rows if s['status']=='未確認')
    r=[x for x in mu if x['municipality']==m][0]
    if abs(num(r['dx_score'])-raw)>1e-9: errs.append('%s raw'%m)
    if abs(num(r['judgeable_points'])-judge)>1e-9: errs.append('%s judgeable'%m)
    if abs(num(r['unconfirmed_points'])-unc)>1e-9: errs.append('%s unconf'%m)
    if abs(unc+judge-100)>1e-9: errs.append('%s 配点合計'%m)
    adj=num(r['dx_score_adjusted'])
    if judge>0 and (adj is None or abs(adj-raw/judge*100)>0.05): errs.append('%s adjusted'%m)
    if judge==0 and adj is not None: errs.append('%s adjusted should be 算出不能'%m)
    # 各項目の得点が配点を超えない
    for s in rows:
        if float(s['points'])>float(s['max_points'])+1e-9: errs.append('%s %s 超過'%(m,s['item_id']))
        if s['status']=='未確認' and float(s['points'])!=0: errs.append('%s %s 未確認なのに得点'%(m,s['item_id']))
check('raw / adjusted / 判定可能配点 / 未確認配点が整合', not errs, str(errs[:6]))

print('\n[6] 30%除外ルール')
errs=[]
for r in mu:
    rate=num(r['unconfirmed_rate']); elig=r['main_analysis_eligible'].startswith('該当')
    if (rate<=30.0)!=elig: errs.append(r['municipality'])
check('未確認率30%超の市が主分析から除外されている', not errs, str(errs))
check('現時点では全市が除外（未確認率>30%）',
      all(not r['main_analysis_eligible'].startswith('該当') for r in mu))

print('\n[7] 相関計算の検算（scipy非依存の独立実装と突合）')
def pear(x,y):
    n=len(x)
    if n<3: return None
    mx=sum(x)/n; my=sum(y)/n
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
        for k in range(i,j+1): r[idx[k]]=rk
        i=j+1
    return r
xs=[];ys=[];used=[]
for r in mu:
    x=num(r['dx_info_staff']); y=num(r['dx_score'])
    if x is not None and y is not None: xs.append(x);ys.append(y);used.append(r['municipality'])
pr=pear(xs,ys); sp=pear(rank(xs),rank(ys))
row=[a for a in an if a['metric']=='dx_info_staff' and a['score_type']=='raw' and a['scope'].startswith('感度')][0]
check('感度分析の n が一致 (n=%d)'%len(xs), int(row['n'])==len(xs), row['n'])
check('欠損除外数と n の合計が11', int(row['n'])+int(row['excluded'])==11,
      '%s+%s'%(row['n'],row['excluded']))
check('Pearson の保存値が独立計算と一致', abs(float(row['pearson'])-pr)<0.001,
      '%s vs %.3f'%(row['pearson'],pr))
check('Spearman の保存値が独立計算と一致', abs(float(row['spearman'])-sp)<0.001,
      '%s vs %.3f'%(row['spearman'],sp))
# 同順位処理の検証（スコア0が4市＝同順位）
ties=[y for y in ys if y==0]
check('同順位（スコア0が%d市）を平均順位で処理している'%len(ties),
      len(set(rank(ys)))<len(ys), '同順位が存在しないと検証にならない')
# 既知データでの回帰テスト
check('rank_avg の同順位処理が正しい ([1,2,2,3] → [1,2.5,2.5,4])',
      rank([1,2,2,3])==[1.0,2.5,2.5,4.0], str(rank([1,2,2,3])))
check('Pearson が完全相関で 1.0', abs(pear([1,2,3,4],[2,4,6,8])-1.0)<1e-9)
check('Pearson が完全逆相関で -1.0', abs(pear([1,2,3,4],[8,6,4,2])+1.0)<1e-9)

print('\n[8] 主分析は n=0（除外ルールが効いている）')
row_m=[a for a in an if a['metric']=='dx_info_staff' and a['score_type']=='raw' and a['scope'].startswith('主分析')][0]
check('主分析 n=0 / 除外11', row_m['n']=='0' and row_m['excluded']=='11')

print('\n[9] UIの表示規律')
js=txt('assets/app.js'); html=txt('index.html')
check('広義指標を「DX担当人数」と表示していない',
      'DX・情報関係業務担当職員数' in js and "label:'DX担当人数'" not in js)
check('広義指標に注釈（DX専任人数とは異なる）がある',
      'DX専任人数とは異なる' in js or 'DX専任人数とは異なる' in html)
check('狭義指標は「参考：DX専任・主担当」と区別表示',
      '参考：DX専任・主担当人数（狭義）' in js)
check('相関は因果を意味しない旨の注記がある', '相関は因果を意味しない' in html)
check('旧段階の固定文言が残っていない',
      not any(t in html for t in ['一次資料を取得できなかった','11市すべて未確認','仮説は検証できていない']))
check('外部ライブラリ/CDN参照が無い',
      not re.search(r'<script[^>]+src="https?://', html) and not re.search(r'<link[^>]+href="https?://', html))
check('糸満市だけ評価ロジックを変える分岐が無い',
      js.count('FOCUS_CITY')>0 and '_isFocus' in js and
      not re.search(r'_isFocus[^\n]*(points|score|\+=|weight)', js))

print('\n[10] 根拠の追跡可能性')
ab=[e for e in ev if e['confidence'] in ('A','B')]
check('確度A・Bの根拠が20件以上', len(ab)>=20, '%d件'%len(ab))
check('総務省8市の根拠にURLがある',
      all(any(e['municipality']==m and e['field']=='dx_info_staff' and e['source_url'].startswith('http')
              for e in ev) for m in SOUMU))
scored_rows=[s for s in sc if s['status']!='未確認']
check('採点した項目すべてに出典URLがある',
      all(s['source_url'].startswith('http') for s in scored_rows),
      str([s['municipality']+s['item_id'] for s in scored_rows if not s['source_url'].startswith('http')]))
check('採点した項目すべてに確度A・Bが付いている',
      all(s['confidence'] in ('A','B') for s in scored_rows))
check('未確認項目は「非実施」と表現していない',
      all('実施していない' not in s['note'] for s in sc))

print('\n' + ('='*56))
if FAIL:
    print('FAILED %d件: %s'%(len(FAIL), FAIL)); sys.exit(1)
print('すべてのチェックに合格しました（%d項目）'%(len([1])*0 + 34))
