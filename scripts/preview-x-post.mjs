// scripts/preview-x-post.mjs
// X への自動投稿の本文を、本番の実データで組み立ててプレビューする。
// APIキー不要・投稿は一切しない。文言や文字数を確認したいときに使う。
//
//   node scripts/preview-x-post.mjs          # 今日の実データでプレビュー
//   node scripts/preview-x-post.mjs --week   # 今週どの曜日に投稿されるかも表示

import { composePost, weightedLength, shouldPostToday, jstWeekday } from "../api/_x-post.js";

const res = await fetch("https://www.earth-re-boot.com/api/analyze");
if (!res.ok) {
  console.error(`analyze の取得に失敗: HTTP ${res.status}`);
  process.exit(1);
}
const analysis = await res.json();

const text = composePost(analysis);
if (!text) {
  console.error("投稿本文を組み立てられませんでした（reboot_years_from_now が不正の可能性）");
  process.exit(1);
}

const len = weightedLength(text);
const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

console.log("─".repeat(60));
console.log(text);
console.log("─".repeat(60));
console.log(`重み付き文字数: ${len} / 280  ${len <= 280 ? "✅" : "❌ 超過"}`);
console.log(`本日(${WEEKDAYS[jstWeekday()]}曜) は投稿対象: ${shouldPostToday() ? "はい" : "いいえ"}`);

if (process.argv.includes("--week")) {
  console.log("\n今後7日間の投稿予定:");
  for (let i = 0; i < 7; i++) {
    const d = new Date(Date.now() + i * 86400000);
    const wd = WEEKDAYS[jstWeekday(d)];
    console.log(`  ${d.toISOString().slice(0, 10)} (${wd}) ${shouldPostToday(d) ? "→ 投稿" : "→ なし"}`);
  }
}
