# -*- coding: utf-8 -*-
"""
沖縄県内11市 DX調査 — 統合・採点・分析ビルドスクリプト

入力: data/scoring_rubric.csv（凍結済み。変更しない）
      tools/scoring_facts.py（第1〜5回 Deep Research の証拠を正式化した採点ファクト表）
出力: data/scoring_results.csv, data/analysis_results.csv,
      data/municipalities.csv（人員・スコア・組織類型列を更新）

原則:
  - 採点の唯一の正は data/scoring_rubric.csv。Deep Research 本文の得点候補は採用しない
  - 「未確認」と「確認済み0点」を厳密に区別する（docs/methodology.md §6）
  - 総務省の広義指標 dx_info_staff を狭義 dx_staff に混入させない
  - 推測値は一切入力しない（欠損は欠損のまま）
"""
import csv, io, math, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools'))
from scoring_facts import FACTS, MUNIS            # noqa: E402

def p(*a): return os.path.join(ROOT, *a)

SURVEY = '総務省「令和6年度 自治体DX・情報化推進概要」個別資料'
SURVEY_URL = 'https://www.soumu.go.jp/main_content/001048599.zip'

# ----------------------------------------------------------------------------
# 1. 総務省 共通指標（広義）: DX推進担当課室・情報政策担当課室の職員数
#    基準日 2024-04-01 / 確度A / 第3回Deep Researchで一次資料から直接確認
#    那覇市(行1753)・宜野湾市(行1754)・浦添市(行1756)は同一資料に収録されているが
#    どのDeep Researchでも値が抽出されておらず、本作業環境からは総務省ドメインへ
#    到達できない（egress policy）。推測しない（欠損のまま）。
# ----------------------------------------------------------------------------
DX_INFO_STAFF = {
    '石垣市':   (5,  'A', 'Excel 1755行'),
    '名護市':   (14, 'A', 'Excel 1757行'),
    '糸満市':   (6,  'A', 'Excel 1758行'),
    '沖縄市':   (13, 'A', 'Excel 1759行'),
    '豊見城市': (8,  'A', 'Excel 1760行'),
    'うるま市': (10, 'A', 'Excel 1761行'),
    '宮古島市': (8,  'A', 'Excel 1762行'),
    '南城市':   (6,  'A', 'Excel 1763行'),
}

# ----------------------------------------------------------------------------
# 2. 狭義の人員（自治体公表組織図ベース）— 第2回Deep Research
#    methodology §7.2 の機能区分に合致するものだけを入力する。
#    浦添市の行政改革推進課5人はDX・BPR統合部署であり、按分してはならない。
# ----------------------------------------------------------------------------
NARROW = {
  '那覇市': dict(dx_staff=8, dx_staff_conf='A', fy='2026年度（2026-04-01）',
                 info_policy_dept_staff=23, info_policy_conf='A',
                 src='https://www.city.naha.okinawa.jp/_res/projects/default_project/_page_/001/003/945/soshikizu.pdf',
                 src_title='令和8年度那覇市組織図'),
  '宜野湾市': dict(dx_staff=4, dx_staff_conf='A', fy='2025年度（2025-04-01）',
                 infra_staff=6, bpr_staff=4,
                 src='https://www.city.ginowan.lg.jp/material/files/group/7/r7ginowansisosikizu.pdf',
                 src_title='令和7年度宜野湾市行政組織図'),
  '浦添市': dict(dx_bpr_combined_staff=5, combined_conf='A', fy='2026年度（2026-04-01）',
                 info_policy_dept_staff=10, info_policy_conf='A',
                 src='https://www.city.urasoe.lg.jp/doc/609e70973d59ae2434bfd8c2/file_contents/file_20266291134315_1.pdf',
                 src_title='令和8年度浦添市行政機構図（人数あり）'),
}

# 人口（確度A・B のみ）。11市同一定義での取得は未達（外部ドメインへ到達不可）。
POPULATION = {'那覇市': (311916, '2026-08-31', 'A')}
TOTAL_STAFF = {}   # 普通会計職員数（総務省定員管理調査ベース）: 未取得

