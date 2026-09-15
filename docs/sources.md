# 出典一覧・アクセス制約ログ

調査時点：2026年9月15日（令和8年9月15日）
確認日：すべて2026-09-15

---

## 1. 本調査における出典の取扱い

- 出典の優先順位は [`methodology.md` §4](methodology.md) に定義
- データ1件ごとの出典・確度・検証状態は [`../data/evidence.csv`](../data/evidence.csv) に記録（56件）
- **本調査時点で確度A（一次資料を直接確認）のデータは0件である**
- 全56件が確度C（間接的情報のみ）・`未検証（ドメイン遮断）`

---

## 2. ⚠️ アクセス制約ログ（重要）

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
