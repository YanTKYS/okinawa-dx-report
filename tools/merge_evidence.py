# -*- coding: utf-8 -*-
"""3回のDeep Researchで一次資料から確認された根拠を evidence.csv へ統合する。
   - 確度A/Bとして引き継ぐのは「一次資料を直接確認し、URLと具体的記載がある」ものに限る
   - 「所在を特定した」「要確認」段階のものはA/Bにしない
   - 既存の同一事項の行は重複追加せず、supersede 注記で新行を指す
"""
import csv, io, os
ROOT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
P=os.path.join(ROOT,'data','evidence.csv')
rows=list(csv.DictReader(io.open(P,encoding='utf-8')))
H=list(rows[0].keys())
CD='2026-09-16'
SZIP='https://www.soumu.go.jp/main_content/001048599.zip'
SNAME='令和6年度 自治体DX・情報化推進概要 個別資料【R06個別資料】（１）自治体DXの推進体制等（市区町村）.xlsx'
NAHA_ORG='https://www.city.naha.okinawa.jp/_res/projects/default_project/_page_/001/003/945/soshikizu.pdf'
NAHA_DX='https://www.city.naha.okinawa.jp/admin/kaikaku/1008233/1004100/1004101.html'
GINO='https://www.city.ginowan.lg.jp/material/files/group/7/r7ginowansisosikizu.pdf'
URA='https://www.city.urasoe.lg.jp/doc/609e70973d59ae2434bfd8c2/file_contents/file_20266291134315_1.pdf'

def R(i,m,f,v,sn,pub,url,st,pd,conf,vs,note):
    return dict(evidence_id=i,municipality=m,field=f,value=v,source_name=sn,publisher=pub,
                source_url=url,source_type=st,published_date=pd,confirmed_date=CD,
                confidence=conf,verification_status=vs,note=note)

new=[]
# --- 総務省 共通指標（広義）: 8市確定 ---
soumu={'石垣市':(5,1755),'名護市':(14,1757),'糸満市':(6,1758),'沖縄市':(13,1759),
       '豊見城市':(8,1760),'うるま市':(10,1761),'宮古島市':(8,1762),'南城市':(6,1763)}
for i,(m,(v,row)) in enumerate(sorted(soumu.items(), key=lambda kv: kv[1][1]), start=1):
    new.append(R('D%03d'%i, m, 'dx_info_staff', str(v), SNAME, '総務省', SZIP, '8_公的資料',
      '2025-12', 'A', '検証済（第3回DR・一次資料直接確認）',
      'シート1_組織体制（８）DX推進担当課室・情報政策担当課室の職員数。Excel %d行「沖縄県／%s／%d」。基準日2024-04-01。DX専任人数ではなく情報政策担当を含む広義値'%(row,m,v)))
new.append(R('D009','共通','dx_info_staff定義','DX推進担当課室・情報政策担当課室の職員数',
  '令和6年度 自治体DX・情報化推進概要（本文）','総務省','https://www.soumu.go.jp/main_content/001048571.pdf',
  '8_公的資料','2025-12','A','検証済（第3回DR）',
  '基準日2024年4月1日。DX推進専任部署は「企画立案、部門間調整、全体方針・取組の進捗管理等を担う部署」と定義。情報政策担当課室も集計対象のためDX専任人数として扱えない'))
new.append(R('D010','那覇市','dx_info_staff','不明',SNAME,'総務省',SZIP,'8_公的資料','2025-12','不明',
  '未取得（本作業環境から総務省ドメインへ到達不可）','同一資料内 Excel 1753行（団体コード順からの推定位置）に収録されているはず。推測値を入力せず欠損とした'))
new.append(R('D011','宜野湾市','dx_info_staff','不明',SNAME,'総務省',SZIP,'8_公的資料','2025-12','不明',
  '未取得（本作業環境から総務省ドメインへ到達不可）','同一資料内 Excel 1754行（推定位置）。デジタル推進係4人等の狭義値を代替に用いてはならない'))
new.append(R('D012','浦添市','dx_info_staff','不明',SNAME,'総務省',SZIP,'8_公的資料','2025-12','不明',
  '未取得（本作業環境から総務省ドメインへ到達不可）','同一資料内 Excel 1756行（推定位置）'))
new.append(R('D013','石垣市','external_dx_staff','3',SNAME,'総務省',SZIP,'8_公的資料','2025-12','A',
  '検証済（第3回DR）','シート1_組織体制（４）「CIO、CIO補佐官、CISO以外の外部デジタル人材」に「任用している／人数3」。dx_info_staff 5人との重複有無は資料から不明のため合算しない'))

