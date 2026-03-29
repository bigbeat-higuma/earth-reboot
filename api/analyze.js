// api/analyze.js — 脅威根拠データ付き版

import { Redis } from "@upstash/redis";

const CACHE_DURATION_MS = 6 * 60 * 60 * 1000;
const RETRY_WAIT_MS = 60 * 1000;

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

  if (!forceRefresh) {
    try {
      const cached = await redis.get("analysis_cache");
      if (cached && (now - new Date(cached.analyzed_at).getTime()) < CACHE_DURATION_MS) {
        const ageMinutes = Math.floor((now - new Date(cached.analyzed_at).getTime()) / 60000);
        return res.status(200).json({
          ...cached, cached: true, cache_age_minutes: ageMinutes,
          next_update_minutes: Math.ceil((CACHE_DURATION_MS - (now - new Date(cached.analyzed_at).getTime())) / 60000),
        });
      }
    } catch (e) { console.log("Cache read error:", e.message); }
  }

  try {
    const rateLimitUntil = await redis.get("rate_limit_until");
    if (rateLimitUntil && now < parseInt(rateLimitUntil)) {
      const waitSecs = Math.ceil((parseInt(rateLimitUntil) - now) / 1000);
      const cached = await redis.get("analysis_cache");
      if (cached) return res.status(200).json({ ...cached, cached: true, rate_limited: true, next_update_minutes: waitSecs });
      return res.status(200).json(getFallback(waitSecs));
    }
  } catch (e) { console.log("Rate limit check error:", e.message); }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "API key not configured" });

  const today = new Date();
  const dateStr = `${today.getFullYear()}年${String(today.getMonth()+1).padStart(2,"0")}月${String(today.getDate()).padStart(2,"0")}日`;

  const prompt = `あなたは「地球再起動システム」の解析AIです。
今日は${dateStr}です。

現在の世界情勢を総合評価し、以下のJSONのみを返してください。
HTMLタグ・引用タグ・Markdownは一切含めないこと。すべて純粋なテキストで記述。

{
  "reboot_years_from_now": <0.5〜50の数値>,
  "summary_jp": "<ホラー・終末感のある文体で200字程度の日本語>",
  "threats": {
    "geopolitical": <0〜100の整数>,
    "environmental": <0〜100の整数>,
    "economic": <0〜100の整数>,
    "social": <0〜100の整数>
  },
  "threat_evidence": {
    "geopolitical": ["<根拠1（40字以内）>", "<根拠2>", "<根拠3>"],
    "environmental": ["<根拠1（40字以内）>", "<根拠2>", "<根拠3>"],
    "economic":      ["<根拠1（40字以内）>", "<根拠2>", "<根拠3>"],
    "social":        ["<根拠1（40字以内）>", "<根拠2>", "<根拠3>"]
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
        max_tokens: 1200,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("Anthropic API error:", errText);
      if (errText.includes("rate_limit_error")) {
        try { await redis.set("rate_limit_until", String(now + RETRY_WAIT_MS)); } catch(e){}
      }
      try {
        const cached = await redis.get("analysis_cache");
        if (cached) return res.status(200).json({ ...cached, cached: true, fallback: true });
      } catch(e){}
      return res.status(200).json(getFallback(60));
    }

    const data = await response.json();
    const text = (data.content || []).filter(b => b.type === "text").map(b => b.text).join("");
    const clean = text.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(clean);

    // タグ除去
    if (parsed.summary_jp) parsed.summary_jp = removeTags(parsed.summary_jp);
    if (parsed.key_factors) parsed.key_factors = parsed.key_factors.map(f => removeTags(f));
    if (parsed.threat_evidence) {
      Object.keys(parsed.threat_evidence).forEach(k => {
        parsed.threat_evidence[k] = parsed.threat_evidence[k].map(e => removeTags(e));
      });
    }

    const result = {
      ...parsed,
      analyzed_at: new Date().toISOString(),
      cached: false,
      cache_age_minutes: 0,
      next_update_minutes: Math.ceil(CACHE_DURATION_MS / 60000),
    };

    try { await redis.set("analysis_cache", result); } catch(e){}
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

function removeTags(str) {
  if (!str) return str;
  return str.replace(/<cite[^>]*>.*?<\/cite>/gi, "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

function getFallback(nextMinutes) {
  return {
    reboot_years_from_now: 7.3,
    summary_jp: "解析システムが一時的に過負荷状態にあります。しかし地球のカウントダウンは止まらない。システムは間もなく復旧します。",
    threats: { geopolitical: 72, environmental: 68, economic: 61, social: 55 },
    threat_evidence: {
      geopolitical: ["データ取得中...", "データ取得中...", "データ取得中..."],
      environmental: ["データ取得中...", "データ取得中...", "データ取得中..."],
      economic: ["データ取得中...", "データ取得中...", "データ取得中..."],
      social: ["データ取得中...", "データ取得中...", "データ取得中..."],
    },
    key_factors: ["システム過負荷", "解析一時停止中", "間もなく復旧"],
    analyzed_at: new Date().toISOString(),
    cached: true,
    cache_age_minutes: 0,
    next_update_minutes: nextMinutes,
    fallback: true,
  };
}
