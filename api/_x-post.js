// api/_x-post.js — X(Twitter)への自動投稿
//
// 目的: 「毎日、実ニュース連動でカウントダウンが動く」というこのプロジェクト固有の価値を
// 手作業なしで発信し続ける。SNS発信は2度（7/6、8/2）手動運用のまま停止しているため、
// 定期投稿だけは仕組みで回す。
//
// 呼び出し元: api/notify.js の日次Cron（09:00 UTC = 18:00 JST）。
// ファイル名を "_" で始めているのは Vercel の Serverless Function として数えさせないため
// （Hobbyプランの12本上限が満杯のため、新規エンドポイントは作れない）。
//
// 必要な環境変数（未設定なら何もせずスキップする）:
//   X_API_KEY / X_API_SECRET             … アプリの Consumer Key / Secret
//   X_ACCESS_TOKEN / X_ACCESS_TOKEN_SECRET … アカウントの Access Token / Secret
//
// ⚠️ 投稿本文に URL を入れないこと（2026-08-10 決定）。理由は2つ:
//   1. コスト: X API は従量課金で、"Post: Create" $0.015/件 に対し
//      "Post: Create (with URL)" は $0.200/件 と 13倍になる（無料枠は存在しない）
//   2. リーチ: X は外部リンクを含む投稿の表示を抑制する傾向がある
// サイトへの導線はプロフィール欄のリンクと固定ツイートで担保する。
import crypto from "crypto";

const HASHTAGS = "#EarthReboot #地球再起動時間";
const MAX_WEIGHTED_LENGTH = 280;

// 投稿する曜日（JST）。0=日 1=月 … 6=土。既存の広報プラン「週2-3回」に合わせて月・水・土。
const POST_WEEKDAYS = new Set([1, 3, 6]);

// 直近に投稿した本文。同じ文面の連投を防ぐために保持する
const LAST_POST_TEXT_KEY = "x:last_post_text";

/**
 * Xの重み付き文字数を数える。日本語などは1文字=2カウント、URLはt.co短縮により一律23カウント。
 * 過去に文字数超過で投稿に失敗しているため、送信前に必ずこれで検証する。
 */
export function weightedLength(text) {
  const urls = text.match(/https?:\/\/\S+/g) || [];
  const rest = text.replace(/https?:\/\/\S+/g, "");
  let n = urls.length * 23;
  for (const ch of rest) {
    const cp = ch.codePointAt(0);
    const isLight =
      cp <= 4351 ||
      (cp >= 8192 && cp <= 8205) ||
      (cp >= 8208 && cp <= 8223) ||
      (cp >= 8242 && cp <= 8247);
    n += isLight ? 1 : 2;
  }
  return n;
}

/** JSTの曜日を返す（Vercelの実行環境はUTCなので明示的に+9時間する） */
export function jstWeekday(now = new Date()) {
  return new Date(now.getTime() + 9 * 3600 * 1000).getUTCDay();
}

export function shouldPostToday(now = new Date()) {
  return POST_WEEKDAYS.has(jstWeekday(now));
}

/**
 * AI解析の要約を、指定した重み付き文字数に収まるところまで文単位で切り出す。
 * 途中で切ると意味が壊れるため「。」で区切り、収まる文だけを採用する。
 */
function trimToSentences(summary, budget) {
  const sentences = String(summary || "")
    .split("。")
    .map((s) => s.trim())
    .filter(Boolean);

  let out = "";
  for (const s of sentences) {
    const candidate = out ? `${out}${s}。` : `${s}。`;
    if (weightedLength(candidate) > budget) break;
    out = candidate;
  }
  return out;
}

/**
 * 投稿本文を組み立てる。要約が1文も入らない場合は要約なしで成立する形にフォールバックする。
 * @param {{reboot_years_from_now:number, summary:string}} analysis /api/analyze のレスポンス
 */
export function composePost(analysis) {
  const years = parseFloat(analysis?.reboot_years_from_now);
  if (!Number.isFinite(years)) return null;

  const header = `地球再起動まで、残り約${years.toFixed(1)}年。`;
  const footer = HASHTAGS; // URLは入れない（冒頭のコメント参照）

  // 要約に使える残り予算（改行4つ分を含めて概算）
  const budget = MAX_WEIGHTED_LENGTH - weightedLength(`${header}\n\n\n\n${footer}`);
  const body = trimToSentences(analysis?.summary, budget);

  const text = body ? `${header}\n\n${body}\n\n${footer}` : `${header}\n\n${footer}`;
  return weightedLength(text) <= MAX_WEIGHTED_LENGTH ? text : null;
}

