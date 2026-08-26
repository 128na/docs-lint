// 起点となるテスト群。market-data リポジトリでの assurance-audit 監査
// （2026-08-25）で「docs-lint.mjs 自身の中核判定ロジックが一度もテストされて
// いない」と指摘された分岐のうち、優先度の高いものから着手する。
// 「順次実装」の方針のため、全分岐を一度に網羅する必要はない。
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { lint } from "../lib/lint.mjs";

function makeRepo(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "docs-lint-test-"));
  for (const [relPath, content] of Object.entries(files)) {
    const abs = path.join(root, relPath);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, "utf8");
  }
  return root;
}

const basePolicy = () => ({
  scanRoots: { recursive: ["docs"], flat: ["."] },
  livingDocs: ["README.md"],
  ledgers: [],
  recordDirs: ["docs/records"],
  adrDir: "docs/adr",
  templateDir: "docs/templates",
  forbiddenFileNames: ["INDEX.md", "index.md", "TODO.md"],
  forbiddenDirNames: ["temp", "tmp", "draft", "wip"],
  dependencyDebtHeader: "| Package | Current | Target | Blocker | Type | Revisit condition | Recorded |",
  dependencyDebtTypes: ["temporary", "infra", "behavior-change"],
});

test("unclassified md is reported as an error (allowlist core enforcement)", () => {
  const root = makeRepo({
    "README.md": "# hi\n",
    "docs/random-note.md": "# not in any allowlist/record/adr/ledger dir\n",
  });
  const { errors } = lint(root, basePolicy());
  assert.ok(
    errors.some((e) => e.includes("docs/random-note.md") && e.includes("分類できない")),
    `expected an unclassified-md error, got: ${JSON.stringify(errors)}`,
  );
});

test("a correctly classified record produces no error", () => {
  const root = makeRepo({
    "README.md": "# hi\n",
    "docs/records/2026-01-01_something.md": "# a record\n",
  });
  const { errors } = lint(root, basePolicy());
  assert.deepEqual(errors, []);
});

test("duplicate ADR numbers are detected", () => {
  const adrBody = "# ADR: x\n\n> ステータス: Accepted (2026-01-01)\n";
  const root = makeRepo({
    "README.md": "# hi\n",
    "docs/adr/0001-first.md": adrBody,
    "docs/adr/0001-second.md": adrBody,
  });
  const { errors } = lint(root, basePolicy());
  assert.ok(
    errors.some((e) => e.includes("ADR 番号 0001 が重複")),
    `expected a duplicate-ADR-number error, got: ${JSON.stringify(errors)}`,
  );
});

test("adrStatusPattern policy override accepts a pre-existing ADR's wording variants (auto-trade case)", () => {
  // 実例: auto-trade は移行前から存在した実装済みADRを git mv のみでリネームし、
  // 本文（太字表記 `**ステータス**:` を含む）は書き換えない方針にした（ADR-0004）。
  // 既定の厳格パターンのままだとこれが「ステータス行なし」として誤検出されるため、
  // policy.adrStatusPattern で表記ゆれを許容できる。
  const root = makeRepo({
    "README.md": "# hi\n",
    "docs/adr/0002-preexisting.md": "# ADR: x\n\n> **ステータス**: Accepted (2026-06-06)\n",
  });
  const policy = basePolicy();
  const { errors: strict } = lint(root, policy);
  assert.ok(
    strict.some((e) => e.includes("ステータス行が必要")),
    "既定の厳格パターンでは太字表記が検出漏れとして拒否されるはず",
  );
  policy.adrStatusPattern = "^> \\*{0,2}(?:ステータス|Status)\\*{0,2}:\\s";
  const { errors: relaxed } = lint(root, policy);
  assert.deepEqual(relaxed, [], `expected no errors with adrStatusPattern override, got: ${JSON.stringify(relaxed)}`);
});

