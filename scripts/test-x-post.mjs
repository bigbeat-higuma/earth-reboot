// scripts/test-x-post.mjs
// X投稿の文字数計算・本文組み立て・投稿曜日の回帰テスト。APIキー不要・投稿はしない。
//   node scripts/test-x-post.mjs
//
// 文字数超過は過去に実際の投稿失敗を起こしている（2026-07-19 の記録）。
// 全角=2カウント、URL=一律23カウントというXの仕様をここで固定する。

import { weightedLength, composePost, shouldPostToday, jstWeekday } from "../api/_x-post.js";

let fail = 0;
function check(label, got, want) {
  const ok = got === want;
  if (!ok) fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}  want=${want} got=${got}`);
}

// --- weightedLength: Xの重み付きカウント ---
check("半角は1カウント", weightedLength("abcde"), 5);
check("全角は2カウント", weightedLength("あいう"), 6);
check("URLは長さによらず23カウント", weightedLength("https://www.earth-re-boot.com"), 23);
check("長いURLでも23カウント", weightedLength("https://example.com/" + "a".repeat(200)), 23);
check("混在", weightedLength("あい https://x.com"), 4 + 1 + 23);

// --- composePost ---
const analysis = {
  reboot_years_from_now: 11.5,
  summary: "一文目です。二文目です。三文目です。",
};
const post = composePost(analysis);
check("280以内に収まる", weightedLength(post) <= 280, true);
check("残り年数が入る", post.includes("残り約11.5年"), true);
check("ハッシュタグが入る", post.includes("#EarthReboot"), true);

// URLを含むと1件あたりの課金が $0.015 → $0.200 と13倍になり、
// X側の表示も抑制されやすい。本文にURLを入れないことを固定する。
check("URLを含まない", /https?:\/\//.test(post), false);

// 極端に長い要約でも必ず280以内に収める（文単位で切り詰められる）
const longPost = composePost({
  reboot_years_from_now: 9.9,
  summary: Array.from({ length: 40 }, (_, i) => `これは${i}番目のとても長い文章です`).join("。") + "。",
});
check("長い要約でも280以内", weightedLength(longPost) <= 280, true);
// 本文の最後がハッシュタグ行の直前で「。」で終わっている＝文の途中で切れていない
check("長い要約でも文の途中で切れない", /。\n\n#EarthReboot/.test(longPost), true);

// 要約が空でも成立する
const noSummary = composePost({ reboot_years_from_now: 5.0, summary: "" });
check("要約なしでも本文が作れる", typeof noSummary === "string" && noSummary.length > 0, true);

// 数値が壊れていたら投稿しない
check("年数が不正なら null", composePost({ reboot_years_from_now: "N/A", summary: "x" }), null);
check("analysis が null なら null", composePost(null), null);

// --- 投稿曜日（JST基準で月・水・土） ---
// 2026-08-10 は月曜。UTC 09:00 は JST 18:00 で同じ日。
check("月曜は投稿する", shouldPostToday(new Date("2026-08-10T09:00:00Z")), true);
check("火曜は投稿しない", shouldPostToday(new Date("2026-08-11T09:00:00Z")), false);
check("水曜は投稿する", shouldPostToday(new Date("2026-08-12T09:00:00Z")), true);
check("土曜は投稿する", shouldPostToday(new Date("2026-08-15T09:00:00Z")), true);
check("日曜は投稿しない", shouldPostToday(new Date("2026-08-09T09:00:00Z")), false);

// UTCとJSTで日付がまたぐ時刻でも JST の曜日で判定される
// 2026-08-09(日) 16:00 UTC = 2026-08-10(月) 01:00 JST
check("UTC日曜夜=JST月曜として扱う", jstWeekday(new Date("2026-08-09T16:00:00Z")), 1);

console.log(`\n${fail === 0 ? "全テスト成功" : `${fail} 件失敗`}`);
process.exit(fail ? 1 : 0);