# 外部専門人材の任用状況。採点（V-2）と同一の根拠水準に揃える。
# 名指しで「任用あり」と報告された5市のみを記載し、残り6市は「不明」。
# 旧R3廃止前は「その他は2024年度時点でなし」という補集合からの推定で6市を「無」と
# していたが、採点側でV-2を未確認へ差し戻した以上、組織比較表に同じ推定を残すのは
# 一貫しない（採点では推測禁止・記述では推測可、という二重基準になる）。
EXTERNAL_EXPERT = {'那覇市':'有','宜野湾市':'有','石垣市':'有（3人）','浦添市':'有','宮古島市':'有'}

# DXとBPRを同一組織で所掌しているか（組織図・課紹介による定性分類。スコア化しない）
DX_BPR_INTEGRATED = {'浦添市':'該当（行政改革推進課＝行革＋デジタルを統合）',
                     '那覇市':'該当（DX推進室が業務改革を所掌）',
                     '名護市':'非該当（業務改善推進室とDX/情報システムが別組織）',
                     '宜野湾市':'非該当（デジタル推進課と行政経営室が別組織）',
                     'うるま市':'非該当（DX推進課と事務事業イノベーション推進室が別組織）'}

# ----------------------------------------------------------------------------
# 3. 実装成果スコア（主分析の被説明変数）
#    100点ルーブリックには「全庁的推進本部」「BPR専管組織」「外部専門人材」
#    「デジタル人材の採用・配置」など、説明変数（人的・組織体制）と構成概念が
#    重複する項目が含まれる。これを人員数と相関させると、採点設計に由来する
#    相関が構造的に生じうる。
#    そこで、施策の実装成果だけで構成した部分尺度を主分析の被説明変数として
#    別途保持する。ルーブリック自体は変更せず、同一の判定結果から集計するだけ。
#      II  行政手続DX      （20点）
#      III 内部業務DX      （20点）
#      IV-2 BPR実施実績の公表（5点）  ※IV-1「専管組織の有無」は体制側なので除外
#      VI  住民サービス・データ活用（15点）
#    合計60点。正規化・未確認率・30%除外ルールは総合スコアと同一手順で適用する。
# ----------------------------------------------------------------------------
OUTCOME_AXES  = {'行政手続DX', '内部業務DX', '住民サービス・データ活用'}
OUTCOME_ITEMS = {'IV-2'}
def is_outcome(item):
    return item['axis_name'] in OUTCOME_AXES or item['item_id'] in OUTCOME_ITEMS

def rd(path):
    with io.open(p(path), encoding='utf-8') as f: return list(csv.DictReader(f))
def wr(path, header, rows):
    with io.open(p(path),'w',encoding='utf-8',newline='') as f:
        w=csv.DictWriter(f,fieldnames=header); w.writeheader(); w.writerows(rows)

# ============================ 採点 ============================
rubric = rd('data/scoring_rubric.csv')
TOTAL_POINTS = sum(float(r['max_points']) for r in rubric)

# 配点超過は設計上のバグ。ビルド時点で止める。
for (m, iid), f in FACTS.items():
    mx = [float(r['max_points']) for r in rubric if r['item_id']==iid]
    if not mx:
        raise SystemExit('ルーブリックに存在しない項目: %s %s' % (m, iid))
    if f['points'] > mx[0] + 1e-9:
        raise SystemExit('配点超過: %s %s = %s > max %s' % (m, iid, f['points'], mx[0]))
    if m not in MUNIS:
        raise SystemExit('対象外の自治体: %s' % m)

UNCONF_NOTE = '確度A・Bの一次資料根拠を確認できず。非実施を意味しない'

OUTCOME_MAX = sum(float(r['max_points']) for r in rubric if is_outcome(r))

