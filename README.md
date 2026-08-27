# docs-lint

「ドキュメントは不変記録・台帳・生きた文書（allowlist制）の3種類に限定する」という
最小化ドキュメント統治モデルの、機械検証ツール兼雛形生成ツール。依存ゼロ（Node 標準
モジュールのみ）。

もともとは `E:\chore\template_repo` というテンプレートリポジトリの一部
（`tools/docs-lint.mjs`）だったが、同じスクリプトを7リポジトリにコピーして保守した結果、
修正が各リポジトリで独立に再発見・再実装される重複管理の問題が実際に発生したため
（2026-08-25、日付検証のタイムゾーン境界バグが3リポジトリで別々に踏まれた）、独立パッケージ
として切り出した。以後、「新規/既存リポジトリへの雛形生成」も lint と同じパッケージが担う
（`init` サブコマンド）ことで、template_repo 相当の別リポジトリを維持する必要をなくした。

## セットアップ（新規・既存リポジトリ共通の入口）

```bash
npx --yes -p "github:128na/docs-lint#v1.1.0" docs-lint init new       # 空リポジトリへフルscaffold
npx --yes -p "github:128na/docs-lint#v1.1.0" docs-lint init existing  # 現存する docs/ を持つリポジトリへ適用
```

- **`init new`**: `docs/README.md`・`docs/adr/`・`docs/records/`・`docs/templates/`・
  `docs/dependency-debt.md`（空の台帳）・`tools/docs-policy.json`・
  `.github/workflows/docs-lint.yml` を生成する。プロジェクトの複雑さによらず骨格は
  同一（7リポジトリへの実地適用で、必要だったのはこの一組の骨格だけで、違いは中身の量
  だけだった）。既に存在するファイルは上書きしない（スキップする）。
- **`init existing`**: 上記に加え、`docs/` 配下（再帰）とリポジトリルート直下の既存 md を
  スキャンし、`tools/docs-policy.json` の `livingDocs` へ**一旦すべてベースライン登録**する
  （Phase 0 方式）。これにより導入直後から `npx docs-lint` が green になり、そこから
  段階的に縮小していく（`init` 実行時に出力される次のステップの案内を参照）。
- どちらのモードも **`CLAUDE.md`/`AGENTS.md`/`README.md` はこのコマンドで作成・変更しない**
  （Laravel Boost 生成ブロック等、既存ファイルの構造を壊すリスクがあるため）。既存ファイルが
  あれば、コマンド実行後に出力される案内に従い、ドキュメント規約への参照を手動で追加する。

新規/既存の判断に迷うようなら「まっさらな空リポジトリなら new、docs/ に何か既にあるなら
existing」でよい。複数のプリセット（Laravel向け・Python向け等）は提供しない —
実際に7リポジトリへ適用した結果、必要になった骨格は言語・フレームワークによらず単一だった
ため（YAGNI）。

## 通常の導入方法（npmプロジェクト）

`init` 実行後、`package.json` に devDependency として追加する:

```json
{
  "devDependencies": {
    "docs-lint": "github:128na/docs-lint#v1.1.0"
  },
  "scripts": {
    "docs": "docs-lint"
  }
}
```

`npm install` 後、リポジトリルートで `npm run docs`（または直接 `npx docs-lint`）を実行する。
既定では `tools/docs-policy.json` を設定として読む。別の場所に置きたい場合は
`docs-lint path/to/policy.json` のように引数で指定する。npm プロジェクトでない場合は
`init` が生成する `.github/workflows/docs-lint.yml` のコメントにある通り、
`npx --yes -p "github:128na/docs-lint#v1.1.0" docs-lint` の形でそのまま呼び出せる。

## パッケージ構成

- `bin/docs-lint.mjs` — CLI エントリポイント。`repoRoot` は実行時のカレントディレクトリを使うため、
  `node_modules` 配下にインストールされていても正しく動く。`init <new|existing>` を
  サブコマンドとして受け付ける。
- `lib/lint.mjs` — 検証ロジック本体。`process.exit`/`console` に依存しない純粋関数
  `lint(repoRoot, policy, opts?)` としてエクスポートされており、CLIからもテストからも同じロジックを呼ぶ。
- `lib/init.mjs` — 雛形生成ロジック本体。同様に純粋関数 `init(repoRoot, mode)` としてエクスポート。
- `templates/` — `init` が配置するファイルの実体（`.md`/`.yml`）。JS文字列リテラルではなく
  実ファイルとして持つことで、内容のレビュー・差分確認をしやすくしている。
- `test/` — `node --test` で実行するユニットテスト。フィクスチャ（一時ディレクトリ）に対して
  `lint()`/`init()` を直接呼ぶ形式で、サブプロセス起動なしに高速に検証する。

## CI連携（利用側リポジトリ）

```yaml
# .github/workflows/docs-lint.yml（npmプロジェクトの場合）
- uses: actions/checkout@<sha> # 各リポジトリの既存の固定慣習に合わせる
- uses: actions/setup-node@<sha>
  with:
    node-version: "22"
- run: npm ci
- run: npx docs-lint
```

新しいワークフローファイルを追加する際は、そのリポジトリの他のワークフローが
アクションを SHA 固定しているかを必ず確認し、揃えること（フローティングタグ `@v4` を
1つだけ野放しにしない）。

## リポジトリの公開設定について

このリポジトリは public である必要がある。private のままだと、npm/npx の `github:` 形式の
依存解決に使われる GitHub Actions の既定 `GITHUB_TOKEN` は実行中のリポジトリ自身にしか
スコープが効かず、別リポジトリ（同一オーナーの private リポジトリでも）を `git clone` できずに
CI が失敗する（2026-08-26、7リポジトリへの展開時に実際に発生し、public化で解決した）。

## テストについて

`test/lint.test.mjs` は market-data リポジトリでの assurance-audit 監査（2026-08-25）で
「中核判定ロジックが一度もテストされていない」と指摘された分岐のうち、優先度の高いものから
順次実装している。全分岐を一度に網羅する必要はなく、追加のミューテーションテストや新しい
分岐のテストは気づいたときに追記していく方針。`test/init.test.mjs` は `init` 導入時の
起点テスト。
