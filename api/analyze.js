// api/analyze.js — Vercel Serverless Function
// 6時間キャッシュ + レート制限対策 + フォールバック付き

import { Redis } from "@upstash/redis";

const CACHE_DURATION_MS = 6 * 60 * 60 * 1000; // 6時間
const RETRY_WAIT_MS = 60 * 1000; // エラー後1分間は再試行しない

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const forceRefresh = req.query.refresh === "1";
  const now = Date.now();

  const redis = new Redis({
    url: process.env.KV_REST_API_URL,
    token: process.env.KV_REST_API_TOKEN,
  });

  // キャッシュチェック
  if (!forceRefresh) {
    try {
      const cached = await redis.get("analysis_cache");
      if (cached && (now - new Date(cached.analyzed_at).getTime()) < CACHE_DURATION_MS) {
        const ageMinutes = Math.floor((now - new Date(cached.analyzed_at).getTime()) / 60000);
        return res.status(200).json({
          ...cached,
          cached: true,
          cache_age_minutes: ageMinutes,
          next_update_minutes: Math.ceil((CACHE_DURATION_MS - (now - new Date(cached.analyzed_at).getTime())) / 60000),
        });
      }
    } catch (e) {
      console.log("Cache read error:", e.message);
    }
  }

  // レート制限中かチェック（エラー後1分間は試行しない）
  try {
    const rateLimitUntil = await redis.get("rate_limit_until");
    if (rateLimitUntil && now < parseInt(rateLimitUntil)) {
      const waitSecs = Math.ceil((parseInt(rateLimitUntil) - now) / 1000);
      // キャッシュがあれば返す
      const cached = await redis.get("analysis_cache");
      if (cached) {
        const ageMinutes = Math.floor((now - new Date(cached.analyzed_at).getTime()) / 60000);
        return res.status(200).json({
          ...cached,
          cached: true,
          cache_age_minutes: ageMinutes,
          next_update_minutes: waitSecs,
          rate_limited: true,
        });
      }
      // キャッシュもない場合はフォールバック
      return res.status(200).json(getFallback(waitSecs));
    }
  } catch (e) {
    console.log("Rate limit check error:", e.message);
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "API key not configured" });

  const today = new Date();
  const dateStr = `${today.getFullYear()}年${String(today.getMonth()+1).padStart(2,"0")}月${String(today.getDate()).padStart(2,"0")}日`;

  const prompt = `あなたは「地球再起動システム」の解析AIです。
今日は${dateStr}です。

現在の世界情勢（地政学的緊張、気候変動、経済不安、社会的混乱、テクノロジーリスク）を総合評価し、以下のJSONのみを返してください。
説明文やMarkdownコードブロックは一切含めないこと。

{
  "reboot_years_from_now": <0.5〜50の数値>,
  "summary_jp": "<ホラー・終末感のある文体で200字程度の日本語>",
  "threats": {
    "geopolitical": <0〜100の整数>,
    "environmental": <0〜100の整数>,
    "economic": <0〜100の整数>,
    "social": <0〜100の整数>
  },
  "key_factors": ["<主要因1（20字以内）>", "<主要因2>", "<主要因3>"]
}`;

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 800,
        // web_searchなし（トークン節約）
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("Anthropic API error:", errText);

      // レート制限エラーなら1分間待機フラグを立てる
      if (errText.includes("rate_limit_error")) {
        try { await redis.set("rate_limit_until", String(now + RETRY_WAIT_MS)); } catch(e){}
      }

      // キャッシュがあれば返す
      try {
        const cached = await redis.get("analysis_cache");
        if (cached) {
          const ageMinutes = Math.floor((now - new Date(cached.analyzed_at).getTime()) / 60000);
          return res.status(200).json({ ...cached, cached: true, cache_age_minutes: ageMinutes, fallback: true });
        }
      } catch(e){}

      return res.status(200).json(getFallback(60));
    }

    const data = await response.json();
    const text = (data.content || []).filter(b => b.type === "text").map(b => b.text).join("");
    const clean = text.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(clean);

    const result = {
      ...parsed,
      analyzed_at: new Date().toISOString(),
      cached: false,
      cache_age_minutes: 0,
      next_update_minutes: Math.ceil(CACHE_DURATION_MS / 60000),
    };

    // キャッシュ保存
    try { await redis.set("analysis_cache", result); } catch(e){}
    // レート制限フラグをクリア
    try { await redis.del("rate_limit_until"); } catch(e){}

    return res.status(200).json(result);

  } catch (err) {
    console.error("Handler error:", err);
    try {
      const cached = await redis.get("analysis_cache");
      if (cached) return res.status(200).json({ ...cached, cached: true, fallback: true });
    } catch(e){}
    return res.status(200).json(getFallback(60));
  }
}

// フォールバックデータ（APIが使えない時に返す暫定値）
function getFallback(nextMinutes) {
  return {
    reboot_years_from_now: 7.3,
    summary_jp: "解析システムが一時的に過負荷状態にあります。しかし地球のカウントダウンは止まらない。この沈黙そのものが、何かの前兆かもしれない。システムは間もなく復旧します。",
    threats: { geopolitical: 72, environmental: 68, economic: 61, social: 55 },
    key_factors: ["システム過負荷", "解析一時停止中", "間もなく復旧"],
    analyzed_at: new Date().toISOString(),
    cached: true,
    cache_age_minutes: 0,
    next_update_minutes: nextMinutes,
    fallback: true,
  };
}