sr_rows=[]; summary={}
for m in MUNIS:
    raw=0.0; judgeable=0.0; unconf_pts=0.0; unconf_n=0; confirmed_zero=0
    o_raw=0.0; o_judge=0.0; o_unconf=0.0
    for it in rubric:
        iid=it['item_id']; mx=float(it['max_points'])
        f = FACTS.get((m, iid))
        if f is not None:
            pts = float(f['points'])
            raw += pts; judgeable += mx
            if pts >= mx - 1e-9:  status = '満点'
            elif pts > 0:         status = '部分点'
            else:                 status = '0点（確認済み）'; confirmed_zero += 1
            conf, title, url, ev, note = (f['confidence'], f['source_title'],
                                          f['source_url'], f['evidence'], f['note'])
        else:
            pts, conf, title, url, ev, note = 0, '不明', '', '', '', UNCONF_NOTE
            status='未確認'; unconf_pts+=mx; unconf_n+=1
        if is_outcome(it):
            o_raw += pts
            if status=='未確認': o_unconf += mx
            else:                o_judge  += mx
        sr_rows.append(dict(municipality=m,item_id=iid,axis_name=it['axis_name'],
            item_name=it['item_name'],max_points=('%g'%mx),points=('%g'%pts),status=status,
            confidence=conf,source_title=title,source_url=url,evidence=ev,note=note,
            scale='実装成果' if is_outcome(it) else '体制'))
    rate = unconf_pts/TOTAL_POINTS*100
    o_rate = o_unconf/OUTCOME_MAX*100
    summary[m]=dict(raw=raw, judgeable=judgeable,
                    adjusted=(raw/judgeable*100 if judgeable>0 else None),
                    unconf_pts=unconf_pts, unconf_n=unconf_n, rate=rate,
                    confirmed_zero=confirmed_zero, eligible=(rate<=30.0),
                    o_raw=o_raw, o_judge=o_judge, o_unconf=o_unconf, o_rate=o_rate,
                    o_adjusted=(o_raw/o_judge*100 if o_judge>0 else None),
                    o_eligible=(o_rate<=30.0))

wr('data/scoring_results.csv',
   ['municipality','item_id','axis_name','item_name','scale','max_points','points','status',
    'confidence','source_title','source_url','evidence','note'], sr_rows)

# ============================ municipalities.csv 更新 ============================
mu = rd('data/municipalities.csv')
NEWCOLS = ['dx_info_staff','dx_info_staff_source_date','dx_info_staff_confidence',
           'dx_info_staff_per_10000_population','dx_info_staff_per_100_staff',
           'info_policy_dept_staff','info_policy_dept_staff_confidence',
           'dx_bpr_combined_staff','dx_bpr_combined_staff_confidence','dx_staff_fiscal_year',
           'judgeable_points','unconfirmed_points','unconfirmed_rate','main_analysis_eligible',
           'confirmed_zero_items','external_expert','dx_bpr_integrated',
           'impl_score','impl_score_adjusted','impl_max_points','impl_judgeable_points',
           'impl_unconfirmed_points','impl_unconfirmed_rate','impl_main_analysis_eligible']
header = list(mu[0].keys())
for c in NEWCOLS:
    if c not in header: header.append(c)

