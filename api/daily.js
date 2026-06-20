// api/daily.js
// ゲーム(game.html)が起動時に呼ぶ軽量エンドポイント。
// Redis から当日の動的オーバーレイ（patches/scenes/choices）を返す。
// データが無ければ {} を返し、ゲームは静的シナリオで動作する。

import { Redis } from "@upstash/redis";

const OVERLAY_LATEST = "dyn:overlay:latest";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  // クライアント側は no-store で取得するが、CDN/エッジでは短時間キャッシュ可
  res.setHeader("Cache-Control", "public, max-age=300, s-maxage=300");
  if (req.method === "OPTIONS") return res.status(200).end();

  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) {
    return res.status(200).json({}); // 未設定でもゲームを壊さない
  }

  try {
    const redis = new Redis({ url, token });
    const overlay = await redis.get(OVERLAY_LATEST);
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
    return res.status(200).json({}); // 失敗してもゲームは静的で続行
  }
}
