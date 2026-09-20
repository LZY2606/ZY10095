# Pair-wise GSB — キーボード/支援技術セマンティクス比較ワークベンチ

2 つのローカルビルド（基线 / 候选）に同じキーボード操作列を適用し、
**操作可能な経路と意味的状態**の観点で最も早い分岐を特定し、証拠付きで判断を残すためのワークベンチです。

ライブブラウザを観測しません。入力はすべて「保存されたスナップショット」
（DOM スナップショット、アクセシビリティツリー、フォーカスイベント、キー操作列、live region 通知）であり、
レポートは保存入力と規則バージョンの純関数です。

## 起動

```bash
npm install
npm test -- --run
npm run dev -- --host 127.0.0.1 --port 5220 --strictPort
```

ページは固定で <http://127.0.0.1:5220> です。API は同一 Vite dev サーバの `/api/*` で動きます（別プロセス不要）。

- 画面の「サンプルデータを読み込む」を押すと、同梱の組み立て済みバッチがサーバへ保存され、分岐が表示されます。
- 手元の JSON（バッチ、または過去のエクスポートパッケージ）はファイル選択で試算できます（試算のみで、サーバには保存されません）。

## 不変量（守られるべき性質）

1. **決定論（determinism）**
   - 同一の保存入力・規則バージョンからは常に同一の出力が得られます。オブジェクトキーの挿入順、配列の列挙順、現在時刻、タイムゾーンのいずれにも依存しません。
   - エンジンはシステム時計を読みません。時刻が必要な場合は入力側が `createdAt` / イベントの `at` / `exportedAt` として明示的に渡します。
   - 永続化とエクスポートにはキー順を正規化した canonical JSON を使い、内容指纹は SHA-256（依存のない内部実装）で求めます。`test/engine.test.ts`・`test/hash.test.ts`・`test/export.test.ts` がこの性質を検証します。
2. **ノードの同一性は「安定証拠」で判断（CSS パスではない）**
   - 証拠は `data-gsb-id` 等の安定 ID、ARIA role、アクセシブル名前、祖先コンテキスト（名前付き役割の LCS）、意味的属性シグネチャ、shadow 境界の有無を重み付けしたスコアです。
   - 信頼度は `exact` / `high` / `medium`、閾値未満は**強引に対応付けしません**。要素の再マウントや shadow root 越しの移動でも証拠が揃えば対応付き、揃わなければ「追加」「消失」として残ります。
   - `class`、インライン `style`、色は一致スコアにも分岐判定にも使いません。**色の変化は結論ではなく**、操作経路と意味的状態だけが扱われます。
3. **分岐は種別ごとに再生可能な証拠を持つ**
   - フォーカス移動先の相違、Tab 到達可能集合の増減、role/名前/ARIA 状態の相違に加え、
     **フォーカストラップ**（連続 Tab でのフォーカス経路 + 当時の Tab 順序）、
     **到達不能ポップアップ**（可視インターバル全体でフォーカスが一度も入らない証拠）、
     **live region の重複通知**（同一フレーム内・内容変化のない連続フレーム）を検出します。
4. **除外（豁免）は範囲に束縛され、自動で失効する**
   - 「意図的」と宣言すると、role、アクセシブル名前、祖先コンテキスト、対象フレーム、分岐種別、**ビルド指紋**を束縛したスコープが発行されます。
   - ノードの移動・改名・祖先の変化、またはビルド指紋の変化があると再計算で `invalid-subject` / `invalid-fingerprint` になります。
5. **人間の判断は追記専用（append-only）**
   - 分類イベントは操作者・理由・前後バージョン（seq）を持ちます。撤销は元イベントを消さず `undo` イベントを追加し、失効扱いにします。
   - 2 人の研究者が同じ分岐を異なる分類にした場合は**競合（conflict）**として返し、どちらかを上書きしません。
6. **失敗したバッチは部分結果を晒さない**
   - 入力検証に失敗したリクエストは永続化されません。保存は一時ファイルへの完全シリアライズ後に rename する原子書きで、途中失敗でも `.tmp` 以外の可視ファイルは残りません（`test/storage.test.ts`）。
7. **オフライン再生の順序不変**
   - エクスポートパッケージには元のツリー・操作列・一致マッピング・判断イベント・入力/レポートのチェックサムが含まれます。保存入力から再計算したレポートは、分岐の並び順まで含めて元と一致します。

## 入力形式

```jsonc
{
  "schemaVersion": "1",
  "operations": [{ "type": "Tab", "label": "次へ" }],
  "baseline": {
    "id": "build-base", "label": "基线", "fingerprint": "commit-a",
    "frames": [
      // フレーム数は operations.length + 1。frame[0] が初期状態、frame[k] は operation[k-1] の直後。
      {
        "index": 0,
        "dom": { "id": "root", "tag": "div", "attrs": {}, "children": [] },
        "ax": [{ "id": "ax-1", "domId": "root", "role": "generic", "name": "", "states": {} }],
        "focus": { "from": "id-a", "to": "id-b" },   // frame[0] では省略可
        "announcements": [{ "regionId": "status", "text": "更新しました", "polite": true }]
      }
    ]
  },
  "candidate": { "...": "同構造（id は baseline と別の値）" }
}
```