for r in mu:
    m=r['municipality']
    for c in NEWCOLS: r.setdefault(c,'不明')
    # --- 広義（総務省） ---
    if m in DX_INFO_STAFF:
        v,conf,loc = DX_INFO_STAFF[m]
        r['dx_info_staff']=str(v); r['dx_info_staff_confidence']=conf
        r['dx_info_staff_source_date']='2024-04-01'
    else:
        r['dx_info_staff']='不明'; r['dx_info_staff_confidence']='不明'
        r['dx_info_staff_source_date']='不明'
    # --- 狭義（自治体資料）。広義とは別列を維持する ---
    nr = NARROW.get(m,{})
    if 'dx_staff' in nr:
        r['dx_staff']=str(nr['dx_staff']); r['dx_staff_confidence']=nr['dx_staff_conf']
    if 'infra_staff' in nr: r['infra_staff']=str(nr['infra_staff'])
    if 'bpr_staff' in nr:   r['bpr_staff']=str(nr['bpr_staff'])
    if 'info_policy_dept_staff' in nr:
        r['info_policy_dept_staff']=str(nr['info_policy_dept_staff'])
        r['info_policy_dept_staff_confidence']=nr['info_policy_conf']
    if 'dx_bpr_combined_staff' in nr:
        r['dx_bpr_combined_staff']=str(nr['dx_bpr_combined_staff'])
        r['dx_bpr_combined_staff_confidence']=nr['combined_conf']
    if 'fy' in nr: r['dx_staff_fiscal_year']=nr['fy']
    # --- 組織構造の定性情報（スコア化しない） ---
    r['external_expert']=EXTERNAL_EXPERT.get(m,'不明')
    r['dx_bpr_integrated']=DX_BPR_INTEGRATED.get(m,'不明')
    # --- 人口・職員総数 ---
    if m in POPULATION:
        pop,d,conf = POPULATION[m]
        r['population']=str(pop); r['population_source_date']=d; r['population_confidence']=conf
    if m in TOTAL_STAFF:
        r['total_staff'],r['total_staff_source_date'],r['total_staff_confidence']=TOTAL_STAFF[m]
    # --- 正規化指標: 分母が無ければ算出しない（0で埋めない） ---
    def numf(x):
        try: return float(x)
        except Exception: return None
    dxi=numf(r['dx_info_staff']); pop=numf(r['population']); tot=numf(r['total_staff'])
    r['dx_info_staff_per_10000_population']= ('%.2f'%(dxi/pop*10000)) if (dxi is not None and pop) else '不明'
    r['dx_info_staff_per_100_staff']      = ('%.2f'%(dxi/tot*100))    if (dxi is not None and tot) else '不明'
    dxs=numf(r['dx_staff'])
    r['dx_staff_per_10000_population'] = ('%.2f'%(dxs/pop*10000)) if (dxs is not None and pop) else '不明'
    r['dx_staff_per_100_staff']        = ('%.2f'%(dxs/tot*100))    if (dxs is not None and tot) else '不明'
    # --- スコア ---
    s=summary[m]
    r['dx_score']=('%g'%s['raw'])
    r['dx_score_adjusted']=('%.1f'%s['adjusted']) if s['adjusted'] is not None else '算出不能'
    r['judgeable_points']=('%g'%s['judgeable'])
    r['unconfirmed_points']=('%g'%s['unconf_pts'])
    r['unconfirmed_rate']=('%.1f'%s['rate'])
    r['unconfirmed_items']=str(s['unconf_n'])
    r['confirmed_zero_items']=str(s['confirmed_zero'])
    r['main_analysis_eligible']='該当' if s['eligible'] else '除外（未確認率30%超）'
    # --- 実装成果スコア（主分析の被説明変数） ---
    r['impl_score']=('%g'%s['o_raw'])
    r['impl_score_adjusted']=('%.1f'%s['o_adjusted']) if s['o_adjusted'] is not None else '算出不能'
    r['impl_max_points']=('%g'%OUTCOME_MAX)
    r['impl_judgeable_points']=('%g'%s['o_judge'])
    r['impl_unconfirmed_points']=('%g'%s['o_unconf'])
    r['impl_unconfirmed_rate']=('%.1f'%s['o_rate'])
    r['impl_main_analysis_eligible']='該当' if s['o_eligible'] else '除外（未確認率30%超）'

wr('data/municipalities.csv', header, mu)

# ============================ 相関分析 ============================
def pearson(xs,ys):
    n=len(xs)
    if n<3: return None
    mx=sum(xs)/n; my=sum(ys)/n
    sxy=sum((a-mx)*(b-my) for a,b in zip(xs,ys))
    sxx=sum((a-mx)**2 for a in xs); syy=sum((b-my)**2 for b in ys)
    if sxx==0 or syy==0: return None
    return sxy/math.sqrt(sxx*syy)

