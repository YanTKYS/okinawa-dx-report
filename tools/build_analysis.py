# -*- coding: utf-8 -*-
"""
沖縄県内11市 DX調査 — 統合・採点・分析ビルドスクリプト

入力: data/scoring_rubric.csv（凍結済み。変更しない）
出力: data/scoring_results.csv, data/analysis_results.csv,
      data/municipalities.csv（人員・スコア列を更新）

原則:
  - 確度A・Bの根拠がある項目のみ採点する（docs/methodology.md §5）
  - 根拠が無い項目は「未確認」。素点0点だが「非実施」とは区別する（§6）
  - 総務省の広義指標を狭義 dx_staff に混入させない
  - 推測値は一切入力しない
"""
import csv, io, math, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
def p(*a): return os.path.join(ROOT, *a)

SURVEY = '総務省「令和6年度 自治体DX・情報化推進概要」個別資料'
SURVEY_URL = 'https://www.soumu.go.jp/main_content/001048599.zip'
SURVEY_FILE = '【R06個別資料】（１）自治体DXの推進体制等（市区町村）.xlsx'

# ----------------------------------------------------------------------------
# 1. 総務省 共通指標（広義）: DX推進担当課室・情報政策担当課室の職員数
#    基準日 2024-04-01 / 確度A / 第3回Deep Researchで一次資料から直接確認
#    那覇市(行1753)・宜野湾市(行1754)・浦添市(行1756)は本作業環境から
#    総務省ドメインへ到達できず未取得。推測しない（欠損のまま）。
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
DX_INFO_PENDING = {'那覇市':'Excel 1753行（推定）','宜野湾市':'Excel 1754行（推定）','浦添市':'Excel 1756行（推定）'}

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

# 人口（確度A・B のみ）。11市同一定義での取得は未達。
POPULATION = {'那覇市': (311916, '2026-08-31', 'A', '那覇市公式サイト人口統計',
                         'https://www.city.naha.okinawa.jp/admin/kaikaku/1008233/1004100/1004101.html')}
TOTAL_STAFF = {}   # 普通会計職員数（総務省定員管理調査ベース）: 未取得

# ----------------------------------------------------------------------------
# 3. 採点ファクト表
#    (市, 項目ID) -> (配点, 確度, 出典名, URL, 根拠, 判定理由)
#    確度A・Bの一次資料根拠があるものだけを列挙する。ここに無い項目は自動的に「未確認」。
# ----------------------------------------------------------------------------
N = 'https://www.city.naha.okinawa.jp/admin/kaikaku/1008233/1004100/1004101.html'
SCORED = {
 # --- I-1 DX推進計画・方針の策定（満点6：独立した計画/方針を策定・公表） ---
 ('宜野湾市','I-1'): (6,'B','宜野湾市DX推進計画',
    'https://www.city.ginowan.lg.jp/soshiki/kikaku/digitalsuishin/2/1/1/14257.html',
    '第1回DRが「DX推進計画策定済」を確認（基本計画・実施計画の二部構成）','独立したDX推進計画を策定・公表'),
 ('石垣市','I-1'): (6,'A','石垣市デジタル化推進計画（令和4年4月・企画部DX課）',
    'https://www.city.ishigaki.okinawa.jp/material/files/group/1/dx_plan.pdf',
    '第1回DRが策定主体・策定時期を一次資料で確認','独立した計画として策定・公表'),
 ('糸満市','I-1'): (6,'A','糸満市ＤＸ推進方針',
    'https://www.city.itoman.lg.jp/soshiki/8/22449.html',
    '第1回DR evidence: 企画部情報政策課がDX推進方針を策定・公表（確度A・検証済）','独立した推進方針を策定・公表'),

 # --- I-3 全庁的推進本部の設置（満点5：設置要綱等の規程を確認／半点2：言及のみ） ---
 ('うるま市','I-3'): (5,'A','うるま市DX推進本部設置要綱',
    'https://www1.g-reiki.net/uruma/reiki_honbun/r170RG00002011.html',
    '第4条「本部長は最高情報統括責任者(CIO)」第9条「庶務は総務部DX推進課において処理」','設置要綱という規程本文を確認したため満点'),
 ('那覇市','I-3'): (2,'A','DXの推進 概要（那覇市デジタル化推進本部）', N,
    '第1回DRが公式ページで「デジタル化推進本部（2021年4月設置）が全庁体制」を確認','設置要綱の本文は未確認のため半点（言及のみ）'),

 # --- II-2 オンライン化対象手続の公表（満点5：一覧公表／半点2.5：件数のみ） ---
 ('那覇市','II-2'): (2.5,'A','DXの推進 概要（情報政策課の所掌）', N,
    '情報政策課が「標準化・共通化及び行政手続のオンライン化（31手続）」を所掌と明記','件数の確認にとどまり対象手続一覧は未確認のため半点'),

 # --- IV-1 BPR・業務改善の専管組織／推進体制（満点5：専管組織（課・室）あり） ---
 ('那覇市','IV-1'): (5,'A','DXの推進 概要（企画調整課DX推進室の所掌）', N,
    'DX推進室が「デジタル技術を活用した業務改革の推進」を所掌する室として設置','業務改革を所掌する室が存在するため満点'),
 ('宜野湾市','IV-1'): (5,'A','令和7年度宜野湾市行政組織図',
    'https://www.city.ginowan.lg.jp/material/files/group/7/r7ginowansisosikizu.pdf',
    '「行政経営室（5）」「行政改革推進班（4）」を組織図で確認','行革を所掌する室が存在するため満点'),
 ('浦添市','IV-1'): (5,'A','行政改革推進課',
    'https://www.city.urasoe.lg.jp/soshiki/kikakubu/gyoseikaikakusuishinka/',
    '「財務部行財政改革推進課と企画部デジタルシティ推進室を統合して令和7年度に設置」','行革を所掌する課が存在するため満点'),
 ('名護市','IV-1'): (5,'B','業務改善推進室',
    'https://www.city.nago.okinawa.jp/soshiki/soumubu/gyoumukaizensuishin/',
    '第1回DR: 組織一覧に「業務改善推進室」を確認。業務改善・庁内DX推進を所掌','業務改善専管の室が存在するため満点'),
 ('うるま市','IV-1'): (5,'A','各課のご案内（行政マネジメント課／事務事業イノベーション推進室）',
    'https://www.city.uruma.lg.jp/1001004000/contents/863.html',
    '第1回DR:「行政マネジメント課が定員管理・行革を分離所管」。第2回DRで事務事業イノベーション推進室を機構図で確認','行革・業務改善の専管組織が存在するため満点'),

 # --- V-2 外部専門人材の活用（満点5：CIO補佐官等を任用） ---
 ('石垣市','V-2'): (5,'A', SURVEY, SURVEY_URL,
    '「1_組織体制（４）CIO、CIO補佐官、CISO以外の外部デジタル人材」に「任用している／人数3」と記載（Excel 1755行）','外部デジタル人材3人を任用と一次資料で確認'),
 ('那覇市','V-2'): (5,'B','DXの推進 概要（デジタル民間専門人材）', N,
    '「DX推進室にデジタル民間専門人材を受け入れています」と明記（人数記載なし）','外部専門人材の活用を確認（人数は不明のまま）'),
}

