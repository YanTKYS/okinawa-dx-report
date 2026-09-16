# 出典一覧・一次資料URL対応表

調査時点：人員データ 2024年4月1日（総務省）／DX推進度 2026年9月15日
最終更新：2026年9月16日

> **アクセス状況の変化について**
> 初版（2026-09-15）作成時は実行環境のネットワーク制約により一次資料を1件も取得できなかった。
> その後3回のDeep Researchにより一次資料へのアクセス経路が確立し、
> 現在 `evidence.csv` には確度A・Bの根拠が35件記録されている。
> 本文書の §2 は当時の制約の記録として残しているが、**現在のステータスではない。**
> ただし本レポート更新作業を行った環境でも総務省ドメインへは到達できず、
> 那覇市・宜野湾市・浦添市の総務省広義人員は未取得のまま残っている（§4 参照）。

---

## 1. 本調査における出典の取扱い

- 出典の優先順位は [`methodology.md` §4](methodology.md) に定義
- データ1件ごとの出典・確度・検証状態は [`../data/evidence.csv`](../data/evidence.csv) に記録（56件）
- 2026-09-16時点で **確度A：33件、確度B：2件、確度C：56件、不明：4件**（計95件）
- 確度A・Bのみを採点・相関分析に投入している（methodology §5）

---

## 2. アクセス制約ログ（初版2026-09-15時点の記録・現在のステータスではない）

### 2.1 発生した制約

本調査を実施した実行環境では、ネットワーク egress ポリシーにより
**自治体・官公庁ドメインへのHTTPSアクセスがすべて遮断された。**

```
gateway answered 403 to CONNECT (policy denial or upstream failure)
```

### 2.2 遮断が確認されたドメイン

| ドメイン | 用途 | 結果 |
|---|---|---|
| www.city.naha.okinawa.jp | 那覇市公式 | 403 遮断 |
| www.city.ginowan.lg.jp | 宜野湾市公式 | 403 遮断 |
| www.city.ishigaki.okinawa.jp | 石垣市公式 | 403 遮断 |
| www.city.urasoe.lg.jp | 浦添市公式 | 403 遮断 |
| www.city.nago.okinawa.jp | 名護市公式 | 403 遮断 |
| www.city.itoman.lg.jp | 糸満市公式 | 403 遮断 |
| www.city.okinawa.okinawa.jp | 沖縄市公式 | 403 遮断 |
| www.city.tomigusuku.lg.jp | 豊見城市公式 | 403 遮断 |
| www.city.uruma.lg.jp | うるま市公式 | 403 遮断 |
| www.city.miyakojima.lg.jp | 宮古島市公式 | 403 遮断 |
| www.city.nanjo.okinawa.jp | 南城市公式 | 403 遮断 |
| www.pref.okinawa.jp / www.pref.okinawa.lg.jp | 沖縄県公式 | 403 遮断 |
| www.soumu.go.jp | 総務省 | 403 遮断 |
| www.digital.go.jp | デジタル庁 | 403 遮断 |
| www.e-stat.go.jp | 政府統計の総合窓口 | 403 遮断 |
| www1.g-reiki.net | 例規集（うるま市・那覇市等） | 403 遮断 |
| web.archive.org | アーカイブ（代替手段） | 403 遮断 |
| ja.wikipedia.org | 参考（代替手段） | 403 遮断 |

**対象11市の公式サイトすべて、および優先順位1〜8のすべての情報源が取得不能であった。**

### 2.3 利用可能であった手段と、その限界

利用できたのは検索エンジンのAPIのみであり、返却されるのは
**検索結果のURL一覧と、スニペットから自動生成された要約**である。

[`methodology.md` §4](methodology.md) の定めにより、これらは**値の根拠として採用できない**。

この原則が実務上必要であることは、本調査中に実際に確認された。

| 事象 | 内容 |
|---|---|
| 年度の誤変換 | 検索結果の自動要約が「令和7年度」を "fiscal year 2026" と記述。正しくは2025年度。組織改編の時期判定を誤らせる誤りである |
| 部署名の不一致 | 「沖縄市 情報政策課」で検索した結果、実際には「DX戦略室 DX推進課」が該当と示された。旧称・改組の可能性があり、どの時点の組織かを要約からは判別できない |
| 人口の二重提示 | 同一の要約内で国勢調査値と月次推計値が併記され、基準日の異なる数値が混在した |

### 2.4 職員数データについて（最重要項目）