def rank_avg(a):
    idx=sorted(range(len(a)), key=lambda i:a[i]); r=[0.0]*len(a); i=0
    while i<len(idx):
        j=i
        while j+1<len(idx) and a[idx[j+1]]==a[idx[i]]: j+=1
        rk=(i+j)/2.0+1
        for k in range(i,j+1): r[idx[k]]=rk
        i=j+1
    return r

def spearman(xs,ys):
    if len(xs)<3: return None
    return pearson(rank_avg(xs), rank_avg(ys))

def numf(x):
    try: return float(x)
    except Exception: return None

# 事前登録（methodology §9.1〜§9.3）:
#   Spearman ρ を主指標、Pearson r を併記、95%信頼区間を併記する。
#   n<3 は算出不能。n<6（§9.1が望ましいとした水準）は「探索的」と表示し主分析と呼ばない。
MIN_N_CALC = 3
MIN_N_MAIN = 6

def fisher_ci(coef, n, kind):
    """Fisher z変換による95%信頼区間。
       Pearson  : SE = 1/sqrt(n-3)
       Spearman : SE = sqrt((1 + rho^2/2)/(n-3))  … Bonett–Wright (2000)
                  ※ sqrt(1.06/(n-3)) は Fieller et al. の近似であり別式。
       n<=3 では算出しない。標本が小さいほど区間は極端に広くなる点に注意。"""
    if coef is None or n < 4: return (None, None)
    c = max(min(coef, 0.999999), -0.999999)
    z = math.atanh(c)
    se = (1.0/math.sqrt(n-3)) if kind=='pearson' else math.sqrt((1.0 + c*c/2.0)/(n-3))
    return (math.tanh(z - 1.959964*se), math.tanh(z + 1.959964*se))

METRICS=[('dx_info_staff','DX・情報関係業務担当職員数（総務省・広義）'),
         ('dx_info_staff_per_10000_population','人口1万人あたりDX・情報関係業務担当職員数'),
         ('dx_info_staff_per_100_staff','職員100人あたりDX・情報関係業務担当職員数')]

# 被説明変数。主分析は実装成果スコアのみ。総合100点スコアは説明変数と構成概念が
# 重複するため感度分析に限定する。
OUTCOMES=[
  ('impl',  '実装成果スコア（II+III+IV-2+VI・60点）', 'impl_score','impl_score_adjusted',
   'impl_main_analysis_eligible', True),
  ('total', '総合DXスコア（21項目・100点）',          'dx_score','dx_score_adjusted',
   'main_analysis_eligible', False),
]

ana=[]
for mk,mlabel in METRICS:
    for okey,olabel,rawcol,adjcol,eligcol,allow_main in OUTCOMES:
        for stype,scol in (('raw',rawcol),('adjusted',adjcol)):
            scopes=[('感度分析（参考値を含む全市）', None)]
            if allow_main:
                scopes.insert(0, ('主分析（実装成果・未確認率30%以下）', eligcol))
            for scope,efld in scopes:
                xs=[];ys=[];used=[];excl=[]
                for r in mu:
                    if efld and r[efld]!='該当': excl.append(r['municipality']); continue
                    x=numf(r[mk]); y=numf(r[scol])
                    if x is None or y is None: excl.append(r['municipality']); continue
                    xs.append(x); ys.append(y); used.append(r['municipality'])
                n=len(xs)
                pr=pearson(xs,ys); sp=spearman(xs,ys)
                prl,prh=fisher_ci(pr,n,'pearson'); spl,sph=fisher_ci(sp,n,'spearman')
                if n < MIN_N_CALC:      tier='算出不能'
                elif n < MIN_N_MAIN:    tier='探索的（n<%d）'%MIN_N_MAIN
                else:                   tier='成立（n>=%d）'%MIN_N_MAIN

                # scope 固有の注記は n によらず必ず付ける
                if scope.startswith('主分析'):
                    base='相関は因果を意味しない。'
                    if 0 < n < MIN_N_MAIN:
                        base+='n<%d のため探索的な値であり主分析として断定的に解釈しない。'%MIN_N_MAIN
                    base+='有意でないことは関係が無いことを意味しない（検出力不足）'
                else:
                    base='参考値であり主結論には用いない。'
                    if okey=='total':
                        base+='総合100点スコアは I-3・IV-1・V-2・V-3 等、説明変数と構成概念が重複する項目を含むため'
                        base+='人員数と相関させると採点設計に由来する相関が生じうる'
                    else:
                        base+='未確認率30%超の市を含むためスコアは調査到達度を強く反映する'

                if n < MIN_N_CALC:
                    note='n<%d のため算出不能。データ不足であり「相関なし」を意味しない'%MIN_N_CALC
                    if efld:
                        eg=[r['municipality'] for r in mu if r[efld]=='該当']
                        lack=[m2 for m2 in eg
                              if numf([r for r in mu if r['municipality']==m2][0][mk]) is None]
                        if eg and lack:
                            note += ('。主分析対象%d市（%s）は本指標が未取得のため対が作れない'
                                     %(len(eg),'／'.join(eg)))
                    note += '。' + base
                else:
                    note = base

                def f3(v): return ('%.3f'%v) if v is not None else '算出不能'
                ana.append(dict(metric=mk, metric_label=mlabel,
                    outcome=okey, outcome_label=olabel, score_type=stype, scope=scope,
                    tier=tier, n=n, excluded=len(excl),
                    pearson=f3(pr), pearson_ci_low=f3(prl), pearson_ci_high=f3(prh),
                    spearman=f3(sp), spearman_ci_low=f3(spl), spearman_ci_high=f3(sph),
                    included_municipalities='／'.join(used) if used else '—',
                    excluded_municipalities='／'.join(excl) if excl else '—',
                    note=note))