# --- 那覇市（第2回DR：令和8年度組織図で直接確認） ---
new += [
 R('D020','那覇市','dx_staff','8','令和8年度那覇市組織図','那覇市',NAHA_ORG,'3_組織機構図','2026年度','A',
   '検証済（第2回DR・PDF本文確認）','p.1 市長事務部局「企画調整課 32」「DX推進室 8」。DX専管室の配置人数。BPR主担当の内訳は未公表'),
 R('D021','那覇市','info_policy_dept_staff','23','令和8年度那覇市組織図','那覇市',NAHA_ORG,'3_組織機構図','2026年度','A',
   '検証済（第2回DR・PDF本文確認）','「情報政策課23」「情報化推進G8」「業務管理G8」「標準化G5」。情報システム運用専任23人とは扱わない'),
 R('D022','那覇市','bpr_staff','不明','令和8年度那覇市組織図','那覇市',NAHA_ORG,'3_組織機構図','2026年度','不明',
   '未確認','DX推進室8人のうちBPR主担当が何人かを示す配置表は未公表。按分しない'),
 R('D023','那覇市','population','311916','DXの推進 概要（フッター人口統計）','那覇市',NAHA_DX,'1_自治体公式サイト','2026-08-31','A',
   '検証済（第1回DR）','総人口311,916（うち外国人10,159）令和8年8月末時点。他10市は同一定義の人口を未取得'),
 R('D024','那覇市','external_dx_staff','有（人数不明）','DXの推進 概要','那覇市',NAHA_DX,'1_自治体公式サイト','2025-12-24','B',
   '検証済（第1回DR）','「DX推進室にデジタル民間専門人材を受け入れています」。人数記載なし。V-2の採点根拠'),
 R('D025','那覇市','推進本部','那覇市デジタル化推進本部（2021年4月設置）','DXの推進 概要','那覇市',NAHA_DX,'1_自治体公式サイト','2025-12-24','A',
   '検証済（第1回DR）','公式ページで全庁推進体制として言及。設置要綱本文は未確認のためI-3は半点'),
 R('D026','那覇市','オンライン化手続','31手続','DXの推進 概要','那覇市',NAHA_DX,'1_自治体公式サイト','2025-12-24','A',
   '検証済（第1回DR）','情報政策課が情報システム標準化・共通化および行政手続オンライン化31手続を所掌。件数のみのためII-2は半点'),
]
# --- 宜野湾市（第2回DR：令和7年度組織図） ---
new += [
 R('D030','宜野湾市','dx_staff','4','令和7年度宜野湾市行政組織図','宜野湾市',GINO,'3_組織機構図','2025年度','A',
   '検証済（第2回DR・PDF本文確認）','p.1 企画部「デジタル推進課（11）」「デジタル推進係（4）」。2026年度組織図は未公開確認のため前年値を現在値としない'),
 R('D031','宜野湾市','infra_staff','6','令和7年度宜野湾市行政組織図','宜野湾市',GINO,'3_組織機構図','2025年度','A',
   '検証済（第2回DR）','「システム管理係（6）」。情報システム運用・インフラに該当'),
 R('D032','宜野湾市','bpr_staff','4','令和7年度宜野湾市行政組織図','宜野湾市',GINO,'3_組織機構図','2025年度','A',
   '検証済（第2回DR）','「行政経営室（5）」「行政改革推進班（4）」。DX・情シス・BPRを分離できる県内唯一の事例'),
]
# --- 浦添市（第2回DR：令和8年度行政機構図（人数あり）） ---
new += [
 R('D040','浦添市','dx_bpr_combined_staff','5','令和8年度浦添市行政機構図（人数あり）','浦添市',URA,'3_組織機構図','2026年度','A',
   '検証済（第2回DR・PDF本文確認）','p.1 企画部「行政改革推進課5」「行政改革推進係4」。DX・BPR統合部署の総数であり、DX実人数とBPR実人数へ按分してはならない'),
 R('D041','浦添市','info_policy_dept_staff','10','令和8年度浦添市行政機構図（人数あり）','浦添市',URA,'3_組織機構図','2026年度','A',
   '検証済（第2回DR）','「情報政策課10」「情報政策係9」'),
 R('D042','浦添市','dx_org_established','2025-04-01','行政改革推進課','浦添市',
   'https://www.city.urasoe.lg.jp/soshiki/kikakubu/gyoseikaikakusuishinka/','1_自治体公式サイト','2026-04-09','A',
   '検証済（第1回DR）','「組織機構改革により財務部行財政改革推進課と企画部デジタルシティ推進室を統合して令和7年度に設置」。旧evidence E402の不確実性を解消'),
]
# --- うるま市・石垣市・糸満市・名護市ほか（第1回DR） ---
new += [
 R('D050','うるま市','推進本部','DX推進本部（本部長＝CIO）','うるま市DX推進本部設置要綱','うるま市',
   'https://www1.g-reiki.net/uruma/reiki_honbun/r170RG00002011.html','1_自治体公式サイト','不明','A',
   '検証済（第1回DR・要綱本文確認）','第4条「本部長は最高情報統括責任者(CIO)」第9条「庶務は総務部DX推進課において処理」。I-3満点の根拠'),
 R('D051','うるま市','bpr_department','行政マネジメント課／事務事業イノベーション推進室','各課のご案内','うるま市',
   'https://www.city.uruma.lg.jp/1001004000/contents/863.html','1_自治体公式サイト','不明','A',
   '検証済（第1回DR）','行政マネジメント課が定員管理・行革を分離所管。第2回DRで令和8年度機構図に事務事業イノベーション推進室を確認'),
 R('D052','石垣市','dx_department','企画部 DX推進課','令和8年度組織機構図','石垣市',
   'https://www.city.ishigaki.okinawa.jp/soshiki/index.html','3_組織機構図','2026-06-25','A',
   '検証済（第1回DR）','企画部内にDX推進課を確認（旧DX課）。ただし機構図に人数記載なしを第2回DRで確認'),
 R('D053','石垣市','dx_plan','石垣市デジタル化推進計画（令和4年4月）','石垣市デジタル化推進計画','石垣市',
   'https://www.city.ishigaki.okinawa.jp/material/files/group/1/dx_plan.pdf','2_DX推進計画','2022-04','A',
   '検証済（第1回DR）','企画部DX課名義で策定。計画期間は未確認のためI-2（現行性）は未確認'),
 R('D054','糸満市','dx_plan','糸満市ＤＸ推進方針','糸満市ＤＸ推進方針','糸満市',
   'https://www.city.itoman.lg.jp/soshiki/8/22449.html','2_DX推進計画','不明','A',
   '検証済（第1回DR）','企画部情報政策課が策定・公表。I-1満点の根拠'),
 R('D055','名護市','bpr_department','総務部 業務改善推進室','業務改善推進室','名護市',
   'https://www.city.nago.okinawa.jp/soshiki/soumubu/gyoumukaizensuishin/','1_自治体公式サイト','不明','B',
   '検証済（第1回DR）','業務改善・庁内DX推進・個人番号制度総括を所掌。配置人数は未公表（内線番号は人数根拠に採用しない）'),
 R('D056','沖縄市','dx_department','DX戦略室（DX推進課／情報システム課）','組織一覧','沖縄市',
   'https://www.city.okinawa.okinawa.jp/k010-003/shiseijouhou/gaiyou/soshikiannai/organize/index.html','3_組織機構図','不明','A',
   '検証済（第1回DR）','DX推進と情報システム運用を組織的に分離。第2回DRで令和8年度組織図に人数記載なしを確認'),
 R('D057','南城市','dx_org_established','2022-04-01','《令和4年4月より》DX推進課の新設','南城市',
   'https://www.city.nanjo.okinawa.jp/shisei/gyoukaku/1648425409/1648424956/','1_自治体公式サイト','2022-04','A',
   '検証済（第1回DR）','基幹システム・ネットワーク・DX推進・マイナンバーを一課で所管（情報システム運用一体型）'),
]
# --- 人数記載が「無い」ことを確認した否定的証拠（重要：未調査と区別する） ---
neg=[('石垣市','令和8年度組織機構図','https://www.city.ishigaki.okinawa.jp/material/files/group/4/R8d_ippan_yosan.pdf'),
     ('沖縄市','令和8年度沖縄市組織図','https://www.city.okinawa.okinawa.jp/documents/1742/r08soshikizu.pdf'),
     ('豊見城市','令和8年度豊見城市行政機構','https://www.city.tomigusuku.lg.jp/material/files/group/4/R80401-gyouseikikou.pdf'),
     ('宮古島市','令和8年度宮古島市行政機構図','https://www.city.miyakojima.lg.jp/soshiki/files/R8kikouzu.pdf'),
     ('南城市','南城市組織図','https://www.city.nanjo.okinawa.jp/userfiles/files/R6soshiki_1.pdf')]
for i,(m,t,u) in enumerate(neg, start=60):
    new.append(R('D%03d'%i, m, '課別職員数（自治体資料）','記載なし（確認済）', t, m, u, '3_組織機構図','不明','A',
      '検証済（第2回DR・本文確認）','当該機構図の本文に課・係別の人数記載が無いことを確認した。未調査ではない。過年度版からの転用・推計は行わない'))

# 旧行の supersede 注記
sup={'E402':'D042','E101':'D020','E102':'D021','E701':'D056','E903':'D050','E902':'D051',
     'E301':'D052','E302':'D053','E602':'D054','E501':'D055','E1101':'D057','E107':'D024'}
for r in rows:
    if r['evidence_id'] in sup:
        r['note']=(r['note']+' ／ ').strip()+'※%s で一次資料確認済（確度更新）'%sup[r['evidence_id']]

out=rows+new
with io.open(P,'w',encoding='utf-8',newline='') as f:
    w=csv.DictWriter(f,fieldnames=H); w.writeheader(); w.writerows(out)
print('evidence.csv: %d行 → %d行（+%d）'%(len(rows),len(out),len(new)))
import collections
print('確度分布:',dict(collections.Counter(r['confidence'] for r in out)))
