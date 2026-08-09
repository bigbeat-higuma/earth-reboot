// scripts/test-news-filter.mjs
// ニュース関連性フィルタの回帰テスト。NewsAPI キー不要（純粋な正規表現判定のみ）。
//   node scripts/test-news-filter.mjs
//
// ケースの多くは本番で実際に混入した記事から採取している。
// カテゴリのクエリや relevance を触ったら必ず実行すること。

import { CATEGORIES, isRelevant, relevanceTier } from "../api/news-fetch.js";

const cat = (k) => CATEGORIES.find((c) => c.key === k);

// [カテゴリ, タイトル, 概要, 期待値]
const cases = [
  // --- 2026-08-08 の本番フィード（CH5 のみ誤混入） ---
  ["climate", "Drought could cause shortage of certain foods, head of farmers' union says", "", true],
  ["conflict", "US renews strikes on Iran as Trump threatens to attack Pickaxe Mountain", "", true],
  ["virus", "Explainer-Why Congo's Ebola outbreak is spreading faster than previous epidemics", "", true],
  ["economy", "The $39 trillion U.S. national debt isn't as high as Japan's and Singapore's relative to economy size", "", true],
  // 本番の実データ。"police officers ... have spread misinformation" が context の police に
  // 一致して通過していた（2026-08-09 に本番の /api/news-fetch から採取）
  ["social", "That Thing You’ve Heard About Baby Rattlesnakes? It’s Wrong", "A new study has found that police officers, park rangers, and even a poison control center have spread misinformation about the dangers of juvenile rattlesnakes for decades.", false],
  ["ai", "The Apple FaceID Co-Inventor Building a Frontier AI Model for the Human Brain", "", true],

  // --- social: 本来通すべき記事が落ちないこと ---
  ["social", "Thousands join protest in capital over new labour law", "", true],
  ["social", "Riot police deployed as civil unrest spreads", "", true],
  ["social", "Election misinformation surges on social media platforms ahead of vote", "", true],
  ["social", "Disinformation campaign targeted voters, government report finds", "", true],
  ["social", "Society grows more polarized, survey shows", "", true],

  // --- social: 落とすべき曖昧語ノイズ ---
  ["social", "Five nutrition myths debunked", "Dietitians say misinformation about protein is everywhere.", false],
  ["social", "Conspiracy thriller tops the box office this weekend", "", false],

  // --- conflict: 軍事的な strike は拾い、労働争議は落とす ---
  ["conflict", "Air strikes reported near the border overnight", "", true],
  ["conflict", "Rail workers strike over pay as talks collapse", "Union members walked out after negotiations with the operator failed.", false],
  ["conflict", "Hunger strike enters second week at detention centre", "", false],
];

let fail = 0;
for (const [key, title, description, want] of cases) {
  const got = isRelevant(cat(key), { title, description });
  const ok = got === want;
  if (!ok) fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  [${key}] want=${want} got=${got}  ${title.slice(0, 62)}`);
}

// 曖昧語で拾った記事より、主題語に一致した記事が前に来ること。
// 各章のスロットは先頭1件しか使わないため、この順序が結果を左右する。
const social = cat("social");
const ordering = [
  { title: "Study: misinformation about election fraud spread by police union", description: "", },
  { title: "Thousands join protest after police crackdown", description: "" },
];
const sorted = ordering
  .map((a) => ({ a, tier: relevanceTier(social, a) }))
  .filter((x) => x.tier > 0)
  .sort((x, y) => y.tier - x.tier)
  .map((x) => x.a.title);

const orderOk = sorted[0]?.startsWith("Thousands join protest");
if (!orderOk) fail++;
console.log(`${orderOk ? "PASS" : "FAIL"}  [order] 主題語一致の記事が先頭に来る → ${sorted[0]?.slice(0, 45)}`);

const total = cases.length + 1;
console.log(`\n${total - fail}/${total} passed`);
process.exit(fail ? 1 : 0);
