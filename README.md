# iphone-Case — iPhone 12 Pro ケース × Symbea flower

[Symbea flower](https://github.com/Symbealab/Symbea-flower) の花を背面に凹みで刻印した iPhone 12 Pro のケースを、
ブラウザで調整して STL に書き出すツール。Bambu Lab A1 mini・PLA（Bambu PLA Matte）・0.4 mm ノズル・スムース PEI 向け。

- ページ：`case/index.html`（`/case/`）
- 設計メモ：[`case/DESIGN.md`](case/DESIGN.md)。寸法は Apple「iPhone 12 Pro Dimensional Drawings」（2020-10-16）から
- [order-chaos-stl](https://github.com/Symbealab/order-chaos-stl) の `js/pipeline.js`・`vendor/`・画面の部品を流用（`case/` を order-chaos-stl に入れてもそのまま動く配置）

## 使い方

1. ローカルで開く（Worker と WASM を使うので、ファイルを直接ではなくサーバーで開く）

   ```sh
   python3 -m http.server 8000
   # → http://localhost:8000/case/
   ```

2. 右のパネルの「作るもの」を選ぶ
   - **フィット試験**：上端から 42 mm を切り出した試験片。カメラ穴・角・ふち・消音側の開口の始まりを含む。
     隙間（0.15 / 0.20 / 0.25）と長さを選んで「STL を保存」、または「3 個まとめて保存」で 3 個を 1 枚に並べた STL
   - **刻印試験**：40 mm 角・厚み 2.7 mm の板に、本番と同じ大きさ（外径 48 mm）の花の中央 34 mm 角を刻印。
     「6 枚まとめて保存」で 深さ 0.4 / 0.6 / 0.8 × しきい値 0.06 / 0.09 の 6 枚を 3 × 2 に並べた STL（上面の点の数が番号 1〜6）
   - **本番**：ケース全体（刻印入り）
3. 花を選ぶ：12 桁のシードと花の番号（Symbea Flower の 3 × 3 の左上から 1〜9）を入れて「この花で作る」。
   URL でも指定できる：`case/?seed=342717359454&flower=7&preset=case`
4. 調整すると自動で作り直す。2D タブは背面から見た図（カメラは左上）。刻印がカメラ穴・外周に 4 mm より近いと警告して削る

## パラメータ

| 名前 | 既定値 | 意味 |
|---|---|---|
| 隙間 | 0.20 mm | 本体との隙間（フィット試験で決める） |
| 壁 | 1.4 mm | 側壁の厚み。PLA がたわんで着脱できる厚み（試験で 1.2–1.6） |
| 背面板 | 2.7 mm | レンズ面（背面ガラスから 1.72）より 0.98 外側。MagSafe 推奨の 2.1 以下は満たさない |
| ふち | 0.8 mm | 前面のふちの巻き込み。下面は本体の丸い縁に接する 45° の面（サポートなし）。先端は前面ガラスから 0.44 mm 上、ふちの上面は 1.24 mm 上 |
| 下部 | 壁あり | 壁あり（角も含む）／角だけ残す（正面から見て左端から 13.3–58.3 を開ける）／全開放（下端から 18 mm の壁をなくす） |
| 側面の開口 | 開ける | 消音・音量側（正面から左）上端から 21.1–61.0、電源側（正面から右）35.4–57.2。底は背面ガラスから 1.2 mm、角は R1.5 |
| カメラ穴 | — | 台座（背面図で長辺・上端から 2.12–35.44 × 2.12–37.62、R7）+ 0.5 mm、外側の縁を 45° × 1.0 mm 面取り |
| 外径・位置・回転 | 48 mm・上端から 88 mm・0° | 花の大きさ・中心（幅方向は中央）・回転 |
| しきい値 | 0.07 | 周りより濃い筋（線）がこれ以上なら刻印する。下げると線が太く・多く |
| 線の抽出 | 1.0 mm | 周りの平均をとる半径。花の濃い筋だけを取り出す（ハイパス）。小さいほど細かい筋 |
| 線の太さ | 0.32 mm | 線を太らせる半径。溝の最小幅 0.6 mm を確保 |
| ぼかし | 0.25 mm | 点のばらつきで線が途切れないようにぼかす量 |
| 深さ | 0.6 mm | 刻印の深さ。背面板 2.7 なら刻印部でも 2.1 残る |

残る島（刻印に囲まれた部分）は幅 0.8 mm 以上にする（クロージング半径 0.4 mm）。
刻印は、背面から見て Symbea Flower の画像と同じ向きになるよう、STL では左右反転して置いている。

## 仕組み

```
シード・花番号・変化
  └─ case/js/symbea-core.js … Symbea Flower と同じ写像・探索・9 種の花・層の写し方 → 密度場
       └─ js/pipeline.js … トーン → ハイパス → しきい値・太らせ → 島の除去 → 輪郭（marching squares + Douglas–Peucker）
            └─ case/js/case-geom.js（manifold-3d）
                 外殻（断面を重ねて hull）− 空洞 − ふちの開口 − 側面・下部の開口 − カメラ穴 − 刻印
                   └─ three.js プレビュー → STL
```

- `case/js/symbea-core.js` … [Symbea-flower](https://github.com/Symbealab/Symbea-flower) の `docs/js/symbea.js` から DOM を切り離して移植
- `case/js/case-geom.js` … 寸法・形・刻印（ブラウザ・Node 共通）
- `case/js/case-worker.js` … 重い計算を UI と別スレッドで（module Worker）
- `case/js/case-app.js` / `case/index.html` / `case/css/case.css` … 画面（共通の見た目は `css/style.css`）
- `js/pipeline.js` … order-chaos-stl と同じ。ケース用に `keepAll`（離れた島も残す）・`highpass`・`contourRings` を追加（コースターの結果は変わらない）
- `vendor/` … three.js r128（MIT）、earcut 2.2.4（ISC）、manifold-3d 3.5.4（Apache-2.0、`vendor/manifold/LICENSE`）。CDN には頼らない

座標は mm、z が上、z = 0 がベッド面（ケースの背面の外側）。STL を上から見ると、正面から見た iPhone と同じ向き。

## Node でのテスト

```sh
node tools/test-case.mjs out            # 試験片・本番の STL を out/ に書き出して確認（約 2 分）
node tools/test-case.mjs out --quick    # 花の点を減らして速く
node tools/compare-symbea.js ../Symbea-flower/docs 342717359454   # Symbea Flower のサイトと同じ花になるか（Playwright）
```

`test-case.mjs` が書き出すもの（Bambu Studio でそのまま開ける）

| ファイル | 内容 |
|---|---|
| `fit_clr0.15.stl` / `fit_clr0.20.stl` / `fit_clr0.25.stl` | フィット試験片（上端 42 mm） |
| `fit_all.stl` | 上の 3 個を縦に並べたもの（上から 0.15 / 0.20 / 0.25） |
| `engrave_1_d0.4_t0.06.stl` … `engrave_6_d0.8_t0.09.stl` | 刻印試験片（番号 = 上面の点の数） |
| `engrave_all.stl` | 上の 6 枚を 3 × 2 に並べたもの（上段 しきい値 0.06、下段 0.09、左から深さ 0.4 / 0.6 / 0.8） |
| `case_full.stl` | 本番（刻印入り） |

確かめていること：閉じた形状（全辺が 2 回・逆向き、manifold の状態）、A1 mini の 180 mm 角に収まる、
空洞の幅・長さ（本体 + 2 × 隙間）、壁・背面板の厚み、ふちの開口の幅、ふちの下面が 45° 以上、空洞が本体を含む、
側面の開口の範囲、カメラ穴の位置・面取り、刻印がカメラ穴・外周から 4 mm 以上、刻印の深さ、溝 ≥ 0.6 mm・島 ≥ 0.8 mm。

## 印刷のめやす（Bambu Lab A1 mini・PLA・スムース PEI）

印刷の向きは STL のまま（背面がベッド面）。サポートなし。

| 場所 | 設定 | 理由 |
|---|---|---|
| プロファイル | 0.12mm Fine | ふちの 45° の面・丸みの段差が細かくなる。ふちがだれるときは 0.08 mm |
| 品質 → 壁ジェネレータ | Arachne | 1.4 mm の壁・細い線を幅の違う線で埋める |
| 品質 → エレファントフット補正 | 0.1〜0.15 mm | ベッド面に掘った刻印の 1 層目がつぶれて埋まらないように |
| 強度 → 壁ループ | 3 | 薄い壁がほぼ実体になり、たわんでも割れにくい |
| プレート | スムース PEI | 背面（ベッド面）がつやのある面になり、刻印の凹みがはっきり見える。テクスチャ PEI だとざらっとした質感 |
| その他 → ブリム | なし（はがれるときだけ外側 3 mm） | ベッド面が製品の外側になるので |

試作の段取り：フィット試験（入れやすさ・ガタ・カメラ穴の位置）→ 刻印試験（線のつぶれ・見え方）→ 結果を既定値に → 本番。
