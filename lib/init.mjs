// docs-lint init: 最小化ドキュメント統治モデルの雛形を生成する。
// 「新規（空リポジトリへのフルscaffold）」と「既存（現存する現在形mdをbaselineとして
// allowlist登録した上でscaffold）」の二択のみ提供する。プロジェクトの複雑さに応じた
// 複数プリセットは、実際にそれが必要になった実例が出てから追加する方針（YAGNI）。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const templatesDir = path.join(packageRoot, "templates");

const SKIP_DIRS = new Set([".git", "node_modules", ".github", ".claude", ".idea", ".vscode"]);

/** docs/ 配下（再帰）+ ルート直下（非再帰）の .md を列挙する。existing モードの baseline 登録用。 */
function scanExistingMarkdown(repoRoot) {
  const found = [];
  const docsDir = path.join(repoRoot, "docs");
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        walk(path.join(dir, entry.name));
      } else if (entry.name.endsWith(".md")) {
        found.push(path.relative(repoRoot, path.join(dir, entry.name)).replaceAll("\\", "/"));
      }
    }
  }
  if (fs.existsSync(docsDir)) walk(docsDir);
  for (const entry of fs.readdirSync(repoRoot, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith(".md")) {
      found.push(entry.name);
    }
  }
  return found.sort();
}

function buildPolicy(mode, existingMdFiles) {
  const base = {
    scanRoots: { recursive: ["docs"], flat: ["."] },
    ledgers: ["docs/dependency-debt.md"],
    recordDirs: ["docs/records"],
    adrDir: "docs/adr",
    templateDir: "docs/templates",
    forbiddenFileNames: ["INDEX.md", "index.md", "TODO.md"],
    forbiddenDirNames: ["temp", "tmp", "draft", "wip"],
    dependencyDebtHeader: "| Package | Current | Target | Blocker | Type | Revisit condition | Recorded |",
    dependencyDebtTypes: ["temporary", "infra", "behavior-change"],
  };
  if (mode === "existing") {
    // Phase 0 ベースライン方式: 現存する現在形 md を一旦すべて living として登録し、
    // まず lint green を達成してから段階的に縮小する（docs-lint の README 参照）。
    const livingDocs = existingMdFiles.filter(
      (f) => f !== "docs/dependency-debt.md" && f !== "docs/README.md",
    );
    livingDocs.push("docs/README.md");
    return {
      $comment:
        "Phase 0 ベースライン（docs-lint init existing で生成）。現存する現在形 md を" +
        "一旦すべて livingDocs へ登録した状態。段階的に records/ADR/台帳へ再分類し、" +
        "本当に「常に最新であるべき」ものだけが living として残るよう縮小していく。",
      ...base,
      livingDocs,
    };
  }
  // README.md/CLAUDE.md/AGENTS.md は init がこの後で作成・変更しないファイルだが、
  // 存在すればほぼ確実に allowlist 対象になるため既定値として含めておく。
  return {
    $comment: "docs-lint init new で生成。",
    ...base,
    livingDocs: ["README.md", "CLAUDE.md", "AGENTS.md", "docs/README.md"],
  };
}

function writeIfAbsent(absPath, content) {
  if (fs.existsSync(absPath)) {
    return { path: absPath, action: "skip" };
  }
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, content, "utf8");
  return { path: absPath, action: "create" };
}

/**
 * @param {string} repoRoot
 * @param {"new"|"existing"} mode
 * @returns {{ results: {path: string, action: "create"|"skip"}[], nextSteps: string[] }}
 */
export function init(repoRoot, mode) {
  if (mode !== "new" && mode !== "existing") {
    throw new Error(`mode must be "new" or "existing" (got: ${mode})`);
  }

  const results = [];
  const rel = (p) => path.relative(repoRoot, p).replaceAll("\\", "/");

  const existingMdFiles = mode === "existing" ? scanExistingMarkdown(repoRoot) : [];

  results.push(writeIfAbsent(path.join(repoRoot, "docs/README.md"), fs.readFileSync(path.join(templatesDir, "docs-README.md"), "utf8")));
  results.push(writeIfAbsent(path.join(repoRoot, "docs/templates/adr.md"), fs.readFileSync(path.join(templatesDir, "adr.md"), "utf8")));
  results.push(writeIfAbsent(path.join(repoRoot, "docs/templates/record.md"), fs.readFileSync(path.join(templatesDir, "record.md"), "utf8")));
  results.push(writeIfAbsent(path.join(repoRoot, "docs/templates/postmortem.md"), fs.readFileSync(path.join(templatesDir, "postmortem.md"), "utf8")));
  results.push(writeIfAbsent(path.join(repoRoot, "docs/records/.gitkeep"), ""));
  results.push(writeIfAbsent(path.join(repoRoot, "docs/dependency-debt.md"), fs.readFileSync(path.join(templatesDir, "dependency-debt.md"), "utf8")));
  results.push(writeIfAbsent(path.join(repoRoot, "tools/docs-policy.json"), JSON.stringify(buildPolicy(mode, existingMdFiles), null, 2) + "\n"));
  results.push(writeIfAbsent(path.join(repoRoot, ".github/workflows/docs-lint.yml"), fs.readFileSync(path.join(templatesDir, "workflow-docs-lint.yml"), "utf8")));
  // docs/adr/ はディレクトリだけ用意する（最初の意思決定が生まれるまで空でよい）
  fs.mkdirSync(path.join(repoRoot, "docs/adr"), { recursive: true });

  const nextSteps = [];
  if (mode === "existing") {
    nextSteps.push(
      `${existingMdFiles.length} 件の既存 md を tools/docs-policy.json の livingDocs へベースライン登録しました。`,
      "この状態でまず `npx docs-lint` が green（0 error）になることを確認してください。",
      "その後、段階的に縮小します:",
      "  1. temp/tmp/draft/wip 相当のディレクトリを解体（各ファイルを docs/records/ へ日付付きで移動、または削除）",
      "  2. 手動索引（INDEX.md 等）を削除する（一覧は `ls docs/records/` で代替）",
      "  3. 旧分類（spec/manual/knowledge/log 等）を仕分ける: 決定の理由は docs/adr/、過去の記録は docs/records/、" +
        "常に最新であるべきものだけ living として残す",
      "  4. 本当に「常に最新であるべき」ものだけが残るまで livingDocs を縮小し、追加のたびに理由を ADR に残す",
    );
  } else {
    nextSteps.push(
      "`npx docs-lint` を実行して green（0 error）を確認してください。",
      "CLAUDE.md / AGENTS.md / README.md はこのコマンドでは作成・変更しません。" +
        "既存のファイルがあれば、ドキュメント規約への参照（例: 「ドキュメントは docs/README.md の規約に従う」の1〜2行）を手動で追加してください。",
    );
  }
  nextSteps.push(
    "npm プロジェクトの場合は package.json の devDependencies に " +
      '`"docs-lint": "github:128na/docs-lint#v1.0.0"` を追加し、' +
      "`.github/workflows/docs-lint.yml` を `npm ci` + `npx docs-lint` の形に調整してください（テンプレはpackage.jsonを前提にしていません）。",
  );

  return { results: results.map((r) => ({ path: rel(r.path), action: r.action })), nextSteps };
}