test("an ADR missing the status line is rejected", () => {
  const root = makeRepo({
    "README.md": "# hi\n",
    "docs/adr/0001-no-status.md": "# ADR: x\n\nno status line here\n",
  });
  const { errors } = lint(root, basePolicy());
  assert.ok(
    errors.some((e) => e.includes("ステータス行が必要")),
    `expected a missing-status-line error, got: ${JSON.stringify(errors)}`,
  );
});

test("a record dated more than 1 day past UTC today is rejected as future-dated", () => {
  const root = makeRepo({
    "README.md": "# hi\n",
    "docs/records/2999-01-01_far-future.md": "# far future\n",
  });
  const { errors } = lint(root, basePolicy());
  assert.ok(
    errors.some((e) => e.includes("未来の日付です")),
    `expected a future-date error, got: ${JSON.stringify(errors)}`,
  );
});

test("a record dated 'tomorrow' relative to UTC is NOT flagged (timezone-skew tolerance)", () => {
  // このテストの意図: 開発機(JST等UTC+)のローカル日付と、CI(通常UTC)のローカル日付が
  // 最大1日ズレることを許容する設計を固定する回帰テスト。過去に一度、この許容の
  // 実装方向を間違えて逆方向のタイムゾーン境界バグを作り込んだ実績があるため。
  const now = new Date("2026-06-15T20:00:00Z"); // UTC 20時 = JSTでは既に翌日05時
  const tomorrowUtc = "2026-06-16"; // JSTのローカル日付相当
  const root = makeRepo({
    "README.md": "# hi\n",
    [`docs/records/${tomorrowUtc}_jst-local-today.md`]: "# jst today\n",
  });
  const { errors } = lint(root, basePolicy(), { now });
  assert.deepEqual(errors, []);
});

test("record with an invalid calendar date (Feb 30) is rejected", () => {
  const root = makeRepo({
    "README.md": "# hi\n",
    "docs/records/2026-02-30_impossible.md": "# impossible date\n",
  });
  const { errors } = lint(root, basePolicy());
  assert.ok(
    errors.some((e) => e.includes("実在しない日付です")),
    `expected an invalid-date error, got: ${JSON.stringify(errors)}`,
  );
});

test("record with a bad filename (no date prefix) is rejected", () => {
  const root = makeRepo({
    "README.md": "# hi\n",
    "docs/records/BadName.md": "# bad name\n",
  });
  const { errors } = lint(root, basePolicy());
  assert.ok(
    errors.some((e) => e.includes("records の命名は")),
    `expected a bad-record-name error, got: ${JSON.stringify(errors)}`,
  );
});

test("forbidden directory names (temp/tmp/draft/wip) are rejected", () => {
  const root = makeRepo({
    "README.md": "# hi\n",
    "docs/temp/scratch.md": "# scratch\n",
  });
  const { errors } = lint(root, basePolicy());
  assert.ok(
    errors.some((e) => e.includes("禁止されたディレクトリ名") && e.includes("temp")),
    `expected a forbidden-dir error, got: ${JSON.stringify(errors)}`,
  );
});

test("forbidden file names (INDEX.md, TODO.md) are rejected", () => {
  const root = makeRepo({
    "README.md": "# hi\n",
    "docs/INDEX.md": "# index\n",
  });
  const { errors } = lint(root, basePolicy());
  assert.ok(
    errors.some((e) => e.includes("禁止されたファイル名")),
    `expected a forbidden-filename error, got: ${JSON.stringify(errors)}`,
  );
});

test("a broken relative link is reported", () => {
  const root = makeRepo({
    "README.md": "[dead link](docs/nowhere.md)\n",
  });
  const { errors } = lint(root, basePolicy());
  assert.ok(
    errors.some((e) => e.includes("リンク切れ: docs/nowhere.md")),
    `expected a broken-link error, got: ${JSON.stringify(errors)}`,
  );
});

test("a link target containing a space is still checked (regression: used to be silently skipped)", () => {
  const root = makeRepo({
    "README.md": "[dead link with space](docs/no where.md)\n",
  });
  const { errors } = lint(root, basePolicy());
  assert.ok(
    errors.some((e) => e.includes("リンク切れ") && e.includes("no where.md")),
    `expected the space-containing link to be checked, got: ${JSON.stringify(errors)}`,
  );
});

