import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { init } from "../lib/init.mjs";
import { lint } from "../lib/lint.mjs";

function makeRepo(files = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "docs-lint-init-test-"));
  for (const [relPath, content] of Object.entries(files)) {
    const abs = path.join(root, relPath);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, "utf8");
  }
  return root;
}

test("init rejects an invalid mode", () => {
  const root = makeRepo();
  assert.throws(() => init(root, "bogus"), /mode must be "new" or "existing"/);
});

test("init new scaffolds a repo that is immediately lint-green", () => {
  const root = makeRepo({ "README.md": "# hi\n" });
  const { results } = init(root, "new");
  assert.ok(results.every((r) => r.action === "create"));

  const policy = JSON.parse(fs.readFileSync(path.join(root, "tools/docs-policy.json"), "utf8"));
  const { errors } = lint(root, policy);
  assert.deepEqual(errors, []);
});

test("init new creates all the expected scaffold files", () => {
  const root = makeRepo();
  const { results } = init(root, "new");
  const created = results.filter((r) => r.action === "create").map((r) => r.path);
  for (const expected of [
    "docs/README.md",
    "docs/templates/adr.md",
    "docs/templates/record.md",
    "docs/templates/postmortem.md",
    "docs/records/.gitkeep",
    "docs/dependency-debt.md",
    "tools/docs-policy.json",
    ".github/workflows/docs-lint.yml",
  ]) {
    assert.ok(created.includes(expected), `expected ${expected} to be created, got: ${JSON.stringify(created)}`);
  }
  assert.ok(fs.existsSync(path.join(root, "docs/adr")), "docs/adr directory should exist");
});

test("init is idempotent: re-running skips files that already exist instead of overwriting them", () => {
  const root = makeRepo();
  init(root, "new");
  // 生成された docs/README.md を手で書き換えてから再実行し、上書きされないことを確認する
  const readmePath = path.join(root, "docs/README.md");
  fs.writeFileSync(readmePath, "# my customized readme\n", "utf8");

  const { results } = init(root, "new");
  const readmeResult = results.find((r) => r.path === "docs/README.md");
  assert.equal(readmeResult.action, "skip");
  assert.equal(fs.readFileSync(readmePath, "utf8"), "# my customized readme\n");
});

test("init existing registers all pre-existing markdown as a livingDocs baseline", () => {
  const root = makeRepo({
    "README.md": "# hi\n",
    "docs/knowledge/old-note.md": "# old knowledge doc\n",
    "docs/spec/api-spec.md": "# api spec\n",
  });
  const { results } = init(root, "existing");
  assert.ok(results.every((r) => r.action === "create"));

  const policy = JSON.parse(fs.readFileSync(path.join(root, "tools/docs-policy.json"), "utf8"));
  assert.ok(policy.livingDocs.includes("README.md"));
  assert.ok(policy.livingDocs.includes("docs/knowledge/old-note.md"));
  assert.ok(policy.livingDocs.includes("docs/spec/api-spec.md"));
  assert.ok(policy.livingDocs.includes("docs/README.md"));

  const { errors } = lint(root, policy);
  assert.deepEqual(errors, [], "baseline registration should make the pre-existing repo lint-green immediately");
});

test("init existing still flags a pre-existing forbidden directory (temp/) even though its file is baseline-registered", () => {
  // temp/ 相当のディレクトリはbaseline登録の対象外(禁止ディレクトリ名検査は常に有効)。
  // これにより「Phase 0を通しただけでは temp/ の滞留を見過ごせない」設計を固定する。
  const root = makeRepo({
    "README.md": "# hi\n",
    "docs/temp/scratch.md": "# scratch\n",
  });
  init(root, "existing");
  const policy = JSON.parse(fs.readFileSync(path.join(root, "tools/docs-policy.json"), "utf8"));
  const { errors } = lint(root, policy);
  assert.ok(
    errors.some((e) => e.includes("禁止されたディレクトリ名") && e.includes("temp")),
    `expected the forbidden temp/ directory to still be flagged, got: ${JSON.stringify(errors)}`,
  );
});

test("init existing does not register docs/dependency-debt.md itself or docs/README.md redundantly into livingDocs as a duplicate of the ledger", () => {
  const root = makeRepo({
    "README.md": "# hi\n",
    "docs/dependency-debt.md": "# deps\n\n| Package | Current | Target | Blocker | Type | Revisit condition | Recorded |\n",
  });
  const { results } = init(root, "existing");
  // dependency-debt.md はテンプレ側の既定を使うため既存ファイルはそのまま「スキップ」扱い
  const depDebtResult = results.find((r) => r.path === "docs/dependency-debt.md");
  assert.equal(depDebtResult.action, "skip");

  const policy = JSON.parse(fs.readFileSync(path.join(root, "tools/docs-policy.json"), "utf8"));
  assert.ok(!policy.livingDocs.includes("docs/dependency-debt.md"));
  assert.ok(policy.ledgers.includes("docs/dependency-debt.md"));

  const { errors } = lint(root, policy);
  assert.deepEqual(errors, []);
});
