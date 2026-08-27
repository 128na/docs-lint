#!/usr/bin/env node
/* eslint-disable no-console */
/* eslint-disable no-undef */
// docs-lint CLI: ドキュメント規約（不変記録/台帳/生きた文書allowlist）の機械検証と雛形生成。
// コアロジックは lib/lint.mjs・lib/init.mjs（いずれも process.exit/console 非依存の純粋関数）。
// 使い方:
//   docs-lint [policy.jsonへのパス]   ドキュメント規約を検証する（既定は tools/docs-policy.json）
//                                     exit 0 = green / 1 = error あり
//   docs-lint init new                空リポジトリへ最小化ドキュメント統治モデルの雛形を生成する
//   docs-lint init existing           現存する docs/ 構成を baseline allowlist 登録した上で雛形を生成する
import fs from "node:fs";
import path from "node:path";
import { lint } from "../lib/lint.mjs";
import { init } from "../lib/init.mjs";

const repoRoot = process.cwd();

if (process.argv[2] === "init") {
  const mode = process.argv[3];
  if (mode !== "new" && mode !== "existing") {
    console.error("使い方: docs-lint init <new|existing>");
    console.error("  new      空リポジトリへ最小化ドキュメント統治モデルの雛形を生成する");
    console.error("  existing 現存する docs/ 構成を baseline allowlist 登録した上で雛形を生成する");
    process.exit(1);
  }
  const { results, nextSteps } = init(repoRoot, mode);
  for (const r of results) {
    console.log(`${r.action === "create" ? "作成" : "スキップ（既存）"}: ${r.path}`);
  }
  console.log("");
  console.log("次のステップ:");
  for (const step of nextSteps) console.log(`- ${step}`);
  process.exit(0);
}

const policyPath = path.resolve(repoRoot, process.argv[2] || "tools/docs-policy.json");
const policy = JSON.parse(fs.readFileSync(policyPath, "utf8"));

const { errors, warns, filesScanned } = lint(repoRoot, policy);

for (const line of errors) console.error(line);
for (const line of warns) console.log(line);
console.log(`docs-lint: ${filesScanned} files scanned, ${errors.length} error(s), ${warns.length} warning(s)`);
process.exit(errors.length > 0 ? 1 : 0);
