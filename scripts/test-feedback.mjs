// scripts/test-feedback.mjs
// 訪問者の声（api/feedback.js）の回帰テスト。ネットワーク・Redis 不要。
//   node scripts/test-feedback.mjs

import fs from "node:fs";
import {
  POLL_CHOICES, KEYS, SETTINGS, senderId, cleanComment, publicPoll, recordVote, recordComment,
} from "../api/feedback.js";

let fail = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}  want=${JSON.stringify(want)} got=${JSON.stringify(got)}`);
}

// @upstash/redis のうち、feedback.js が使う命令だけを真似る
function fakeRedis() {
  const kv = new Map(), hashes = new Map(), lists = new Map(), ttl = new Map();
  return {
    kv, hashes, lists, ttl,
    async set(k, v, opts = {}) {
      if (opts.nx && kv.has(k)) return null;
      kv.set(k, v); if (opts.ex) ttl.set(k, opts.ex);
      return "OK";
    },
    async incr(k) { const n = (kv.get(k) || 0) + 1; kv.set(k, n); return n; },
    async expire(k, s) { ttl.set(k, s); return 1; },
    async hincrby(k, f, n) { const h = hashes.get(k) || {}; h[f] = (h[f] || 0) + n; hashes.set(k, h); return h[f]; },
    async hgetall(k) { return hashes.get(k) || null; },
    async lpush(k, v) { const l = lists.get(k) || []; l.unshift(v); lists.set(k, l); return l.length; },
    async ltrim(k, a, b) { lists.set(k, (lists.get(k) || []).slice(a, b + 1)); return "OK"; },
  };
}

const NOW = new Date("2026-11-11T08:00:00.000Z");

// --- 送信元の識別子: IPそのものを残さない ---
const id = senderId("203.0.113.7", "pepper");
check("識別子は24文字の16進", /^[0-9a-f]{24}$/.test(id), true);
check("識別子にIPが含まれない", id.includes("203.0.113.7"), false);
check("同じIPは同じ識別子", senderId("203.0.113.7", "pepper"), id);
check("別のIPは別の識別子", senderId("203.0.113.8", "pepper") === id, false);

// --- 集計の公開: 件数が足りないうちは中身を出さない ---
check("回答0件は非公開", publicPoll(null), { ready: false });
check("19件は非公開", publicPoll({ u5: 10, "5to10": 9 }), { ready: false });
check("19件のとき件数も漏らさない", Object.keys(publicPoll({ u5: 19 })), ["ready"]);
check("20件で公開", publicPoll({ u5: 10, "5to10": "10" }), {
  ready: true, total: 20, counts: { u5: 10, "5to10": 10, "10to20": 0, o20: 0, never: 0 },
});
check("知らない選択肢は数えない", publicPoll({ u5: 20, hacked: 999 }).total, 20);
check("壊れた値は0として扱う", publicPoll({ u5: 20, o20: "abc", never: -5 }).counts, {
  u5: 20, "5to10": 0, "10to20": 0, o20: 0, never: 0,
});

// --- 回答 ---
const r1 = fakeRedis();
const v1 = await recordVote(r1, { choice: "5to10", sender: "aaa", now: NOW });
check("回答を数える", [v1.ok, v1.counted, r1.hashes.get(KEYS.poll)], [true, true, { "5to10": 1 }]);
check("月ごとにも数える", r1.hashes.get(KEYS.pollMonth("2026-11")), { "5to10": 1 });
check("二重回答の鍵は24時間", r1.ttl.get(KEYS.voted("aaa")), 86400);
check("件数が少ないうちは集計を返さない", v1.poll, { ready: false });
const v2 = await recordVote(r1, { choice: "u5", sender: "aaa", now: NOW });
check("同じ送信元の2回目は数えない", [v2.ok, v2.counted, r1.hashes.get(KEYS.poll)], [true, false, { "5to10": 1 }]);
const v3 = await recordVote(r1, { choice: "u5", sender: "bbb", now: NOW });
check("別の送信元は数える", [v3.counted, r1.hashes.get(KEYS.poll)], [true, { "5to10": 1, u5: 1 }]);
const v4 = await recordVote(r1, { choice: "__proto__", sender: "ccc", now: NOW });
check("知らない選択肢は拒否", [v4.ok, v4.status, r1.kv.has(KEYS.voted("ccc"))], [false, 400, false]);
check("選択肢は5つ", POLL_CHOICES.length, 5);

// --- ご意見の整形 ---
check("前後の空白を取る", cleanComment("  こんにちは \n"), "こんにちは");
check("制御文字を落とす", cleanComment("a\u0000b\u0007c\u001Bd"), "abcd");
check("改行は残し、3つ以上は2つにする", cleanComment("a\r\nb\n\n\n\nc"), "a\nb\n\nc");
check("文字列以外は空", cleanComment({ x: 1 }), "");

// --- ご意見 ---
const r2 = fakeRedis();
const c1 = await recordComment(r2, { text: " 怖いけど目が離せない ", lang: "ja", choice: "u5", sender: "aaa", now: NOW });
check("ご意見を保存", [c1.ok, c1.stored], [true, true]);
check("保存内容（IPや識別子は持たない）", JSON.parse(r2.lists.get(KEYS.comments)[0]), {
  at: "2026-11-11T08:00:00.000Z", lang: "ja", text: "怖いけど目が離せない", choice: "u5",
});
const c2 = await recordComment(r2, { text: "<script>alert(1)</script>", lang: "xx", choice: "bogus", sender: "aaa", now: NOW });
check("知らない言語・選択肢は保存しない", JSON.parse(r2.lists.get(KEYS.comments)[0]), {
  at: "2026-11-11T08:00:00.000Z", lang: "?", text: "<script>alert(1)</script>",
});
check("新しい順に並ぶ", [c2.ok, r2.lists.get(KEYS.comments).length], [true, 2]);

const c3 = await recordComment(fakeRedis(), { text: "   ", sender: "x", now: NOW });
check("空は拒否", [c3.ok, c3.status], [false, 400]);
const c4 = await recordComment(fakeRedis(), { text: "あ".repeat(501), sender: "x", now: NOW });
check("501字は拒否", [c4.ok, c4.status], [false, 400]);
const c5 = await recordComment(fakeRedis(), { text: "😀".repeat(500), sender: "x", now: NOW });
check("絵文字500字は受け付ける（1字として数える）", c5.ok, true);

const r3 = fakeRedis();
const trap = await recordComment(r3, { text: "buy now", trap: "http://spam.example", sender: "bot", now: NOW });
check("隠し項目が埋まっていたら、受け付けたふりをして捨てる", [trap.ok, trap.stored, r3.lists.size, r3.kv.size], [true, false, 0, 0]);

// 同じ送信元は1時間に3件まで
const r4 = fakeRedis();
const results = [];
for (let i = 0; i < 4; i++) results.push((await recordComment(r4, { text: "意見" + i, sender: "aaa", now: NOW })).status || 200);
check("4件目は429", results, [200, 200, 200, 429]);
check("4件目は保存しない", r4.lists.get(KEYS.comments).length, 3);
check("連投の鍵は1時間", r4.ttl.get(KEYS.rate("aaa")), 3600);

// 全体で1日200件まで
const r5 = fakeRedis();
r5.kv.set(KEYS.dayCount("2026-11-11"), SETTINGS.commentPerDay);
const over = await recordComment(r5, { text: "意見", sender: "zzz", now: NOW });
check("1日の上限を超えたら429", [over.ok, over.status, r5.lists.size], [false, 429, 0]);

// 古いものから捨てる
const r6 = fakeRedis();
r6.lists.set(KEYS.comments, Array.from({ length: SETTINGS.commentsKeep }, (_, i) => `old${i}`));
await recordComment(r6, { text: "新しい意見", sender: "aaa", now: NOW });
check("上限を超えたら古いものを捨てる", r6.lists.get(KEYS.comments).length, SETTINGS.commentsKeep);
check("先頭が最新", JSON.parse(r6.lists.get(KEYS.comments)[0]).text, "新しい意見");

// --- 画面側: 協力金の残りかすが無く、5言語すべてに文言がある ---
const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
check("協力金・決済の記述が画面に残っていない",
  (html.match(/api\/donat|paypay|paypal|buymeacoffee|運営協力金|donate-btn|stripe/gi) || []).length, 0);
for (const key of ["lblVoiceTitle", "voiceIntro", "voiceChoices", "voiceThanks", "voicePending", "voiceTotal", "voiceYou",
  "voiceVoteErr", "lblVoiceText", "voicePlaceholder", "voiceNote", "voiceSend", "voiceSent", "voiceEmpty", "voiceErr", "voiceRate"]) {
  check(`文言 ${key} が5言語にある`, (html.match(new RegExp(`\\b${key}:`, "g")) || []).length, 5);
}
check("選択肢の文言が5言語×5つある", (html.match(/voiceChoices: \{ u5: "[^"]+", "5to10": "[^"]+", "10to20": "[^"]+", o20: "[^"]+", never: "[^"]+" \}/g) || []).length, 5);
// 画面が使っている文言のキーが、すべて定義されている（消し忘れ・消しすぎの検出）
const used = new Set([...html.matchAll(/\bt\("([A-Za-z0-9]+)"/g)].map((m) => m[1]));
const jaBlock = html.slice(html.indexOf("  ja: {"), html.indexOf("  en: {"));
const missing = [...used].filter((k) => !new RegExp(`\\b${k}:`).test(jaBlock));
check("t() で使うキーがすべて定義済み", missing, []);

console.log(fail ? `\n${fail} FAILED` : "\nALL PASS");
process.exit(fail ? 1 : 0);
