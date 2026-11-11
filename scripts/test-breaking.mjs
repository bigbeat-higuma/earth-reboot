// scripts/test-breaking.mjs
// 速報の見張り（_breaking.js）と、日次ニュースの検索期間（news-fetch.js）の回帰テスト。
// ネットワーク・APIキー不要。AIの判定そのものは試さず、その前後の決まりごとを固定する。
//   node scripts/test-breaking.mjs

import {
  parseRss, windowStart, selectNew, normalizeTriage, composeBreakingPost, wouldPost,
  buildTriagePrompt, runBreakingCheck, SETTINGS, KEYS,
} from "../api/_breaking.js";
import { weightedLength } from "../api/_x-post.js";
import { buildSearchUrl, SEARCH_WINDOWS_DAYS, CATEGORIES, isRelevant, rankArticles, titleMatches } from "../api/news-fetch.js";
import { evaluateHealth } from "../api/_health.js";

let fail = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}  want=${JSON.stringify(want)} got=${JSON.stringify(got)}`);
}

// --- parseRss: BBC は CDATA、Guardian は素のテキスト＋実体参照 ---
const xml = `<?xml version="1.0"?><rss><channel><title>Feed</title><pubDate>Wed, 11 Nov 2026 00:00:00 GMT</pubDate>
<item><title><![CDATA[Ceasefire collapses & fighting resumes]]></title><link>https://example.com/a?x=1&amp;y=2</link><pubDate>Wed, 11 Nov 2026 03:00:00 GMT</pubDate></item>
<item>
  <title>Trump &amp; Xi agree &#8216;historic&#8217; deal &lt;live&gt;</title>
  <link>https://example.com/b</link>
  <pubDate>Wed, 11 Nov 2026 12:30:00 +0900</pubDate>