wr('data/analysis_results.csv',
   ['metric','metric_label','outcome','outcome_label','score_type','scope','tier',
    'n','excluded','pearson','pearson_ci_low','pearson_ci_high',
    'spearman','spearman_ci_low','spearman_ci_high',
    'included_municipalities','excluded_municipalities','note'], ana)

# ============================ 標準出力サマリー ============================
print('=== 採点結果（凍結ルーブリック %g点満点・%d項目／実装成果 %g点・%d項目） ==='%(
      TOTAL_POINTS,len(rubric),OUTCOME_MAX,sum(1 for r in rubric if is_outcome(r))))
print('%-9s %6s %8s %7s %s | %6s %8s %7s %s'%(
      '市','総合raw','判定可能','未確認率','主分析','成果raw','判定可能','未確認率','主分析'))
for m in MUNIS:
    s2=summary[m]
    print('%-9s %6g %8g %6.1f%% %s | %6g %8g %6.1f%% %s'%(
          m,s2['raw'],s2['judgeable'],s2['rate'],'該当' if s2['eligible'] else '除外',
          s2['o_raw'],s2['o_judge'],s2['o_rate'],'該当' if s2['o_eligible'] else '除外'))
elig=[m for m in MUNIS if summary[m]['eligible']]
oelig=[m for m in MUNIS if summary[m]['o_eligible']]
print('\n総合スコアで未確認率30%%以下: %d市 — %s'%(len(elig),'／'.join(elig) or 'なし'))
print('実装成果スコアで未確認率30%%以下（主分析対象）: %d市 — %s'%(len(oelig),'／'.join(oelig) or 'なし'))
print('広義人員 確認済み: %d市'%len(DX_INFO_STAFF))
both=[m for m in oelig if m in DX_INFO_STAFF]
print('主分析対象かつ広義人員あり: %d市 — %s'%(len(both), '／'.join(both) or 'なし'))

print('\n=== 相関（広義人数 × 各被説明変数） ===')
for a in ana:
    if a['metric']=='dx_info_staff':
        print('  %-30s %-8s %-14s n=%-2d  r=%-9s [%s, %s]  rho=%-9s [%s, %s]'%(
              a['scope'],a['score_type'],a['outcome'],a['n'],
              a['pearson'],a['pearson_ci_low'],a['pearson_ci_high'],
              a['spearman'],a['spearman_ci_low'],a['spearman_ci_high']))
