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

# 糸満市の庁内実態（ユーザー提供・公開一次資料ではない）。
# 総務省の広義人員（2024年度6人）とは定義が異なるため、別指標として保持する。
ITOMAN_FIELD_TEAM = dict(fy='2026年度', staff=2, prev=3,
    note='ユーザー提供の庁内実態。公開一次資料未確認。総務省広義人員（2024年度6人）とは定義が異なる')

# 外部専門人材の任用状況（総務省2024年度調査・V-2の根拠と同一）
EXTERNAL_EXPERT = {'那覇市':'有','宜野湾市':'有','石垣市':'有（3人）','浦添市':'有','宮古島市':'有',
                   '名護市':'無（2024年度時点）','糸満市':'無（2024年度時点）','沖縄市':'無（2024年度時点）',
                   '豊見城市':'無（2024年度時点）','うるま市':'無（2024年度時点）','南城市':'無（2024年度時点）'}

# DXとBPRを同一組織で所掌しているか（組織図・課紹介による定性分類。スコア化しない）
DX_BPR_INTEGRATED = {'浦添市':'該当（行政改革推進課＝行革＋デジタルを統合）',
                     '那覇市':'該当（DX推進室が業務改革を所掌）',
                     '名護市':'非該当（業務改善推進室とDX/情報システムが別組織）',
                     '宜野湾市':'非該当（デジタル推進課と行政経営室が別組織）',
                     'うるま市':'非該当（DX推進課と事務事業イノベーション推進室が別組織）'}

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

sr_rows=[]; summary={}
for m in MUNIS:
    raw=0.0; judgeable=0.0; unconf_pts=0.0; unconf_n=0; confirmed_zero=0
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
        sr_rows.append(dict(municipality=m,item_id=iid,axis_name=it['axis_name'],
            item_name=it['item_name'],max_points=('%g'%mx),points=('%g'%pts),status=status,
            confidence=conf,source_title=title,source_url=url,evidence=ev,note=note))
    rate = unconf_pts/TOTAL_POINTS*100
    summary[m]=dict(raw=raw, judgeable=judgeable,
                    adjusted=(raw/judgeable*100 if judgeable>0 else None),
                    unconf_pts=unconf_pts, unconf_n=unconf_n, rate=rate,
                    confirmed_zero=confirmed_zero, eligible=(rate<=30.0))

wr('data/scoring_results.csv',
   ['municipality','item_id','axis_name','item_name','max_points','points','status',
    'confidence','source_title','source_url','evidence','note'], sr_rows)

# ============================ municipalities.csv 更新 ============================
mu = rd('data/municipalities.csv')
NEWCOLS = ['dx_info_staff','dx_info_staff_source_date','dx_info_staff_confidence',
           'dx_info_staff_per_10000_population','dx_info_staff_per_100_staff',
           'info_policy_dept_staff','info_policy_dept_staff_confidence',
           'dx_bpr_combined_staff','dx_bpr_combined_staff_confidence','dx_staff_fiscal_year',
           'judgeable_points','unconfirmed_points','unconfirmed_rate','main_analysis_eligible',
           'confirmed_zero_items','external_expert','dx_bpr_integrated',
           'field_team_staff','field_team_fiscal_year','field_team_note']
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
    # --- 糸満市の2026年度DX推進実働体制（別指標。広義6人と混同しない） ---
    if m == '糸満市':
        r['field_team_staff']=str(ITOMAN_FIELD_TEAM['staff'])
        r['field_team_fiscal_year']=ITOMAN_FIELD_TEAM['fy']
        r['field_team_note']='前年度%d人。%s'%(ITOMAN_FIELD_TEAM['prev'], ITOMAN_FIELD_TEAM['note'])
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

METRICS=[('dx_info_staff','DX・情報関係業務担当職員数（総務省・広義）'),
         ('dx_info_staff_per_10000_population','人口1万人あたりDX・情報関係業務担当職員数'),
         ('dx_info_staff_per_100_staff','職員100人あたりDX・情報関係業務担当職員数')]