</item>
<item><title>No date</title><link>https://example.com/c</link></item>
<item><title>Bad link</title><link>javascript:alert(1)</link><pubDate>Wed, 11 Nov 2026 01:00:00 GMT</pubDate></item>
</channel></rss>`;
const items = parseRss(xml, "TEST");
check("日付の無い項目は捨てる", items.length, 3);
check("CDATA を外す", items[0].title, "Ceasefire collapses & fighting resumes");
check("リンクの &amp; を戻す", items[0].url, "https://example.com/a?x=1&y=2");
check("実体参照を戻す", items[1].title, "Trump & Xi agree ‘historic’ deal <live>");
check("タイムゾーン付きの日付を読む", new Date(items[1].at).toISOString(), "2026-11-11T03:30:00.000Z");
check("http(s) 以外のリンクは持たない", items[2].url, null);
check("媒体名を付ける", items[0].source, "TEST");
check("壊れた入力でも落ちない", parseRss("<html>not rss</html>", "X"), []);

// --- windowStart ---
const NOW = Date.parse("2026-11-11T06:00:00Z");
const H = 3600000;
check("初回は3時間前から", windowStart(null, NOW), NOW - 3 * H);
check("前回の確認時刻から", windowStart("2026-11-11T03:10:00Z", NOW), Date.parse("2026-11-11T03:10:00Z"));
check("長く止まっていても6時間より前には遡らない", windowStart("2026-11-09T00:00:00Z", NOW), NOW - 6 * H);

// --- selectNew ---
const pool = [
  { title: "Old", at: NOW - 5 * H, source: "A" },
  { title: "Fresh one", at: NOW - 1 * H, source: "A" },
  { title: "fresh ONE", at: NOW - 2 * H, source: "B" }, // 同じ見出しが別フィードにも出ている
  { title: "Newest", at: NOW - 0.1 * H, source: "B" },
  { title: "Future", at: NOW + 2 * H, source: "B" },      // 時刻のおかしい項目
];
check("期間内だけ・新しい順・重複は1件", selectNew(pool, NOW - 3 * H, NOW).map((i) => i.title), ["Newest", "Fresh one"]);
check("件数の上限", selectNew(pool, 0, NOW, 1).map((i) => i.title), ["Newest"]);

// --- normalizeTriage: モデルの返答を信用しすぎない ---
check("正常な返答", normalizeTriage({ severity: 82.4, direction: "worse", axis: "geopolitical", headline_index: 2, reason_ja: " 停戦が崩壊し\n戦闘が再開 " }, 5),
  { severity: 82, direction: "worse", axis: "geopolitical", headlineIndex: 2, reason: "停戦が崩壊し 戦闘が再開" });
check("範囲外・型違いは無害な値に倒す", normalizeTriage({ severity: 999, direction: "panic", axis: "aliens", headline_index: 9, reason_ja: 42 }, 5),
  { severity: 100, direction: "none", axis: null, headlineIndex: null, reason: "" });
check("空の返答", normalizeTriage(null, 5), { severity: 0, direction: "none", axis: null, headlineIndex: null, reason: "" });
check("理由は80字で切る", normalizeTriage({ reason_ja: "あ".repeat(200) }, 1).reason.length, 80);

// --- 投稿文と「投稿していたか」 ---
const post = composeBreakingPost({ fromYears: 11.5, toYears: 10.9, reason: "A国がB国の核施設を攻撃したと発表" });
check("数字と事実だけの定型", post, "【臨時更新】地球再起動まで、残り約10.9年（11.5年から変動）。\n\nA国がB国の核施設を攻撃したと発表\n\n#EarthReboot #地球再起動時間");
check("280以内", weightedLength(post) <= 280, true);
check("URLを含まない（投稿単価が13倍になるため）", /https?:\/\//.test(post), false);
check("理由が無ければ作らない", composeBreakingPost({ fromYears: 11.5, toYears: 10.9, reason: "" }), null);
check("数字が無ければ作らない", composeBreakingPost({ fromYears: NaN, toYears: 10.9, reason: "x" }), null);
check("重大かつ大きく動いた", wouldPost({ severity: 80, deltaYears: -0.6 }), true);
check("良い方向へ大きく動いた", wouldPost({ severity: 80, deltaYears: 0.5 }), true);
check("重大でも値が動かなければ出さない", wouldPost({ severity: 90, deltaYears: -0.2 }), false);
check("値が動いても重大度が低ければ出さない", wouldPost({ severity: 70, deltaYears: -1.0 }), false);
check("試算できなければ出さない", wouldPost({ severity: 95, deltaYears: NaN }), false);

// --- プロンプト: 判定に必要な材料が入っているか ---
const prompt = buildTriagePrompt({
  headlines: [{ source: "BBC", title: "Headline one" }, { source: "Al Jazeera", title: "Headline two" }],
  analysis: { reboot_years_from_now: 11.2, threats: { geopolitical: 80, ai: 70 } },
  known: ["Known headline"],
  flagged: ["検知済みの出来事"],
});
check("現在値・織り込み済み・検知済み・番号付き見出しを含む",
  ["残り約11.2年", "Known headline", "検知済みの出来事", "1. [BBC] Headline one", "2. [Al Jazeera] Headline two"].every((s) => prompt.includes(s)), true);

// --- runBreakingCheck: 新しい見出しが無ければAIを呼ばずに終わる（費用をかけない） ---
function fakeRedis(initial = {}) {
  const kv = { ...initial }, lists = {};
  return {
    kv, lists,
    async get(k) { return kv[k] ?? null; },
    async set(k, v) { kv[k] = v; },
    async lpush(k, v) { (lists[k] ||= []).unshift(v); },
    async ltrim(k, a, b) { lists[k] = (lists[k] || []).slice(a, b + 1); },
    async lrange(k, a, b) { return (lists[k] || []).slice(a, b + 1); },
  };
}
const realFetch = globalThis.fetch;
let anthropicCalls = 0;
globalThis.fetch = async (url) => {
  if (String(url).includes("anthropic.com")) { anthropicCalls++; throw new Error("AIを呼んではいけない"); }
  // どのフィードも「期間より古い見出し」しか返さない
  return { ok: true, text: async () => `<rss><item><title>Stale</title><link>https://e.com</link><pubDate>Mon, 09 Nov 2026 00:00:00 GMT</pubDate></item></rss>` };
};
process.env.ANTHROPIC_API_KEY = "test-key";
const r1 = fakeRedis();
const out1 = await runBreakingCheck(r1, NOW);
check("新着なし: 成功として記録", [out1.ok, out1.n, out1.mode], [true, 0, "observe"]);
check("新着なし: AIを呼ばない", anthropicCalls, 0);
check("新着なし: 確認時刻を進める", r1.kv[KEYS.lastCheckAt], new Date(NOW).toISOString());
check("新着なし: 記録を1件残す", r1.lists[KEYS.log].length, 1);

// --- 全フィードが落ちたら、確認時刻を進めない（次回に見直し、止まり続ければ監視が拾う） ---
globalThis.fetch = async () => { throw new Error("network down"); };
const r2 = fakeRedis({ [KEYS.lastCheckAt]: "2026-11-11T03:00:00.000Z" });
const out2 = await runBreakingCheck(r2, NOW);
check("全滅: 失敗として記録", [out2.ok, out2.error], [false, "all feeds failed"]);
check("全滅: 確認時刻は据え置き", r2.kv[KEYS.lastCheckAt], "2026-11-11T03:00:00.000Z");

