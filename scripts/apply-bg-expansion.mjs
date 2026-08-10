// scripts/apply-bg-expansion.mjs
// 背景の単調さを解消するため、scenario.json の bg キーを再配分する（2026-08-10）。
//
//   node scripts/apply-bg-expansion.mjs --dry-run   # 変更内容の確認のみ
//   node scripts/apply-bg-expansion.mjs             # 実際に書き換え
//
// 背景: 121シーンに対し背景が7種類しかなく、特に gaia がオープニング・CH6・
// クライマックス・幕間を兼任していた（全体の27%）。物語の最高潮が道中と同じ絵だった。
//
// 変更方針:
//   - intro   : オープニング7シーンを gaia から専用の intro へ
//   - climax  : クライマックス6シーンを gaia から専用の climax へ
//   - *_after : 各章の react 以降（10シーンずつ）を「余波」背景へ切り替え、
//               章の途中で景色が変わるようにする
//
// ⚠️ bg は表示のみに使われ、分岐・スコア・エンディング判定には一切影響しない。
//    30万回シミュレーション済みのバランスは変化しない。

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(__dirname, "..", "public", "data", "scenario.json");

const CHAPTER_BG = { ch1: "flood", ch2: "war", ch3: "virus", ch4: "economy", ch5: "society", ch6: "gaia" };
// 章の「余波」に入る境目。この接頭辞のシーンから背景を切り替える
const AFTER_PATTERN = /^ch\d+_(react|hidden|aftermath)/;

const dryRun = process.argv.includes("--dry-run");
const json = JSON.parse(fs.readFileSync(FILE, "utf8"));

const changes = [];
for (const scene of json.scenes) {
  const before = scene.bg;
  let after = before;

  if (scene.id.startsWith("intro")) {
    after = "intro";
  } else if (scene.id.startsWith("climax")) {
    after = "climax";
  } else if (AFTER_PATTERN.test(scene.id)) {
    const ch = scene.id.match(/^(ch\d+)_/)?.[1];
    const base = CHAPTER_BG[ch];
    if (base) after = `${base}_after`;
  }

  if (after !== before) {
    scene.bg = after;
    changes.push({ id: scene.id, before, after });
  }
}

// 変更後に使われている bg キーを集計
const used = {};
for (const s of json.scenes) if (s.bg) used[s.bg] = (used[s.bg] || 0) + 1;

console.log(`変更対象: ${changes.length} シーン / 全 ${json.scenes.length}`);
const grouped = {};
for (const c of changes) {
  const k = `${c.before} → ${c.after}`;
  grouped[k] = (grouped[k] || 0) + 1;
}
for (const [k, v] of Object.entries(grouped)) console.log(`  ${k.padEnd(28)} ${v} シーン`);

console.log("\n変更後の背景分布:");
for (const [k, v] of Object.entries(used).sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(16)} ${v}`);

// 画像ファイルの存在確認（無いと canvas フォールバックになる）
const imgDir = path.join(__dirname, "..", "public", "images");
const missing = Object.keys(used).filter((k) => !fs.existsSync(path.join(imgDir, `${k}.jpg`)));
console.log("\n画像ファイルが無い bg キー:", missing.length ? missing.join(", ") : "なし ✓");

if (dryRun) {
  console.log("\n--dry-run のため書き込みませんでした");
} else if (missing.length) {
  console.error("\n❌ 画像が揃っていないため中止しました（canvasフォールバックに退化するのを防ぐため）");
  process.exit(1);
} else {
  fs.writeFileSync(FILE, JSON.stringify(json, null, 2) + "\n", "utf8");
  console.log(`\n✅ ${FILE} を更新しました`);
}