本調査の**最重要項目であるDX担当職員数は、検索経由では1市も取得できなかった。**

検索結果は一貫して「部署の存在は確認できるが、職員数・人員構成は公開検索結果に含まれない」旨を返した。
職員数が記載される資料（給与・定員管理等の公表資料、行政機構図、職員配置表、当初予算説明資料）は
いずれも上記の遮断ドメイン上のPDF・Excelであり、取得できていない。

**推測による補完は行っていない。** すべて `不明` として記録した。

### 2.5 再実行時の手当て

egress ポリシーで以下のドメインを許可すれば、本調査は設計どおり実行可能である。

```
*.city.naha.okinawa.jp      *.city.ginowan.lg.jp      *.city.ishigaki.okinawa.jp
*.city.urasoe.lg.jp         *.city.nago.okinawa.jp    *.city.itoman.lg.jp
*.city.okinawa.okinawa.jp   *.city.tomigusuku.lg.jp   *.city.uruma.lg.jp
*.city.miyakojima.lg.jp     *.city.nanjo.okinawa.jp
*.pref.okinawa.jp           *.pref.okinawa.lg.jp
*.soumu.go.jp               *.digital.go.jp           *.e-stat.go.jp
*.g-reiki.net
```

---

## 3. 一次資料URL対応表

以下は検索により**所在を特定できた**一次資料である。いずれも未取得（確度C）。
調査を完了させる際は、この一覧を起点に原資料を確認すること。

### 3.1 共通（人口・職員数・財政・県の支援）

| 項目 | 資料名 | 公開主体 | URL |
|---|---|---|---|
| 市町村一覧 | 市町村一覧 | 沖縄県 | https://www.pref.okinawa.jp/kensei/shinko/1016703/1016705/1016773/1022609/1016816.html |
| 人口（確定値） | 令和7年国勢調査速報 沖縄県の人口と世帯数（令和8年5月29日） | 沖縄県企画部統計課 | https://www.pref.okinawa.lg.jp/toukeika/pc/2025/R07sokuhou.pdf |
| 人口（月次推計） | 沖縄県推計人口 | 沖縄県企画部統計課 | https://www.pref.okinawa.jp/toukeika/estimates/2025/pop202512.pdf |
| 職員総数 | 市町村職員数の状況 | 沖縄県 | https://www.pref.okinawa.lg.jp/kensei/shinko/1016703/1016705/1016773/1022612/1016807.html |
| 職員総数（全国統一基準） | 地方公共団体定員管理関係データ（令和6年） | 総務省 | https://www.soumu.go.jp/main_sosiki/jichi_gyousei/c-gyousei/teiin/251225data.html |
| 財政規模 | 市町村行財政概況（第67集）令和6年3月 | 沖縄県 | https://www.pref.okinawa.lg.jp/kensei/shinko/1016703/1016705/1016767/1027027/1029992.html |
| 給与・定員 | 市町村別給与等の状況 | 沖縄県 | https://www.pref.okinawa.jp/kensei/shinko/1016703/1016705/1016773/1022612/1016811.html |
| 県の支援事業 | 沖縄県DX人材確保育成市町村支援事業 | 沖縄県 | https://www.pref.okinawa.lg.jp/machizukuri/johoif/1013564/1013572.html |
| 県・市町村連携 | 沖縄県・市町村DX推進連絡会 | 沖縄県 | https://www.pref.okinawa.lg.jp/machizukuri/johoif/1013564/1013571.html |
| CIO補佐官制度 | 自治体DXの推進／デジタル人材の確保・育成 | 総務省 | https://www.soumu.go.jp/denshijiti/dejitarujinzai.html |

**注**：人口は国勢調査値と月次推計値のいずれかに統一すること（混在禁止）。
職員総数は県資料と総務省定員管理調査で定義が異なりうるため、総務省の普通会計職員数に統一する。

### 3.2 市別