SCORES=[('dx_score','raw'),('dx_score_adjusted','adjusted')]

ana=[]
for mk,mlabel in METRICS:
    for sk,slabel in SCORES:
        for scope,flt in (('主分析（未確認率30%以下）', lambda r: r['main_analysis_eligible']=='該当'),
                          ('感度分析（参考値を含む全市）', lambda r: True)):
            xs=[];ys=[];used=[];excl=[]
            for r in mu:
                if not flt(r): excl.append(r['municipality']); continue
                x=numf(r[mk]); y=numf(r[sk])
                if x is None or y is None: excl.append(r['municipality']); continue
                xs.append(x); ys.append(y); used.append(r['municipality'])
            pr=pearson(xs,ys); sp=spearman(xs,ys)
            if len(xs)<3:
                note='n<3のため算出不能。データ不足であり「相関なし」を意味しない'
                if scope.startswith('主分析'):
                    eg=[r['municipality'] for r in mu if r['main_analysis_eligible']=='該当']
                    lack=[m2 for m2 in eg if numf([r for r in mu if r['municipality']==m2][0][mk]) is None]
                    if eg and lack:
                        note += ('。主分析対象%d市（%s）は本指標が未取得のため対が作れない'
                                 %(len(eg),'／'.join(eg)))
            elif scope.startswith('主分析'):
                note='相関は因果を意味しない。n が小さく検出力は低い。有意でないことは関係が無いことを意味しない'
            else:
                note='参考値。未確認率30%超の市を含むためスコアは調査到達度を強く反映する。主結論には用いない'
            ana.append(dict(metric=mk, metric_label=mlabel, score_type=slabel, scope=scope,
                n=len(xs), excluded=len(excl),
                pearson=('%.3f'%pr) if pr is not None else '算出不能',
                spearman=('%.3f'%sp) if sp is not None else '算出不能',
                included_municipalities='／'.join(used) if used else '—',
                excluded_municipalities='／'.join(excl) if excl else '—',
                note=note))

wr('data/analysis_results.csv',
   ['metric','metric_label','score_type','scope','n','excluded','pearson','spearman',
    'included_municipalities','excluded_municipalities','note'], ana)

# ============================ 標準出力サマリー ============================
print('=== 採点結果（凍結ルーブリック %g点満点・%d項目） ==='%(TOTAL_POINTS,len(rubric)))
print('%-9s %6s %8s %9s %8s %7s %s'%('市','raw','判定可能','adjusted','未確認率','確認0点','主分析'))
for m in MUNIS:
    s=summary[m]
    adj=('%.1f'%s['adjusted']) if s['adjusted'] is not None else '算出不能'
    print('%-9s %6g %8g %9s %7.1f%% %6d %s'%(m,s['raw'],s['judgeable'],adj,s['rate'],
          s['confirmed_zero'],'該当' if s['eligible'] else '除外'))
elig=[m for m in MUNIS if summary[m]['eligible']]
print('\n主分析対象（未確認率30%%以下）: %d市 — %s'%(len(elig), '／'.join(elig) or 'なし'))
print('広義人員 確認済み: %d市 — %s'%(len(DX_INFO_STAFF),'／'.join(sorted(DX_INFO_STAFF))))
both=[m for m in elig if m in DX_INFO_STAFF]
print('主分析対象かつ広義人員あり: %d市 — %s'%(len(both), '／'.join(both) or 'なし'))

print('\n=== 相関（広義人数 × raw / adjusted） ===')
for a in ana:
    if a['metric']=='dx_info_staff':
        print('  %-26s %-8s n=%-2d 除外=%-2d  Pearson=%-8s Spearman=%s'%(
              a['scope'],a['score_type'],a['n'],a['excluded'],a['pearson'],a['spearman']))
