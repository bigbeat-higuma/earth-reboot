// api/daily.js
// ゲーム(game.html)が起動時に呼ぶ軽量エンドポイント。
// Redis から当日の動的オーバーレイ（patches/scenes/choices）を返す。
// データが無ければ {} を返し、ゲームは静的シナリオで動作する。
//
// GET /api/daily?health=1 は鮮度ウォッチドッグ。
// 日次Cron(daily-build)が止まるとゲーム内のニュースが古いまま気づけないため、
// オーバーレイの生成時刻を監視する。古ければ HTTP 503 を返すので、
// UptimeRobot 等の外形監視をこのURLに向ければ停止を検知できる。
// （Hobbyプランの Functions 12本上限のため、独立した /api/health は作らず相乗りさせている）

import { Redis } from "@upstash/redis";

const OVERLAY_LATEST = "dyn:overlay:latest";

// Cronは毎日21:00 UTC(=06:00 JST)。1回スキップされたら異常とみなす閾値。
const STALE_AFTER_HOURS = 30;

function buildHealth(overlay) {
  if (!overlay || typeof overlay !== "object") {
    return { ok: false, status: "missing", reason: "オーバーレイが存在しません（Cron未実行 or Redis空）" };
  }

  const generatedAt = overlay.generatedAt || null;
  const ageHours = generatedAt
    ? Math.round(((Date.now() - new Date(generatedAt).getTime()) / 3600000) * 10) / 10
    : null;
  const patches = Array.isArray(overlay.patches) ? overlay.patches.length : 0;
  const stale = ageHours === null || ageHours > STALE_AFTER_HOURS;

  return {
    ok: !stale && patches > 0,
    status: stale ? "stale" : patches > 0 ? "fresh" : "empty",
    date: overlay.date || null,
    generatedAt,
    ageHours,
    staleAfterHours: STALE_AFTER_HOURS,
    patches,
    source: overlay.source || null,
  };
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  const isHealth = req.query && (req.query.health === "1" || req.query.health === "true");

  if (isHealth) {
    res.setHeader("Cache-Control", "no-store");
  } else {
    // クライアント側は no-store で取得するが、CDN/エッジでは短時間キャッシュ可
    res.setHeader("Cache-Control", "public, max-age=300, s-maxage=300");
  }
  if (req.method === "OPTIONS") return res.status(200).end();

  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) {
    if (isHealth) {
      return res.status(503).json({ ok: false, status: "unconfigured", reason: "KV_REST_API_* が未設定です" });
    }
    return res.status(200).json({}); // 未設定でもゲームを壊さない
  }

  try {
    const redis = new Redis({ url, token });
    const overlay = await redis.get(OVERLAY_LATEST);

    if (isHealth) {
      const health = buildHealth(overlay);
      return res.status(health.ok ? 200 : 503).json(health);
    }

    if (!overlay || typeof overlay !== "object") {
      return res.status(200).json({});
    }
    // game.html の applyDynamicOverlay が解釈する形 { scenes?, patches?, choices? }
    return res.status(200).json({
      date: overlay.date,
      patches: Array.isArray(overlay.patches) ? overlay.patches : [],
      scenes: Array.isArray(overlay.scenes) ? overlay.scenes : [],
      choices: overlay.choices && typeof overlay.choices === "object" ? overlay.choices : {},
    });
  } catch (e) {
    console.error("daily endpoint error:", e);
    if (isHealth) {
      return res.status(503).json({ ok: false, status: "error", reason: "Redis 読み取りに失敗しました" });
    }
    return res.status(200).json({}); // 失敗してもゲームは静的で続行
  }
}