#### 那覇市
| 種別 | 資料名 | URL |
|---|---|---|
| 組織 | DX推進室 | https://www.city.naha.okinawa.jp/soshiki/0002/00020001/000200010006/index.html |
| 組織 | 情報政策課 | https://www.city.naha.okinawa.jp/admin/cityhall/sosiki/sosiki/bukyoku/kikakuzaimubu/jseisaku.html |
| 組織機構図 | 組織機構図 | https://www.city.naha.okinawa.jp/admin/administration/sosikikouseizu/sosikikikouzu.html |
| 定員 | 那覇市の給与・定員管理等の公表 | https://www.city.naha.okinawa.jp/admin/kansa/kyuuyoteiinkouhyou/kyuyoteiinkanri.html |
| 計画 | 那覇市DX推進計画 | https://www.city.naha.okinawa.jp/admin/kaikaku/digital/naha_dxplan.html |
| 施策 | DXの推進 | https://www.city.naha.okinawa.jp/admin/kaikaku/digital/index.html |
| 施策 | 令和7年度 AI・RPAを活用した業務の自動化推進事業 公募 | https://www.city.naha.okinawa.jp/admin/kaikaku/digital/2025_RPA.html |
| 外部人材 | 地域情報化アドバイザー登録者情報（総務省） | https://www.soumu.go.jp/main_content/001017678.pdf |

#### 宜野湾市
| 種別 | 資料名 | URL |
|---|---|---|
| 組織 | デジタル推進課 | https://www.city.ginowan.lg.jp/soshiki/kikaku/digitalsuishin/index.html |
| 組織機構図 | 宜野湾市行政組織図一覧 | https://www.city.ginowan.lg.jp/shisei/shokai/3/4798.html |
| 計画 | 宜野湾市DX推進計画（基本計画・実施計画） | https://www.city.ginowan.lg.jp/soshiki/kikaku/digitalsuishin/2/1/1/14257.html |
| 参考 | 持続可能な『まちづくり』に向けたDX推進計画に関する調査研究（地方自治研究機構・令和5年3月） | https://www.rilg.or.jp/htdocs/uploads/protect/R4_chousa/R4_10.pdf |

#### 石垣市
| 種別 | 資料名 | URL |
|---|---|---|
| 組織 | DX推進課 | https://www.city.ishigaki.okinawa.jp/soshiki/dx/index.html |
| 組織 | DXに関すること | https://www.city.ishigaki.okinawa.jp/soshiki/dx/dx/index.html |
| 事務分掌 | 各部署の業務内容と直通電話番号 | https://www.city.ishigaki.okinawa.jp/soshiki/dx/4/7947.html |
| 計画 | 石垣市デジタル化推進計画（令和4年4月・企画部DX課） | https://www.city.ishigaki.okinawa.jp/material/files/group/1/dx_plan.pdf |

#### 浦添市
| 種別 | 資料名 | URL |
|---|---|---|
| 組織 | 情報政策課 | https://www.city.urasoe.lg.jp/soshiki/kikakubu/johoseisakuka/ |
| 組織 | 行政改革推進課 | https://www.city.urasoe.lg.jp/soshiki/kikakubu/gyoseikaikakusuishinka/ |
| 組織 | デジタルシティ推進室 | https://www.city.urasoe.lg.jp/doc/60d1978664667334e2f67f08/ |
| 組織一覧 | 組織一覧 | https://www.city.urasoe.lg.jp/doc/609e71013d59ae2434bfd949/ |
| 計画 | 浦添市DX推進計画 基本構想（令和7年4月1日） | https://www.city.urasoe.lg.jp/doc/2025061100078/file_contents/file_20256264162226_1.pdf |
| 関連計画 | 浦添市官民データ活用推進計画 | https://www.city.urasoe.lg.jp/doc/62302e247d0bc36f4609b94b/ |
| 人材 | 浦添市地域DX人材育成講座 | https://sites.google.com/agiledx.community/urasoedx/ |

#### 名護市
| 種別 | 資料名 | URL |
|---|---|---|
| 組織 | 情報政策課 | https://www.city.nago.okinawa.jp/soshiki/kikaku/jouhouseisaku/more.html |
| 組織 | 業務改善推進室 | https://www.city.nago.okinawa.jp/soshiki/soumubu/gyoumukaizensuishin/ |
| 組織一覧 | 組織一覧 | https://www.city.nago.okinawa.jp/soshiki/ |
| 計画 | 名護市DX推進計画（令和5年3月） | https://www.city.nago.okinawa.jp/articles/2023042400025/file_contents/DXsuishin.pdf |
| 計画 | 名護市自治体DX推進計画の策定について | https://www.city.nago.okinawa.jp/articles/2023042400025/ |
| 委託 | 名護市DX推進計画策定支援業務仕様書 | https://www.city.nago.okinawa.jp/articles/2022051100018/file_contents/shiyousho_Ver_20220516.pdf |