test("a protocol-relative URL (//host/path) is not treated as a broken local link", () => {
  const root = makeRepo({
    "README.md": "[protocol-relative](//example.com/path)\n",
  });
  const { errors } = lint(root, basePolicy());
  assert.deepEqual(errors, []);
});

test("an absolute path link outside the repo is rejected", () => {
  const root = makeRepo({
    "README.md": "[abs](~/secret.md)\n",
  });
  const { errors } = lint(root, basePolicy());
  assert.ok(
    errors.some((e) => e.includes("絶対パスリンクは禁止")),
    `expected an absolute-path-link error, got: ${JSON.stringify(errors)}`,
  );
});

test("dependency-debt.md with a wrong header is rejected (dependabot-maintenance compat)", () => {
  const root = makeRepo({
    "README.md": "# hi\n",
    "docs/dependency-debt.md": "# deps\n\n| Package | Current |\n|---|---|\n",
  });
  const policy = basePolicy();
  policy.ledgers = ["docs/dependency-debt.md"];
  const { errors } = lint(root, policy);
  assert.ok(
    errors.some((e) => e.includes("ヘッダ行が規定と一致しません")),
    `expected a bad-ledger-header error, got: ${JSON.stringify(errors)}`,
  );
});

test("dependency-debt.md with an invalid Type value is rejected", () => {
  const header = "| Package | Current | Target | Blocker | Type | Revisit condition | Recorded |";
  const root = makeRepo({
    "README.md": "# hi\n",
    "docs/dependency-debt.md": `# deps\n\n${header}\n|---|---|---|---|---|---|---|\n| foo | 1.0 | 2.0 | x | nonsense-type | later | 2026-01-01 |\n`,
  });
  const policy = basePolicy();
  policy.ledgers = ["docs/dependency-debt.md"];
  const { errors } = lint(root, policy);
  assert.ok(
    errors.some((e) => e.includes("Type「nonsense-type」は不正")),
    `expected a bad-type error, got: ${JSON.stringify(errors)}`,
  );
});

test("duplicate CD- numbers in consistency-debt.md are rejected", () => {
  const root = makeRepo({
    "README.md": "# hi\n",
    "docs/consistency-debt.md": "# consistency\n\n| CD-01 | a |\n| CD-01 | b |\n",
  });
  const policy = basePolicy();
  policy.ledgers = ["docs/consistency-debt.md"];
  const { errors } = lint(root, policy);
  assert.ok(
    errors.some((e) => e.includes("CD-01 が重複")),
    `expected a duplicate-CD-number error, got: ${JSON.stringify(errors)}`,
  );
});

test("living-doc path staleness check also covers ledgers, not just livingDocs (auto-trade regression case)", () => {
  // 実例: auto-trade で known_risks.md を living→ledger へ分類変更した際、この検査から
  // 外れて既存の壊れた参照が無監視になった実績がある。living/ledger 両方を対象にする。
  const policy = basePolicy();
  policy.ledgers = ["docs/known-risks.md"];
  const root = makeRepo({
    "README.md": "# hi\n",
    "docs/known-risks.md": "参照: `scripts/does_not_exist.py`\n",
  });
  const { warns } = lint(root, policy);
  assert.ok(
    warns.some((w) => w.includes("scripts/does_not_exist.py")),
    `expected a stale-path warning on the ledger file, got: ${JSON.stringify(warns)}`,
  );
});

test("a clean repo with no violations produces zero errors", () => {
  const root = makeRepo({
    "README.md": "# hi\n",
    "docs/adr/0001-first.md": "# ADR: x\n\n> ステータス: Accepted (2026-01-01)\n",
    "docs/records/2026-01-01_note.md": "# a note\n",
  });
  const { errors, filesScanned } = lint(root, basePolicy());
  assert.deepEqual(errors, []);
  assert.equal(filesScanned, 3);
});
