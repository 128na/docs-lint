// docs-lint のコアロジック。CLI（bin/docs-lint.mjs）から呼ばれる純粋関数として実装し、
// process.exit/console に依存しないため、テストからフィクスチャに対して直接呼び出せる。
import fs from "node:fs";
import path from "node:path";

const SKIP_DIRS = new Set([".git", "node_modules", ".github", ".claude", ".idea", ".vscode"]);
const RECORD_NAME = /^(\d{4})-(\d{2})-(\d{2})_[a-z0-9-]+\.md$/;
const ADR_NAME = /^(\d{4})-[a-z0-9-]+\.md$/;
// target はスペースを含むパスにも対応（<...> 形式、または引用符付きタイトルの手前まで）
const LINK = /\[[^\]]*\]\(\s*(?:<([^>]*)>|([^()\s][^()]*?))\s*(?:"[^"]*")?\)/g;

/**
 * @param {string} repoRoot 走査対象リポジトリのルート絶対パス
 * @param {object} policy docs-policy.json の内容（パース済みオブジェクト）
 * @param {object} [opts]
 * @param {Date} [opts.now] 「未来の日付」判定の基準時刻（テスト用に注入可能。既定は現在時刻）
 * @returns {{ errors: string[], warns: string[], filesScanned: number }}
 */
export function lint(repoRoot, policy, opts = {}) {
  const now = opts.now ?? new Date();
  const errors = [];
  const warns = [];
  const rel = (p) => path.relative(repoRoot, p).replaceAll("\\", "/");
  const error = (file, msg) => errors.push(`ERROR ${rel(file)}: ${msg}`);
  const warn = (file, msg) => warns.push(`WARN  ${rel(file)}: ${msg}`);
  const bodyCache = new Map();
  const readBody = (abs) => {
    if (!bodyCache.has(abs)) bodyCache.set(abs, fs.readFileSync(abs, "utf8"));
    return bodyCache.get(abs);
  };

  // ---- 走査 -------------------------------------------------------------
  const mdFiles = []; // { abs, relPath, kind }

  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        if (policy.forbiddenDirNames.includes(entry.name.toLowerCase())) {
          error(abs, `禁止されたディレクトリ名です（${entry.name}）。下書きは PR 説明や scratchpad へ、残す価値があるなら docs/records/ に日付付きで置く`);
        }
        walk(abs);
      } else if (entry.name.endsWith(".md")) {
        mdFiles.push({ abs, relPath: rel(abs) });
      }
    }
  }
  for (const root of policy.scanRoots.recursive) {
    const abs = path.join(repoRoot, root);
    if (fs.existsSync(abs)) walk(abs);
  }
  for (const root of policy.scanRoots.flat) {
    const abs = path.join(repoRoot, root);
    if (!fs.existsSync(abs)) continue;
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith(".md")) {
        mdFiles.push({ abs: path.join(abs, entry.name), relPath: rel(path.join(abs, entry.name)) });
      }
    }
  }

  // ---- 分類（allowlist 検査） ------------------------------------------
  const inDir = (relPath, dir) => relPath.startsWith(dir.replaceAll("\\", "/") + "/");
  for (const f of mdFiles) {
    if (policy.forbiddenFileNames.includes(path.basename(f.relPath))) {
      error(f.abs, `禁止されたファイル名です。手動索引や TODO.md は持たない（一覧は ls docs/records/、タスクは台帳か issue へ）`);
      f.kind = "forbidden";
    } else if (policy.livingDocs.includes(f.relPath)) f.kind = "living";
    else if (policy.ledgers.includes(f.relPath)) f.kind = "ledger";
    else if (policy.recordDirs.some((d) => inDir(f.relPath, d))) f.kind = "record";
    else if (inDir(f.relPath, policy.adrDir)) f.kind = "adr";
    else if (inDir(f.relPath, policy.templateDir)) f.kind = "template";
    else {
      f.kind = "unclassified";
      error(f.abs, `分類できない md です。records/ADR/台帳のいずれかに置くか、生きた文書として tools/docs-policy.json の livingDocs に登録（+理由を ADR 化）する`);
    }
  }

  // ---- records 命名 -----------------------------------------------------
  // UTC日付 + 1日を許容上限にする（実行環境のタイムゾーンに関わらず、UTC-12〜UTC+14の
  // どのローカル日付で作成された記録も「未来」と誤判定しないため）
  const maxAllowedDate = new Date(now);
  maxAllowedDate.setUTCDate(maxAllowedDate.getUTCDate() + 1);
  const maxAllowed = maxAllowedDate.toISOString().slice(0, 10);
  for (const f of mdFiles.filter((x) => x.kind === "record")) {
    const m = path.basename(f.relPath).match(RECORD_NAME);
    if (!m) {
      error(f.abs, "records の命名は YYYY-MM-DD_slug.md（slug は小文字英数とハイフン）");
      continue;
    }
    const [, y, mo, d] = m;
    const dt = new Date(`${y}-${mo}-${d}T00:00:00Z`);
    if (Number.isNaN(dt.getTime()) || dt.toISOString().slice(0, 10) !== `${y}-${mo}-${d}`) {
      error(f.abs, `実在しない日付です（${y}-${mo}-${d}）`);
    } else if (`${y}-${mo}-${d}` > maxAllowed) {
      error(f.abs, `未来の日付です（${y}-${mo}-${d}）`);
    }
  }

  // ---- ADR 命名 + ステータス行 -----------------------------------------
  const adrNumbers = new Map();
  for (const f of mdFiles.filter((x) => x.kind === "adr")) {
    const m = path.basename(f.relPath).match(ADR_NAME);
    if (!m) {
      error(f.abs, "ADR の命名は NNNN-slug.md（連番4桁 + 小文字英数とハイフン）");
      continue;
    }
    if (adrNumbers.has(m[1])) {
      error(f.abs, `ADR 番号 ${m[1]} が重複しています（${adrNumbers.get(m[1])}）`);
    } else {
      adrNumbers.set(m[1], f.relPath);
    }
    const body = readBody(f.abs);
    // policy.adrStatusPattern で表記ゆれを許容できる（例: 移行前から存在する ADR 相当
    // 文書の本文を書き換えない方針の場合、太字 `**ステータス**:` や英語 `Status:` も
    // 許容する正規表現ソース文字列を渡す）。既定は新規 ADR の標準形式のみ許可。
    const statusPattern = policy.adrStatusPattern
      ? new RegExp(policy.adrStatusPattern, "m")
      : /^> ステータス: /m;
    if (!statusPattern.test(body)) {
      error(f.abs, "「> ステータス: Accepted (YYYY-MM-DD)」形式のステータス行が必要です");
    }
  }

  // ---- リンク検査 -------------------------------------------------------
  for (const f of mdFiles) {
    if (f.kind === "template" || f.kind === "forbidden") continue;
    const body = readBody(f.abs);
    for (const m of body.matchAll(LINK)) {
      const target = m[1] ?? m[2];
      if (!target) continue;
      if (/^(https?|mailto):/.test(target) || target.startsWith("#") || target.startsWith("//")) continue;
      if (target.startsWith("~") || /^[A-Za-z]:[\\/]/.test(target) || target.startsWith("file://") || target.startsWith("/")) {
        error(f.abs, `リポジトリ外への絶対パスリンクは禁止（${target}）。リポジトリ内の相対リンクにするか、経緯なら records に書く`);
        continue;
      }
      const resolved = path.resolve(path.dirname(f.abs), target.split("#")[0]);
      if (!fs.existsSync(resolved)) {
        error(f.abs, `リンク切れ: ${target}`);
      }
    }
  }

  // ---- 台帳スキーマ -----------------------------------------------------
  const depDebt = path.join(repoRoot, "docs", "dependency-debt.md");
  if (fs.existsSync(depDebt)) {
    const lines = fs.readFileSync(depDebt, "utf8").split(/\r?\n/);
    const headerIdx = lines.findIndex((l) => l.trim() === policy.dependencyDebtHeader);
    if (headerIdx === -1) {
      error(depDebt, `ヘッダ行が規定と一致しません。/dependabot-maintenance 互換のため次を維持: ${policy.dependencyDebtHeader}`);
    } else {
      for (let i = headerIdx + 2; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line.startsWith("|")) break;
        const cells = line.split("|").map((c) => c.trim());
        const type = cells[5];
        if (type && !policy.dependencyDebtTypes.includes(type)) {
          error(depDebt, `L${i + 1}: Type「${type}」は不正。許可値: ${policy.dependencyDebtTypes.join(" / ")}`);
        }
      }
    }
  }
  const consDebt = path.join(repoRoot, "docs", "consistency-debt.md");
  if (fs.existsSync(consDebt)) {
    const seen = new Map();
    const lines = fs.readFileSync(consDebt, "utf8").split(/\r?\n/);
    lines.forEach((line, i) => {
      const m = line.match(/^\|\s*(CD-\d+)\s*\|/);
      if (!m) return;
      if (seen.has(m[1])) error(consDebt, `L${i + 1}: ${m[1]} が重複しています（初出 L${seen.get(m[1])}）`);
      else seen.set(m[1], i + 1);
    });
  }

  // ---- 生きた文書・台帳のパス参照検査（warn） --------------------------
  // 台帳(ledger)も living と同様「常に現在を反映する」ことが期待されるため対象に含める
  // （auto-tradeでの実運用で発見: known_risks.mdをliving→ledgerへ分類変更した際、この
  // 検査対象から外れて既存の壊れた参照が無監視になっていた実例がある）。
  const pathPrefixes = policy.livingDocPathPrefixes || ["docs", "tools", "src", "scripts", "tests"];
  const PATHLIKE = new RegExp("`((?:" + pathPrefixes.join("|") + ")\\/[^`\\s]+)`", "g");
  for (const f of mdFiles.filter((x) => x.kind === "living" || x.kind === "ledger")) {
    const body = readBody(f.abs);
    for (const m of body.matchAll(PATHLIKE)) {
      const token = m[1];
      if (/[*{}<>()?$]|YYYY|NNNN|\.\.\./.test(token)) continue; // プレースホルダはスキップ
      if (!fs.existsSync(path.join(repoRoot, token))) {
        warn(f.abs, `参照パスが見つかりません: ${token}（リネーム未追随の可能性）`);
      }
    }
  }

  // ---- テンプレマーカー残存（warn） ------------------------------------
  for (const f of mdFiles) {
    if (f.kind === "template") continue;
    const body = readBody(f.abs);
    const count = (body.match(/TODO\(template\):/g) || []).length;
    if (count > 0) warn(f.abs, `TODO(template) マーカーが ${count} 件残っています`);
  }

  return { errors, warns, filesScanned: mdFiles.length };
}