#### 糸満市
| 種別 | 資料名 | URL |
|---|---|---|
| 組織 | 情報政策課 | https://www.city.itoman.lg.jp/soshiki/8/ |
| 事務分掌 | 糸満市の行政組織図・事務分掌 | https://www.city.itoman.lg.jp/soshiki/7/2205.html |
| 組織機構図 | 糸満市行政機構図（令和4年度） | https://www.city.itoman.lg.jp/uploaded/attachment/5588.pdf |
| 方針 | 糸満市ＤＸ推進方針 | https://www.city.itoman.lg.jp/soshiki/8/22449.html |

#### 沖縄市
| 種別 | 資料名 | URL |
|---|---|---|
| 組織 | DX戦略室 DX推進課 | https://www.city.okinawa.okinawa.jp/k010-004/contents/p00005.html |
| 組織 | 情報システム課 | https://www.city.okinawa.okinawa.jp/k013/shiseijouhou/gaiyou/soshikiannai/organize/965/970.html |
| 組織一覧 | 組織一覧 | https://www.city.okinawa.okinawa.jp/k010-003/shiseijouhou/gaiyou/soshikiannai/organize/index.html |
| 計画 | 沖縄市DX推進計画の概要（2022〜2026年度） | https://www.city.okinawa.okinawa.jp/documents/16478/dxsuishinkeikakugaiyou.pdf |
| データ | 沖縄市データポータルサイト | https://www.city.okinawa.okinawa.jp/k010-004/contents/p00014.html |

#### 豊見城市
| 種別 | 資料名 | URL |
|---|---|---|
| 組織 | デジタル推進課 | https://www.city.tomigusuku.lg.jp/soshiki/1/1007/index.html |
| 方針 | 「豊見城市デジタルファースト宣言」について | https://www.city.tomigusuku.lg.jp/soshiki/1/1007/gyomuannai/8/1/1/780.html |

#### うるま市
| 種別 | 資料名 | URL |
|---|---|---|
| 組織 | DX推進課 | https://www.city.uruma.lg.jp/1002004000/contents/2309.html |
| 組織一覧 | 各課のご案内 | https://www.city.uruma.lg.jp/1001004000/contents/863.html |
| 推進本部 | うるま市DX推進本部設置要綱 | https://www1.g-reiki.net/uruma/reiki_honbun/r170RG00002011.html |
| 計画 | 地域情報化計画について | https://www.city.uruma.lg.jp/1002004000/contents/1813.html |
| 方針 | 「デジタル田園都市国家構想」に関するDXの推進について | https://www.city.uruma.lg.jp/documents/675/siryou3dxnosuisinnnituite.pdf |

#### 宮古島市
| 種別 | 資料名 | URL |
|---|---|---|
| 組織 | 情報政策課 | https://www.city.miyakojima.lg.jp/soshiki/shityo/kikaku/jyouhou/ |
| 組織 | 企画政策部 | https://www.city.miyakojima.lg.jp/soshiki/shityo/kikaku/ |
| データ | 宮古島市オープンデータ | https://www.city.miyakojima.lg.jp/soshiki/shityo/kikaku/jyouhou/2023-01_opendata.html |

#### 南城市
| 種別 | 資料名 | URL |
|---|---|---|
| 組織 | 《令和4年4月より》DX推進課の新設、企画部内の体制について | https://www.city.nanjo.okinawa.jp/shisei/gyoukaku/1648425409/1648424956/ |
| 組織一覧 | 組織一覧 | http://www.city.nanjo.okinawa.jp/shisei/post/ |
| 計画 | 南城市DX推進計画 | https://www.city.nanjo.okinawa.jp/userfiles/files/dxsuishinkeikaku.pdf |
| 計画 | 南城市DX推進計画（ページ） | https://www.city.nanjo.okinawa.jp/shisei/keikaku/kakusyu/jouhou/1688637124/ |
| 関連計画 | 第３次情報化基本計画 | https://www.city.nanjo.okinawa.jp/shisei/keikaku/kakusyu/jouhou/jouhou3/ |

---

## 4. 出典の網羅性について

上表は**検索により所在を特定できた資料に限られる**。
以下は所在すら特定できておらず、調査完了時には別途探索が必要である。

- 各市の**当初予算書・主要事業説明資料**（情報システム関係委託料＝交絡要因5の確認に必須）
- 各市の**議会会議録**（人員体制に関する答弁は職員数の有力な情報源となることが多い）
- 各市の**最新の行政機構図**（糸満市は令和4年度版のみ所在特定。他市は年度不明）
- 各市の**給与・定員管理等の公表資料**（那覇市以外は所在未特定）
- 豊見城市・宮古島市・うるま市の**DX推進計画そのもの**（宣言・情報化計画は特定したが、
  自治体DX推進計画に相当する文書の有無が未確認）