- `operations[].type`: `Tab` / `ShiftTab` / `Enter` / `Space` / `ArrowDown|Up|Left|Right` / `Escape`
- DOM ノード: `id`（フレーム内一意）、`tag`、`attrs`（`data-gsb-id` 等の安定属性を強く推奨）、`text`、`children`、`shadowHost`
- AX ノード: `id`、`domId`（DOM への参照）、`role`、`name`、`states`（`disabled/hidden/focused/selected/checked/expanded/pressed/readonly/required/visible/modal/live/tabindex/labelledby`）
- AX を省略した要素はタグ・属性から role/名前/状態が導出されます（`button`→button、見出し、`aria-*`、`alt`、`<label for>` 等）。
- 検証ルール: フレーム数・ID 重複・`domId`/focus の参照先・操作種別・2 ビルドの id 衝突。違反は 422 でまとめて返ります。

## API

| メソッド | パス | 内容 |
| --- | --- | --- |
| POST | `/api/batches` | バッチ入力を検証・計算して保存（同一入力は同じ batchId で再利用） |
| GET | `/api/batches` | バッチ一覧 |
| GET | `/api/batches/:id` | 入力・レポート・判断イベントの完全取得 |
| POST | `/api/batches/:id/decisions` | 分類 (`defect`/`intentional`/`noise`) または撤销 (`undo`) を追記 |
| GET | `/api/batches/:id/decisions` | 分岐ごとの集約状態（競合・除外スコープ・履歴） |
| POST | `/api/batches/:id/exemptions/revalidate` | 保存済み除外を現在のレポートで再評価 |
| GET | `/api/batches/:id/export` | オフライン再生用完全パッケージ（チェックサム付き） |
| POST | `/api/batches/replay` | 保存せず再計算だけ行う（オフライン検証用） |

データの保存先は `GSB_DATA_DIR` で変更できます（未設定時は OS の一時ディレクトリ配下）。

## 検出される分岐

| 種別 | 意味 | 主な証拠 |
| --- | --- | --- |
| `focus-destination` | 同じ操作でフォーカス到達先が異なる / 期待される Tab 順序を飛び越す | 期待・観測ノード、当時の Tab 順序 |
| `reachable-set` | キーボード到達可能なノードの追加・消失（一致できなかったもの） | 当該フレームの Tab 順序 |
| `semantic-state` | 対応付いた操作可能ノードの role/名前/ARIA 状態の差 | 対応ペアと状態 diff（色・class・style は除外） |
| `focus-trap` | レイヤー内にフォーカスが環回し、外に到達可能ノードが残る | 3 フレームのフォーカス経路＋ Tab 順序 |
| `unreachable-popover` | ポップアップが可視なのに到達可能項目がない／一度も入れない | 可視インターバル全体のフォーカス経路 |
| `duplicate-announcement` | live region が内容変化なしに同じ通知を繰り返す | 通知テキストと region、フレーム範囲 |

## テストデータの意味

`test/sample-data/sample.ts`（生成物: `public/sample-batch.json`、再生成は `npm run generate-sample`）は、
10 フレーム・9 操作のスクリプト付きデータで、候補ビルドには意図的に差し込まれた以下の典型ケースが含まれます。

- **通知ボタンの追加**と**「閉じる」メニュー項目の消失**（安定 ID マッチングと到達可能集合の差）
- 候補の **header が shadow host** に変更（CSS パスではなく安定証拠での一致を確認）
- メニュー項目が 2 個になり Tab が先頭へ環回する**フォーカストラップ**
- 開いたメニューと同時に現れる、到達項目を持たない **`role="popover"` のヒント**（到達不能ポップアップ）
- 更新後に **live region が同じ文を 2 回通知**する重複放送
- 「更新」ボタンの **`aria-pressed` の差**（意味的状態として検出）。同時にボタンの**背景色だけが変化**しており、これは分岐として現れません
- 最初の Tab でフォーカスが別のボタンへ行く**フォーカス移動先の分岐**

テストは `npm test -- --run` で全件実行されます。ファイル構成:

- `src/core/` — 入力型、導出（DOM/AX 展開・Tab 順序）、マッチング、分岐、判断、エクスポート、入力検証（ブラウザ非依存の純関数）
- `src/server/` — Vite dev サーバに載る JSON API と原子ストレージ
- `src/web/` — ワークベンチ画面（タイムライン再生・一致表・判断・競合・除外失効・エクスポート検証）
- `test/` — Vitest。決定論、マッチング、Tab/モーダル/shadow、各分岐、除外失効、競合、撤销、原子書き、HTTP API、エクスポート検証

## 既知の前提

- このワークベンチは**保存スナップショットのセマンティクス再構成**を扱います。実ブラウザのクローラやリアルタイム計測は含みません。
- Tab 順序は DOM 順序＋ `tabindex`（正は値順、0 は DOM 順）、ARIA 無効/非表示の継承、開いているモーダルレイヤーによるスコープ制限でモデル化しています。
- レイヤーを開く操作直後の Tab は、トリガーの `aria-controls` が指す開レイヤーの最初の到達可能項目へ入るというモデルを採用しています（保存された観測フォーカスと照合されます）。
