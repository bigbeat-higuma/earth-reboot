// scripts/test-history.mjs
// 日次の記録（_history.js）と総合ヘルス判定（_health.js）の回帰テスト。Redis・APIキー不要。
//   node scripts/test-history.mjs
//
// ここで固定したい性質は2つ:
//   1. 障害中の値（フォールバック）を記録しない。積んでしまうとグラフに嘘の横ばいができる
//   2. 何かが止まったら ok:false になる。誰も見に来ない運用なので、ここが唯一の検知手段

import { buildSnapshot, recordSnapshot, readHistory, jstDateString, HISTORY_KEY } from "../api/_history.js";
import { evaluateHealth } from "../api/_health.js";

let fail = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}  want=${JSON.stringify(want)} got=${JSON.stringify(got)}`);
}

// --- jstDateString: Cronは 09:00 UTC（18:00 JST）と 21:00 UTC（翌06:00 JST）に動く ---
check("09:00 UTC は同じ日付", jstDateString(new Date("2026-11-11T09:00:00Z")), "2026-11-11");
check("21:00 UTC はJSTでは翌日", jstDateString(new Date("2026-11-11T21:00:00Z")), "2026-11-12");
check("15:00 UTC ちょうどで日付が変わる", jstDateString(new Date("2026-11-11T15:00:00Z")), "2026-11-12");

// --- buildSnapshot ---
const now = new Date("2026-11-11T09:00:00Z");
const analysis = {
  reboot_years_from_now: "11.46",
  threats: { geopolitical: 80, environmental: 67.4, economic: 65, social: 172, ai: 58 },
  key_factors: ["a", "b", "c", "d"],
  analyzed_at: "2026-11-11T08:59:00Z",
};
const overlay = { sources: { geopolitical: { title: "G" }, ai: { title: "A".repeat(300) }, social: {} } };
const snap = buildSnapshot(analysis, overlay, now);
check("日付はJST", snap.date, "2026-11-11");
check("年数は小数1桁に丸める", snap.years, 11.5);
check("スコアは整数に丸め、0〜100に収める", snap.threats, { geopolitical: 80, environmental: 67, economic: 65, social: 100, ai: 58 });
check("要因は3件まで", snap.factors, ["a", "b", "c"]);
check("見出しはタイトルのある軸だけ", Object.keys(snap.headlines), ["geopolitical", "ai"]);
check("見出しは160字で切る", snap.headlines.ai.length, 160);

check("フォールバックの解析は記録しない", buildSnapshot({ ...analysis, fallback: true }, overlay, now), null);
check("年数が数値でなければ記録しない", buildSnapshot({ ...analysis, reboot_years_from_now: "不明" }, overlay, now), null);
check("解析が無ければ記録しない", buildSnapshot(null, overlay, now), null);

// ai 軸を追加する前の解析結果（threats に ai が無い）でも落ちず、その軸だけ欠ける
const legacy = buildSnapshot({ ...analysis, threats: { geopolitical: 80 } }, null, now);
check("古い形式でも記録でき、無い軸は入れない", legacy.threats, { geopolitical: 80 });
check("オーバーレイが無くても記録できる", legacy.headlines, {});

// --- recordSnapshot / readHistory（Redisの代用品で往復させる） ---
function fakeRedis() {
  const store = {};
  return {
    store,
    async hset(key, obj) { store[key] = { ...(store[key] || {}), ...obj }; },
    async hgetall(key) { return store[key] || null; },
  };
}
const redis = fakeRedis();
check("空の履歴は空配列", await readHistory(redis), []);
await recordSnapshot(redis, { ...snap, date: "2026-11-10", years: 11.8 });
await recordSnapshot(redis, snap);
await recordSnapshot(redis, { ...snap, years: 11.4 }); // 同じ日の再実行
redis.store[HISTORY_KEY]["2026-11-09"] = "{壊れたJSON";
redis.store[HISTORY_KEY]["2026-11-08"] = { years: 12.1, src: "x" }; // Upstashは自動でパースして返すことがある
const rows = await readHistory(redis);
check("日付の昇順で返り、壊れた1件は飛ばす", rows.map((r) => r.date), ["2026-11-08", "2026-11-10", "2026-11-11"]);
check("同じ日は上書きされる（1日1件）", rows[2].years, 11.4);
check("null は記録しない", (await recordSnapshot(redis, null)).recorded, false);

// --- evaluateHealth ---
const T = Date.parse("2026-11-11T22:30:00Z"); // 11/12 07:30 JST（GitHub Actions が叩く時刻）
const healthy = {
  overlay: { date: "2026-11-11", generatedAt: "2026-11-11T21:00:05Z", patches: [{}, {}] },
  analysis: { analyzed_at: "2026-11-11T09:00:00Z", reboot_years_from_now: 11.5 },
  historyLatest: "2026-11-11",
  xLastPostAt: "2026-11-11T09:00:10Z",
  xEnabled: true,
  todayJst: "2026-11-12",
  now: T,
};
const h = evaluateHealth(healthy);
check("正常時は ok", [h.ok, h.failed], [true, []]);
check("朝の時点では前日の記録が最新でよい", h.checks.history.daysBehind, 1);

const failedOf = (patch) => evaluateHealth({ ...healthy, ...patch }).failed;
check("ニュースが31時間前なら異常", failedOf({ overlay: { ...healthy.overlay, generatedAt: "2026-11-10T15:00:00Z" } }), ["news"]);
check("ニュース0件なら異常", failedOf({ overlay: { ...healthy.overlay, patches: [] } }), ["news"]);
check("オーバーレイが無ければ異常", failedOf({ overlay: null }), ["news"]);
check("解析が37時間前なら異常", failedOf({ analysis: { analyzed_at: "2026-11-10T09:00:00Z" } }), ["analysis"]);
check("記録が2日遅れたら異常", failedOf({ historyLatest: "2026-11-10" }), ["history"]);
check("記録が1件も無ければ異常", failedOf({ historyLatest: null }), ["history"]);
check("投稿が7日止まったら異常", failedOf({ xLastPostAt: "2026-11-04T09:00:00Z" }), ["x"]);
check("土→水の4日間隔（1回スキップ）は正常", failedOf({ xLastPostAt: "2026-11-07T09:00:00Z" }), []);
check("Xのキー未設定なら投稿は判定しない", failedOf({ xEnabled: false, xLastPostAt: null }), []);
check("キーがあるのに投稿記録が無ければ異常", failedOf({ xLastPostAt: null }), ["x"]);
check("複数同時に止まれば全部挙げる", failedOf({ overlay: null, historyLatest: null }), ["news", "history"]);

console.log(fail ? `\n${fail} 件失敗` : "\nすべて成功");
process.exit(fail ? 1 : 0);
