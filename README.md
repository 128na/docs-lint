# docs-lint

「ドキュメントは不変記録・台帳・生きた文書（allowlist制）の3種類に限定する」という
最小化ドキュメント統治モデルの機械検証ツール。依存ゼロ（Node 標準モジュールのみ）。

設計思想の全体像は [E:\chore\template_repo](../../chore/template_repo)（`docs/README.md`、
`docs/migration.md`、`docs/adr/*.md`）を参照。このリポジトリは、そのテンプレートが
定義する `tools/docs-lint.mjs` を独立パッケージとして切り出したもの——同じスクリプトを
7リポジトリにコピーして保守した結果、修正が各リポジトリで独立に再発見・再実装される
という重複管理の問題が実際に発生したため（2026-08-25、日付検証のタイムゾーン境界バグが
3リポジトリで別々に踏まれた）。

## 導入方法

各リポジトリの `package.json` に devDependency として追加する:

```json
{
  "devDependencies": {
    "docs-lint": "github:128na/docs-lint#v1.0.0"
  },
  "scripts": {
    "docs": "docs-lint"
  }
}
```

`npm install` 後、リポジトリルートで `npm run docs`（または直接 `npx docs-lint`）を実行する。
既定では `tools/docs-policy.json` を設定として読む。別の場所に置きたい場合は
`docs-lint path/to/policy.json` のように引数で指定する。

`tools/docs-policy.json` の書き方は [chore/template_repo/docs/README.md](../../chore/template_repo/docs/README.md)
の「生きた文書」節、および各リポジトリの実例（`docs/adr/` に採用理由のADRがあるはず）を参照。

## パッケージ構成

- `bin/docs-lint.mjs` — CLI エントリポイント。`repoRoot` は実行時のカレントディレクトリを使うため、
  `node_modules` 配下にインストールされていても正しく動く。
- `lib/lint.mjs` — 判定ロジック本体。`process.exit`/`console` に依存しない純粋関数
  `lint(repoRoot, policy, opts?)` としてエクスポートされており、CLIからもテストからも同じロジックを呼ぶ。
- `test/` — `node --test` で実行するユニットテスト。フィクスチャ（一時ディレクトリ）に対して
  `lint()` を直接呼ぶ形式で、サブプロセス起動なしに高速に検証する。

## CI連携（利用側リポジトリ）

```yaml
# .github/workflows/docs-lint.yml
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

## テストについて

現在のテスト（`test/lint.test.mjs`）は market-data リポジトリでの assurance-audit 監査
（2026-08-25）で「中核判定ロジックが一度もテストされていない」と指摘された分岐のうち、
優先度の高いものから順次実装している。全分岐を一度に網羅する必要はなく、追加のミューテーション
テストや新しい分岐のテストは気づいたときに追記していく方針。
