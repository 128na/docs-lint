#!/usr/bin/env node
/* eslint-disable no-console */
/* eslint-disable no-undef */
// docs-lint CLI: ドキュメント規約（不変記録/台帳/生きた文書allowlist）の機械検証。
// コアロジックは lib/lint.mjs（純粋関数、process.exit/console 非依存）。
// 使い方: docs-lint [policy.jsonへのパス]   （リポジトリルートで実行。既定は tools/docs-policy.json）
//         exit 0 = green / 1 = error あり
import fs from "node:fs";
import path from "node:path";
import { lint } from "../lib/lint.mjs";

// repoRoot は「実行時のカレントディレクトリ」を使う（このスクリプト自身の設置場所には
// 依存しない）。npm パッケージとして node_modules 配下にインストールされても、
// リポジトリのルートから `docs-lint` / `npx docs-lint` として呼ばれる前提のため。
const repoRoot = process.cwd();
const policyPath = path.resolve(repoRoot, process.argv[2] || "tools/docs-policy.json");
const policy = JSON.parse(fs.readFileSync(policyPath, "utf8"));

const { errors, warns, filesScanned } = lint(repoRoot, policy);

for (const line of errors) console.error(line);
for (const line of warns) console.log(line);
console.log(`docs-lint: ${filesScanned} files scanned, ${errors.length} error(s), ${warns.length} warning(s)`);
process.exit(errors.length > 0 ? 1 : 0);