// --- AIが返答したとき: 観察モードでは記録するだけ ---
let xCalls = 0;
globalThis.fetch = async (url, opts) => {
  const u = String(url);
  if (u.includes("twitter.com") || u.includes("x.com")) { xCalls++; throw new Error("投稿してはいけない"); }
  if (u.includes("anthropic.com")) {
    const body = JSON.parse(opts.body);
    // 1回目=判定（見張り用モデル）、2回目=試算（通常の解析と同じモデル）
    const text = body.model === "claude-sonnet-4-6"
      ? JSON.stringify({ reboot_years_from_now: 10.4, summary: "s", threats: { geopolitical: 95 }, threat_evidence: {}, key_factors: [] })
      : JSON.stringify({ severity: 88, direction: "worse", axis: "geopolitical", headline_index: 1, reason_ja: "A国がB国の核施設を攻撃したと発表" });
    return { ok: true, json: async () => ({ model: body.model, stop_reason: "end_turn", content: [{ type: "text", text }] }) };
  }
  return { ok: true, text: async () => `<rss><item><title>Country A strikes nuclear site in B</title><link>https://e.com/1</link><pubDate>Wed, 11 Nov 2026 05:30:00 GMT</pubDate></item></rss>` };
};
const r3 = fakeRedis({
  analysis_cache_ja: { reboot_years_from_now: 11.2, threats: { geopolitical: 80 } },
  "dyn:overlay:latest": { date: "2026-11-10", digest: { headlines: { conflict: "Known" } } },
});
const out3 = await runBreakingCheck(r3, NOW);
check("検知: 重大度と見出し", [out3.severity, out3.headline, out3.source], [88, "Country A strikes nuclear site in B", "BBC"]);
check("検知: 試算の差分", out3.shadow && [out3.shadow.baseline, out3.shadow.years, out3.shadow.delta], [11.2, 10.4, -0.8]);
check("検知: 投稿していたはずと記録", out3.wouldPost, true);
check("検知: 文面を記録", out3.text && out3.text.startsWith("【臨時更新】地球再起動まで、残り約10.4年（11.2年から変動）。"), true);
check("検知: X には投稿しない", xCalls, 0);
check("検知: サイトの値（解析キャッシュ）を書き換えない", r3.kv.analysis_cache_ja.reboot_years_from_now, 11.2);
check("検知: 続報を二重に数えないよう覚えておく", r3.lists[KEYS.flagged].length, 1);
globalThis.fetch = realFetch;

// --- 日次ニュースの検索期間 ---
const url = new URL(buildSearchUrl(CATEGORIES[0], 3, new Date("2026-11-11T06:00:00Z")));
check("直近3日に絞る", url.searchParams.get("from"), "2026-11-08T06:00:00");
check("関連度順は維持", url.searchParams.get("sortBy"), "relevancy");
check("まず3日、無ければ7日", SEARCH_WINDOWS_DAYS, [3, 7]);
check("報道機関に限る", url.searchParams.get("domains").split(",").includes("bbc.co.uk"), true);

// --- 並び順: 見出しが主題語を含む記事を先頭に（2026-11-11 に本番で実際に混入した記事） ---
const virus = CATEGORIES.find((c) => c.key === "virus");
const theater = { title: "Theater Chains Pout About Shorter Streaming Release Windows", description: "Among the business concepts exposed as folly during the COVID-19 pandemic was the release window" };
const executive = { title: "I'm a hospital executive who started working 12-hour ER shifts", description: "Frontline workers needed better communication than emails." };
const ebola = { title: "Ebola cases in DR Congo pass 11,000, with 5,387 deaths", description: "Health officials report a sharp rise." };
check("関係代名詞の who では感染症に一致しない", isRelevant(virus, executive), false);
check("概要で触れているだけの記事より、見出しが主題の記事を前に", rankArticles(virus, [theater, executive, ebola]).map((a) => a.title.slice(0, 5)), ["Ebola", "Theat"]);
check("見出しの一致を判定", [titleMatches(virus, ebola), titleMatches(virus, theater)], [true, false]);

// --- 鮮度監視: 見張りが止まったら知らせる ---
const T = Date.parse("2026-11-11T22:30:00Z");
const healthy = {
  overlay: { date: "2026-11-11", generatedAt: "2026-11-11T21:00:05Z", patches: [{}] },
  analysis: { analyzed_at: "2026-11-11T09:00:00Z", reboot_years_from_now: 11.5 },
  historyLatest: "2026-11-11", xLastPostAt: "2026-11-11T09:00:10Z", xEnabled: true,
  todayJst: "2026-11-12", now: T,
};
check("見張りが未設定なら対象外", evaluateHealth({ ...healthy, watchLastCheckAt: null }).failed, []);
check("3時間前に確認済みなら正常", evaluateHealth({ ...healthy, watchLastCheckAt: "2026-11-11T19:20:00Z" }).failed, []);
check("13時間止まっていたら異常", evaluateHealth({ ...healthy, watchLastCheckAt: "2026-11-11T09:20:00Z" }).failed, ["watch"]);

console.log(fail ? `\n${fail} 件失敗` : "\nすべて成功");
process.exit(fail ? 1 : 0);
