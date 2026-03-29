// api/analyze.js — Vercel Serverless Function
// APIキーはサーバー側で管理。6時間キャッシュで呼び出し回数を激減させる。
import { Redis } from "@upstash/redis";

const CACHE_DURATION_MS = 6 * 60 * 60 * 1000; // 6時間

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const forceRefresh = req.query.refresh === "1";
  const now = Date.now();

  // Upstash Redisからキャッシュを取得
  const redis = new Redis({
    url: process.env.KV_REST_API_URL,
    token: process.env.KV_REST_API_TOKEN,
  });

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

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "API key not configured" });

  const today = new Date();
  const dateStr = `${today.getFullYear()}年${String(today.getMonth()+1).padStart(2,"0")}月${String(today.getDate()).padStart(2,"0")}日`;

  const prompt = `あなたは「地球再起動システム」の解析AIです。
今日は${dateStr}です。

現在の世界情勢（地政学的緊張、気候変動、経済不安、社会的混乱、テクノロジーリスク）を総合評価し、以下のJSONのみを返してください。
説明文やMarkdownコードブロックは一切含めないこと。

{
  "reboot_years_from_now": <0.5〜50の数値。世界が危険なほど短く、安定しているほど長い>,
  "summary_jp": "<現在の世界情勢の総括コメント。ホラー・終末感のある文体で200字程度の日本語>",
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
        max_tokens: 1000,
        tools: [{ type: "web_search_20250305", name: "web_search" }],
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error("Anthropic API error:", err);
      return res.status(502).json({ error: "Upstream API error", detail: err });
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

    // Redisにキャッシュ保存
    try {
      await redis.set("analysis_cache", result);
    } catch (e) {
      console.log("Cache write error:", e.message);
    }

    return res.status(200).json(result);
  } catch (err) {
    console.error("Handler error:", err);

    // エラー時はキャッシュから返す
    try {
      const cached = await redis.get("analysis_cache");
      if (cached) return res.status(200).json({ ...cached, cached: true, fallback: true });
    } catch (e) {}

    return res.status(500).json({ error: "Analysis failed", detail: err.message });
  }
}