// --- OAuth 1.0a（X API v2 の POST /2/tweets はユーザーコンテキスト認証が必要） ---

function pct(s) {
  return encodeURIComponent(s).replace(/[!*'()]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
}

function buildAuthHeader(method, url, keys) {
  const params = {
    oauth_consumer_key: keys.apiKey,
    oauth_nonce: crypto.randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: keys.accessToken,
    oauth_version: "1.0",
  };

  // JSONボディのリクエストでは、署名ベース文字列にボディを含めない
  const paramString = Object.keys(params).sort().map((k) => `${pct(k)}=${pct(params[k])}`).join("&");
  const base = [method.toUpperCase(), pct(url), pct(paramString)].join("&");
  const signingKey = `${pct(keys.apiSecret)}&${pct(keys.accessTokenSecret)}`;
  const signature = crypto.createHmac("sha1", signingKey).update(base).digest("base64");

  const all = { ...params, oauth_signature: signature };
  return "OAuth " + Object.keys(all).sort().map((k) => `${pct(k)}="${pct(all[k])}"`).join(", ");
}

function readKeys() {
  const apiKey = process.env.X_API_KEY;
  const apiSecret = process.env.X_API_SECRET;
  const accessToken = process.env.X_ACCESS_TOKEN;
  const accessTokenSecret = process.env.X_ACCESS_TOKEN_SECRET;
  if (!apiKey || !apiSecret || !accessToken || !accessTokenSecret) return null;
  return { apiKey, apiSecret, accessToken, accessTokenSecret };
}

/**
 * 日次Cronから呼ぶエントリポイント。投稿しない条件はすべて「静かにスキップ」して
 * プッシュ通知など他の処理を巻き込まないようにする。
 * @param {object} redis 呼び出し元が生成済みのUpstash Redisクライアント（重複投稿の抑止に使う）
 */
export async function postDailyUpdate(redis, analysis, now = new Date()) {
  const keys = readKeys();
  if (!keys) return { posted: false, reason: "X credentials not configured" };
  if (!shouldPostToday(now)) return { posted: false, reason: "not a posting weekday" };

  const text = composePost(analysis);
  if (!text) return { posted: false, reason: "could not compose post" };

  // 前回と一字一句同じ内容なら投稿しない（2026-08-12 の不具合への二重の備え）。
  // 本来は notify.js 側で毎回新しい解析を取りに行くことで防いでいるが、
  // 解析が何らかの理由で更新されなかったとき、同じ文面を流すのは「壊れている」ように見える。
  // 投稿を1回落とす方が害が小さいと判断し、ここで止める。
  try {
    const lastText = await redis.get(LAST_POST_TEXT_KEY);
    if (lastText === text) {
      console.error("X post: skipped — 前回と同一の文面のため（解析が更新されていない可能性）");
      return { posted: false, reason: "identical to previous post" };
    }
  } catch (e) {
    console.error("X post: last-post check failed:", e);
    // 判定できないだけなら投稿は続行する（無投稿になる方が困るため）
  }

  // 同じ日に二重投稿しない（Cronの再試行対策）
  const jstDate = new Date(now.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  const dedupeKey = `x:posted:${jstDate}`;
  try {
    const already = await redis.set(dedupeKey, text, { nx: true, ex: 60 * 60 * 48 });
    if (already === null) return { posted: false, reason: "already posted today" };
  } catch (e) {
    console.error("X post: dedupe check failed:", e);
    return { posted: false, reason: "dedupe check failed" };
  }

  const url = "https://api.twitter.com/2/tweets";
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: buildAuthHeader("POST", url, keys),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.error(`X post failed: HTTP ${res.status} ${detail.slice(0, 300)}`);
    // 失敗した日は再試行できるよう重複キーを消す
    try { await redis.del(dedupeKey); } catch (e) { /* 失敗しても投稿処理は続けない */ }
    return { posted: false, reason: `X API error ${res.status}` };
  }

  const json = await res.json().catch(() => ({}));

  // 次回の重複判定に使うため、投稿できた文面を保持する（60日）
  try {
    await redis.set(LAST_POST_TEXT_KEY, text, { ex: 60 * 60 * 24 * 60 });
  } catch (e) {
    console.error("X post: failed to record last post text:", e);
  }

  return { posted: true, id: json?.data?.id || null, weighted: weightedLength(text) };
}
