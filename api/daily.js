// api/daily.js
// ゲーム(game.html)が起動時に呼ぶ軽量エンドポイント。
// Redis から当日の動的オーバーレイ（patches/scenes/choices）を返す。
// データが無ければ {} を返し、ゲームは静的シナリオで動作する。
//
// Hobbyプランの Functions 12本上限が満杯のため、以下もこのエンドポイントに相乗りさせている。
//
//   GET /api/daily?health=1
//     無人運用のための総合ヘルス。日次ニュース・AI解析・履歴の記録・X投稿のどれかが
//     止まっていれば HTTP 503 を返す（判定は _health.js）。GitHub Actions が毎日これを叩き、
//     失敗時に GitHub からメールが届く。
//
//   GET /api/daily?history=1&days=180
//     日次スナップショットの履歴（_history.js）。メインサイトの推移グラフが使う。

import { Redis } from "@upstash/redis";
import { readHistory, jstDateString, HISTORY_KEY } from "./_history.js";
import { evaluateHealth } from "./_health.js";

const OVERLAY_LATEST = "dyn:overlay:latest";
const ANALYSIS_CACHE_KEY = "analysis_cache_ja";
const X_LAST_POST_AT_KEY = "x:last_post_at";

const isOn = (v) => v === "1" || v === "true";

async function handleHealth(redis, res) {
  const [overlay, analysis, historyDates, xLastPostAt] = await Promise.all([
    redis.get(OVERLAY_LATEST),
    redis.get(ANALYSIS_CACHE_KEY),
    redis.hkeys(HISTORY_KEY),
    redis.get(X_LAST_POST_AT_KEY),
  ]);
  const historyLatest = Array.isArray(historyDates) && historyDates.length ? historyDates.slice().sort().pop() : null;
  const health = evaluateHealth({
    overlay,
    analysis,
    historyLatest,
    xLastPostAt: xLastPostAt ? String(xLastPostAt) : null,
    xEnabled: Boolean(process.env.X_API_KEY && process.env.X_ACCESS_TOKEN),
    todayJst: jstDateString(),
    now: Date.now(),
  });
  return res.status(health.ok ? 200 : 503).json(health);
}

async function handleHistory(redis, req, res) {
  const days = Math.max(1, Math.min(730, parseInt(req.query.days, 10) || 180));
  const rows = await readHistory(redis, days);
  return res.status(200).json({
    count: rows.length,
    from: rows.length ? rows[0].date : null,
    to: rows.length ? rows[rows.length - 1].date : null,
    days: rows,
  });
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  const isHealth = req.query && isOn(req.query.health);
  const isHistory = req.query && isOn(req.query.history);

  if (isHealth) {
    res.setHeader("Cache-Control", "no-store");
  } else if (isHistory) {
    // 1日1件しか増えないので長めにキャッシュしてよい
    res.setHeader("Cache-Control", "public, max-age=600, s-maxage=600");
  } else {
    // クライアント側は no-store で取得するが、CDN/エッジでは短時間キャッシュ可
    res.setHeader("Cache-Control", "public, max-age=300, s-maxage=300");
  }
  if (req.method === "OPTIONS") return res.status(200).end();

  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) {
    if (isHealth) {
      return res.status(503).json({ ok: false, failed: ["config"], reason: "KV_REST_API_* が未設定です" });
    }
    if (isHistory) return res.status(200).json({ count: 0, from: null, to: null, days: [] });
    return res.status(200).json({}); // 未設定でもゲームを壊さない
  }

  try {
    const redis = new Redis({ url, token });

    if (isHealth) return await handleHealth(redis, res);
    if (isHistory) return await handleHistory(redis, req, res);

    const overlay = await redis.get(OVERLAY_LATEST);
    if (!overlay || typeof overlay !== "object") {
      return res.status(200).json({});
    }
    // game.html の applyDynamicOverlay が解釈する形 { scenes?, patches?, choices?, digest? }
    // digest はカテゴリ別の危機スコア（30〜95）。ゲーム側で章ごとの背景の色調に反映する。
    return res.status(200).json({
      date: overlay.date,
      patches: Array.isArray(overlay.patches) ? overlay.patches : [],
      scenes: Array.isArray(overlay.scenes) ? overlay.scenes : [],
      choices: overlay.choices && typeof overlay.choices === "object" ? overlay.choices : {},
      digest: overlay.digest && typeof overlay.digest === "object" ? overlay.digest : null,
      // メインサイトが危機の各軸の出典として表示する実際の記事
      sources: overlay.sources && typeof overlay.sources === "object" ? overlay.sources : null,
    });
  } catch (e) {
    console.error("daily endpoint error:", e);
    if (isHealth) {
      return res.status(503).json({ ok: false, failed: ["redis"], reason: "Redis 読み取りに失敗しました" });
    }
    if (isHistory) return res.status(200).json({ count: 0, from: null, to: null, days: [] });
    return res.status(200).json({}); // 失敗してもゲームは静的で続行
  }
}
