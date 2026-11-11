// api/feedback.js — 訪問者の声を受け取る（運営協力金の代わりに 2026-11-11 に追加）
//
// 2つの入口がある。
//   1. ワンタップの質問「あなたの体感では、残り何年ですか？」
//      → 選択肢ごとの件数だけを数え、集計を公開する。
//   2. 自由記述のご意見（500字まで）
//      → Redis にためるだけで、どこにも公開しない。
//
// 公開のコメント欄にしない理由: 荒らしや誹謗中傷の書き込みを誰かが見張って消す必要があり、
// 低メンテ運用（次に触るのは2027年1月下旬）と両立しないため。
//
// 集計は回答が POLL_MIN_TO_SHOW 件たまるまで返さない。件数が少ないうちに「回答 2件」のような
// 数字を見せると、協力金の「累計 ¥0」と同じく、誰も来ていないことの証明になってしまう。
//
// 個人情報は持たない。名前もメールアドレスも聞かず、IPアドレスは保存しない
// （連投防止のために、ハッシュ化した値を短時間だけキーに使う）。
//
// ご意見の読み方: Redis の feedback:comments（新しい順のリスト）。

import crypto from "crypto";
import { Redis } from "@upstash/redis";
import { applyRestrictedCors, getClientIp } from "./_security.js";

// 選択肢。順番は表示順（短い → 長い → 来ない）。キーは集計のフィールド名になるので変えない。
export const POLL_CHOICES = ["u5", "5to10", "10to20", "o20", "never"];

export const KEYS = {
  poll: "feedback:poll",                      // hash: 選択肢 → 件数（累計）
  pollMonth: (ym) => `feedback:poll:${ym}`,   // hash: 月ごとの件数（後で推移を見るため）
  voted: (id) => `feedback:voted:${id}`,      // 同じ送信元の二重回答を防ぐ（24時間）
  rate: (id) => `feedback:rate:${id}`,        // ご意見の連投を防ぐ（1時間）
  dayCount: (ymd) => `feedback:day:${ymd}`,   // ご意見の1日の総数
  comments: "feedback:comments",              // list: ご意見（新しい順）
};

export const SETTINGS = {
  pollMinToShow: 20,        // 集計を公開する最低回答数
  voteLockSeconds: 86400,   // 同じ送信元は24時間に1回答
  commentMaxLength: 500,
  commentPerHour: 3,        // 同じ送信元からのご意見は1時間に3件まで
  commentPerDay: 200,       // 全体で1日200件まで（Redis の無料枠を守る）
  commentsKeep: 1000,       // 古いものから捨てる
};

const LANGS = new Set(["ja", "en", "de", "fr", "zh"]);

// 送信元を表す短い識別子。IPアドレスそのものは Redis に残さない。
export function senderId(ip, pepper = "") {
  return crypto.createHash("sha256").update(`${pepper}:${ip}`).digest("hex").slice(0, 24);
}

// 制御文字を落とし、改行を整え、前後の空白を取る。HTMLとしては解釈しない前提（表示時は textContent）。
export function cleanComment(raw) {
  if (typeof raw !== "string") return "";
  return raw
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// 公開してよい形の集計を作る。件数が足りないうちは中身を返さない。
export function publicPoll(hash, min = SETTINGS.pollMinToShow) {
  const counts = {};
  let total = 0;
  for (const c of POLL_CHOICES) {
    const n = Math.max(0, parseInt((hash && hash[c]) ?? 0, 10) || 0);
    counts[c] = n;
    total += n;
  }
  if (total < min) return { ready: false };
  return { ready: true, total, counts };
}

export async function readPoll(redis) {
  return publicPoll(await redis.hgetall(KEYS.poll));
}

// ワンタップの回答を1件数える。同じ送信元の2回目は数えずに、集計だけ返す。
export async function recordVote(redis, { choice, sender, now = new Date() }) {
  if (!POLL_CHOICES.includes(choice)) return { ok: false, status: 400, error: "invalid choice" };
  const first = await redis.set(KEYS.voted(sender), "1", { nx: true, ex: SETTINGS.voteLockSeconds });
  if (first) {
    await redis.hincrby(KEYS.poll, choice, 1);
    await redis.hincrby(KEYS.pollMonth(now.toISOString().slice(0, 7)), choice, 1);
  }
  return { ok: true, counted: Boolean(first), poll: await readPoll(redis) };
}

// ご意見を1件ためる。
export async function recordComment(redis, { text, lang, choice, trap, sender, now = new Date() }) {
  // 人には見えない入力欄が埋まっていたら自動投稿とみなす。受け付けたふりをして捨てる。
  if (trap) return { ok: true, stored: false };

  const body = cleanComment(text);
  if (!body) return { ok: false, status: 400, error: "empty" };
  if ([...body].length > SETTINGS.commentMaxLength) return { ok: false, status: 400, error: "too long" };

  const perSender = await redis.incr(KEYS.rate(sender));
  if (perSender === 1) await redis.expire(KEYS.rate(sender), 3600);
  if (perSender > SETTINGS.commentPerHour) return { ok: false, status: 429, error: "rate limited" };

  const dayKey = KEYS.dayCount(now.toISOString().slice(0, 10));
  const perDay = await redis.incr(dayKey);
  if (perDay === 1) await redis.expire(dayKey, 2 * 86400);
  if (perDay > SETTINGS.commentPerDay) return { ok: false, status: 429, error: "daily limit" };

  const entry = {
    at: now.toISOString(),
    lang: LANGS.has(lang) ? lang : "?",
    text: body,
    ...(POLL_CHOICES.includes(choice) ? { choice } : {}),
  };
  await redis.lpush(KEYS.comments, JSON.stringify(entry));
  await redis.ltrim(KEYS.comments, 0, SETTINGS.commentsKeep - 1);
  return { ok: true, stored: true };
}

export default async function handler(req, res) {
  applyRestrictedCors(req, res, "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) {
    console.error("feedback: Redis not configured");
    return res.status(500).json({ error: "Service unavailable" });
  }
  const redis = new Redis({ url, token });

  try {
    if (req.method === "GET") {
      res.setHeader("Cache-Control", "public, max-age=0, s-maxage=60");
      return res.status(200).json({ ok: true, poll: await readPoll(redis) });
    }

    const body = req.body && typeof req.body === "object" ? req.body : {};
    const sender = senderId(getClientIp(req), token);

    if (body.kind === "poll") {
      const r = await recordVote(redis, { choice: body.choice, sender });
      if (!r.ok) return res.status(r.status).json({ error: r.error });
      return res.status(200).json({ ok: true, poll: r.poll });
    }

    if (body.kind === "comment") {
      const r = await recordComment(redis, {
        text: body.text, lang: body.lang, choice: body.choice, trap: body.website, sender,
      });
      if (!r.ok) return res.status(r.status).json({ error: r.error });
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: "invalid kind" });
  } catch (err) {
    // err.message には Redis の接続情報が含まれ得るため、クライアントには返さない
    console.error("feedback error:", err);
    return res.status(500).json({ error: "Service unavailable" });
  }
}