---

## 6. 主要な一次資料（2026-09-16 時点で確認済み）

### 6.1 総務省 共通指標（主分析の説明変数）

| 項目 | 内容 |
|---|---|
| 資料名 | 令和6年度 自治体DX・情報化推進概要 個別資料<br>`【R06個別資料】（１）自治体DXの推進体制等（市区町村）.xlsx` |
| 公開主体 | 総務省自治行政局行政経営支援室 |
| URL | https://www.soumu.go.jp/main_content/001048599.zip |
| 本文・定義 | https://www.soumu.go.jp/main_content/001048571.pdf |
| 基準日 | 2024年4月1日 |
| 該当シート | `1_組織体制（８）` DX推進担当課室・情報政策担当課室の職員数 |

| 市 | Excel行 | 値 | 状態 |
|---|---:|---:|---|
| 那覇市 | 1753（推定） | — | **未取得** |
| 宜野湾市 | 1754（推定） | — | **未取得** |
| 石垣市 | 1755 | 5人 | 確度A |
| 浦添市 | 1756（推定） | — | **未取得** |
| 名護市 | 1757 | 14人 | 確度A |
| 糸満市 | 1758 | 6人 | 確度A |
| 沖縄市 | 1759 | 13人 | 確度A |
| 豊見城市 | 1760 | 8人 | 確度A |
| うるま市 | 1761 | 10人 | 確度A |
| 宮古島市 | 1762 | 8人 | 確度A |
| 南城市 | 1763 | 6人 | 確度A |

行番号は確認済み8市が団体コード順に連続していることから、未取得3市の位置を特定したもの。
**値の推測は行っていない。**

石垣市の「CIO、CIO補佐官、CISO以外の外部デジタル人材 3人」は同資料 `1_組織体制（４）` による（確度A）。

### 6.2 自治体公表組織図（狭義の職務別人数）

| 市 | 資料名 | URL | 確認内容 |
|---|---|---|---|
| 那覇市 | 令和8年度那覇市組織図 | https://www.city.naha.okinawa.jp/_res/projects/default_project/_page_/001/003/945/soshikizu.pdf | 企画調整課32／DX推進室8／情報政策課23（情報化推進G8・業務管理G8・標準化G5） |
| 宜野湾市 | 令和7年度宜野湾市行政組織図 | https://www.city.ginowan.lg.jp/material/files/group/7/r7ginowansisosikizu.pdf | デジタル推進課11（デジタル推進係4・システム管理係6）／行政経営室5（行政改革推進班4） |
| 浦添市 | 令和8年度浦添市行政機構図（人数あり） | https://www.city.urasoe.lg.jp/doc/609e70973d59ae2434bfd8c2/file_contents/file_20266291134315_1.pdf | 行政改革推進課5（行政改革推進係4）／情報政策課10（情報政策係9） |

### 6.3 人数記載が「無い」ことを確認した資料（未調査と区別する）

| 市 | 資料名 | URL |
|---|---|---|
| 石垣市 | 令和8年度一般会計予算 | https://www.city.ishigaki.okinawa.jp/material/files/group/4/R8d_ippan_yosan.pdf |
| 沖縄市 | 令和8年度沖縄市組織図 | https://www.city.okinawa.okinawa.jp/documents/1742/r08soshikizu.pdf |
| 豊見城市 | 令和8年度豊見城市行政機構 | https://www.city.tomigusuku.lg.jp/material/files/group/4/R80401-gyouseikikou.pdf |
| 宮古島市 | 令和8年度宮古島市行政機構図 | https://www.city.miyakojima.lg.jp/soshiki/files/R8kikouzu.pdf |
| 南城市 | 南城市組織図 | https://www.city.nanjo.okinawa.jp/userfiles/files/R6soshiki_1.pdf |

これらは本文を確認したうえで課・係別の人数記載が無いことを確認したものであり、**未調査ではない**。
過年度版からの転用・推計は行っていない。

### 6.4 採点根拠となった一次資料

DX推進度の採点に用いた資料は [`../data/scoring_results.csv`](../data/scoring_results.csv) の
`source_title` / `source_url` / `evidence` / `note` 列に1項目単位で記録している。
確度A・Bの根拠がある項目のみ採点しており、採点した141項目はすべてURLと判定理由を伴う。