MUNIS = ['那覇市','宜野湾市','石垣市','浦添市','名護市','糸満市','沖縄市','豊見城市','うるま市','宮古島市','南城市']

def rd(path):
    with io.open(p(path), encoding='utf-8') as f: return list(csv.DictReader(f))
def wr(path, header, rows):
    with io.open(p(path),'w',encoding='utf-8',newline='') as f:
        w=csv.DictWriter(f,fieldnames=header); w.writeheader(); w.writerows(rows)

# ============================ 採点 ============================
rubric = rd('data/scoring_rubric.csv')
TOTAL_POINTS = sum(float(r['max_points']) for r in rubric)

sr_rows=[]; summary={}
for m in MUNIS:
    raw=0.0; judgeable=0.0; unconf_pts=0.0; unconf_n=0
    for it in rubric:
        iid=it['item_id']; mx=float(it['max_points'])
        key=(m,iid)
        if key in SCORED:
            pts,conf,title,url,ev,note = SCORED[key]
            raw+=pts; judgeable+=mx
            status='満点' if pts==mx else ('部分点' if pts>0 else '0点')
        else:
            pts,conf,title,url,ev,note = 0,'','','','','確度A・Bの一次資料根拠を確認できず。非実施を意味しない'
            status='未確認'; unconf_pts+=mx; unconf_n+=1
        sr_rows.append(dict(municipality=m,item_id=iid,axis_name=it['axis_name'],
            item_name=it['item_name'],max_points=('%g'%mx),points=('%g'%pts),status=status,
            confidence=conf or '不明',source_title=title,source_url=url,evidence=ev,note=note))
    rate = unconf_pts/TOTAL_POINTS*100
    summary[m]=dict(raw=raw, judgeable=judgeable,
                    adjusted=(raw/judgeable*100 if judgeable>0 else None),
                    unconf_pts=unconf_pts, unconf_n=unconf_n, rate=rate,
                    eligible=(rate<=30.0))

wr('data/scoring_results.csv',
   ['municipality','item_id','axis_name','item_name','max_points','points','status',
    'confidence','source_title','source_url','evidence','note'], sr_rows)

# ============================ municipalities.csv 更新 ============================
mu = rd('data/municipalities.csv')
NEWCOLS = ['dx_info_staff','dx_info_staff_source_date','dx_info_staff_confidence',
           'dx_info_staff_per_10000_population','dx_info_staff_per_100_staff',
           'info_policy_dept_staff','info_policy_dept_staff_confidence',
           'dx_bpr_combined_staff','dx_bpr_combined_staff_confidence','dx_staff_fiscal_year',
           'judgeable_points','unconfirmed_points','unconfirmed_rate','main_analysis_eligible']
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
    # --- 人口・職員総数 ---
    if m in POPULATION:
        pop,d,conf,_t,_u = POPULATION[m]
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
            else:
                note='相関は因果を意味しない。n が小さく結論は限定的'
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
print('%-8s %6s %8s %8s %8s %s'%('市','raw','判定可能','adjusted','未確認率','主分析'))
for m in MUNIS:
    s=summary[m]
    adj=('%.1f'%s['adjusted']) if s['adjusted'] is not None else '算出不能'
    print('%-8s %6g %8g %8s %7.1f%% %s'%(m,s['raw'],s['judgeable'],adj,s['rate'],
          '該当' if s['eligible'] else '除外'))
print('\n=== 主要な相関（広義人数 × raw score） ===')
for a in ana:
    if a['metric']=='dx_info_staff' and a['score_type']=='raw':
        print('  %s: n=%d 除外=%d  Pearson=%s  Spearman=%s'%(a['scope'],a['n'],a['excluded'],a['pearson'],a['spearman']))