同じ内容は [`../data/evidence.csv`](../data/evidence.csv) に `S001`〜 の evidence_id で統合済みである
（141件）。`note` 列には「原資料の記載内容」と「ルーブリック条件への当てはめ理由」を併記している。

**Deep Research 本文の得点候補は採用していない。** 第5回Deep Researchには配点超過の候補が複数あり
（`I-3`=6／満点5、`III-2`=6／満点5、`II-3`=6／満点5、`VI-1`=5／満点4、`I-4`=4／満点条件を満たすのに過小）、
採用したのは事実・証拠・URL・原資料の記載内容・確度・年度・状態のみである。
点数は `data/scoring_rubric.csv` の条件に当てはめ直して付与している。

### 6.5 Deep Research 生記録

| ファイル | 内容 |
|---|---|
| [`../data/deep-research-20260915.md`](../data/deep-research-20260915.md) | 第1回：組織構造を全11市で確定、人数記載文書の所在特定 |
| [`../data/deep-research-20260916-1.md`](../data/deep-research-20260916-1.md) | 第2回：那覇市・宜野湾市・浦添市の職務別人数を組織図から確定 |
| [`../data/deep-research-20260916-2.md`](../data/deep-research-20260916-2.md) | 第3回：総務省共通指標で8市の広義人員を確定 |
| [`../data/deep-research-20260916-3.md`](../data/deep-research-20260916-3.md) | 第4回：総務省横断データで `II-1`（電子申請基盤）・`III-1`（電子決裁）を11市分確定 |
| [`../data/deep-research-20260916-4.md`](../data/deep-research-20260916-4.md) | 第5回：`I-1`〜`VI-3` の広域補完。**※ファイルが末尾（E章の圧縮CSV）で途切れており、11市中9市分の項目別根拠が届いていない** |

### 6.6 第5回Deep Researchで参照された横断データ（2026-09-16 統合）

| 資料 | 公開主体 | 年度・時点 | 対応項目 | URL |
|---|---|---|---|---|
| 自治体DXの推進体制等（市区町村）個別データ | 総務省 | 2024年度・2024-04-01 | `I-1` `I-3` `I-4` `V-1` `V-2` `V-3` | https://www.soumu.go.jp/main_content/001048599.zip |
| 自治体フロントヤード改革取組状況等（市区町村） | 総務省 | 2024年度・2024-04-01 | `II-3` | 同上ZIP |
| 行政サービスの向上・高度化（市区町村） | 総務省 | 2024年度・2024-04-01 | `II-1` `II-4` `III-1` `VI-2` | 同上ZIP |
| 個別データ掲載元ページ | 総務省 | — | — | https://www.soumu.go.jp/denshijiti/060213_02.html |
| 地方公共団体オープンデータ取組済自治体一覧 | デジタル庁 | 2026-06-30 | `VI-3` | https://www.digital.go.jp/resources/open_data |
| マイナンバーカード活用事例一覧 | デジタル庁 | 2024-04-02 | `II-3` `VI-2` | https://www.digital.go.jp/resources/open_data |
| コンビニ交付提供市区町村 | J-LIS | 2026-04-01 | `VI-2` | https://www.lg-waps.go.jp/01-04.html |

**`VI-2` について：** 第5回Deep Researchは「9市でコンビニ交付等を確認」と件数のみを報告し、
どの9市かを列挙していない。件数から自治体を推測することはできないため、
名指しで確認できたうるま市・南城市の2市のみを確定し、残り9市は**未確認**としている。
J-LIS一覧を直接参照して11市分を確定することが、次フェーズの優先作業の一つである。

### 6.7 本作業環境のアクセス制約（2026-09-16）

本統合作業の環境ではネットワークポリシーにより自治体・省庁ドメインへの外部接続が遮断されている
（`www.soumu.go.jp` への CONNECT が 403）。このため次の項目は**今回取得できず、推測で埋めていない**。

| 未取得の項目 | 所在（判明済み） |
|---|---|
| 那覇市・宜野湾市・浦添市の `dx_info_staff` | 総務省個別資料 Excel 1753／1754／1756行 |
| 11市共通定義の人口 | 沖縄県推計人口／国勢調査 |
| 11市共通定義の普通会計職員数 | 総務省 地方公共団体定員管理関係データ |
| `VI-2` の11市別判定 | J-LIS コンビニ交付提供市区町村一覧 |
