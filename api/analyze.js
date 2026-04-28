// api/analyze.js — 多言語対応版

import { Redis } from "@upstash/redis";

const CACHE_DURATION_MS = 6 * 60 * 60 * 1000;
const RETRY_WAIT_MS = 60 * 1000;

const LANG_CONFIG = {
  ja: {
    dateFormat: (d) => `${d.getFullYear()}年${String(d.getMonth()+1).padStart(2,"0")}月${String(d.getDate()).padStart(2,"0")}日`,
    prompt: (dateStr) => `あなたは「地球再起動システム」の解析AIです。
今日は${dateStr}です。

現在の世界情勢を総合評価し、以下のJSONのみを返してください。
HTMLタグ・引用タグ・Markdownは一切含めないこと。すべて純粋なテキストで記述。

{
  "reboot_years_from_now": <0.5〜50の数値>,
  "summary": "<ホラー・終末感のある文体で200字程度の日本語>",
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
}`,
    fallbackSummary: "解析システムが一時的に過負荷状態にあります。しかし地球のカウントダウンは止まらない。システムは間もなく復旧します。",
    fallbackFactors: ["システム過負荷", "解析一時停止中", "間もなく復旧"],
    fallbackEvidence: ["データ取得中...", "データ取得中...", "データ取得中..."],
  },
  en: {
    dateFormat: (d) => `${d.toLocaleString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`,
    prompt: (dateStr) => `You are the AI of the "Earth Reboot System".
Today is ${dateStr}.

Evaluate the current global situation and return ONLY the following JSON.
No HTML tags, no markdown, no quote tags. Pure text only.

{
  "reboot_years_from_now": <number between 0.5 and 50>,
  "summary": "<200-character horror/apocalyptic style text in English>",
  "threats": {
    "geopolitical": <integer 0-100>,
    "environmental": <integer 0-100>,
    "economic": <integer 0-100>,
    "social": <integer 0-100>
  },
  "threat_evidence": {
    "geopolitical": ["<evidence 1 (under 60 chars)>", "<evidence 2>", "<evidence 3>"],
    "environmental": ["<evidence 1>", "<evidence 2>", "<evidence 3>"],
    "economic":      ["<evidence 1>", "<evidence 2>", "<evidence 3>"],
    "social":        ["<evidence 1>", "<evidence 2>", "<evidence 3>"]
  },
  "key_factors": ["<factor 1 (under 30 chars)>", "<factor 2>", "<factor 3>"]
}`,
    fallbackSummary: "Analysis system temporarily overloaded. But Earth's countdown never stops. System will recover shortly.",
    fallbackFactors: ["System overload", "Analysis paused", "Recovery soon"],
    fallbackEvidence: ["Fetching data...", "Fetching data...", "Fetching data..."],
  },
  de: {
    dateFormat: (d) => `${String(d.getDate()).padStart(2,"0")}.${String(d.getMonth()+1).padStart(2,"0")}.${d.getFullYear()}`,
    prompt: (dateStr) => `Du bist die KI des "Erde-Neustart-Systems".
Heute ist der ${dateStr}.

Bewerte die aktuelle Weltlage und gib NUR folgendes JSON zurück.
Keine HTML-Tags, kein Markdown, keine Anführungszeichen-Tags. Nur reiner Text.

{
  "reboot_years_from_now": <Zahl zwischen 0.5 und 50>,
  "summary": "<ca. 200 Zeichen langer Text im Horror-/Apokalypse-Stil auf Deutsch>",
  "threats": {
    "geopolitical": <ganze Zahl 0-100>,
    "environmental": <ganze Zahl 0-100>,
    "economic": <ganze Zahl 0-100>,
    "social": <ganze Zahl 0-100>
  },
  "threat_evidence": {
    "geopolitical": ["<Beleg 1 (max. 60 Zeichen)>", "<Beleg 2>", "<Beleg 3>"],
    "environmental": ["<Beleg 1>", "<Beleg 2>", "<Beleg 3>"],
    "economic":      ["<Beleg 1>", "<Beleg 2>", "<Beleg 3>"],
    "social":        ["<Beleg 1>", "<Beleg 2>", "<Beleg 3>"]
  },
  "key_factors": ["<Faktor 1 (max. 30 Zeichen)>", "<Faktor 2>", "<Faktor 3>"]
}`,
    fallbackSummary: "Das Analysesystem ist vorübergehend überlastet. Aber der Countdown der Erde stoppt nie. Das System wird bald wiederhergestellt.",
    fallbackFactors: ["Systemüberlastung", "Analyse pausiert", "Bald wiederhergestellt"],
    fallbackEvidence: ["Daten werden abgerufen...", "Daten werden abgerufen...", "Daten werden abgerufen..."],
  },
  fr: {
    dateFormat: (d) => `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}/${d.getFullYear()}`,
    prompt: (dateStr) => `Tu es l'IA du "Système de Redémarrage de la Terre".
Aujourd'hui, nous sommes le ${dateStr}.

Évalue la situation mondiale actuelle et retourne UNIQUEMENT le JSON suivant.
Aucune balise HTML, aucun markdown, aucune balise de citation. Texte pur uniquement.

{
  "reboot_years_from_now": <nombre entre 0.5 et 50>,
  "summary": "<texte d'environ 200 caractères en style horreur/apocalyptique en français>",
  "threats": {
    "geopolitical": <entier 0-100>,
    "environmental": <entier 0-100>,
    "economic": <entier 0-100>,
    "social": <entier 0-100>
  },
  "threat_evidence": {
    "geopolitical": ["<preuve 1 (max. 60 caractères)>", "<preuve 2>", "<preuve 3>"],
    "environmental": ["<preuve 1>", "<preuve 2>", "<preuve 3>"],
    "economic":      ["<preuve 1>", "<preuve 2>", "<preuve 3>"],
    "social":        ["<preuve 1>", "<preuve 2>", "<preuve 3>"]
  },
  "key_factors": ["<facteur 1 (max. 30 caractères)>", "<facteur 2>", "<facteur 3>"]
}`,
    fallbackSummary: "Le système d'analyse est temporairement surchargé. Mais le compte à rebours de la Terre ne s'arrête jamais. Le système sera bientôt rétabli.",
    fallbackFactors: ["Surcharge système", "Analyse en pause", "Rétablissement imminent"],
    fallbackEvidence: ["Récupération des données...", "Récupération des données...", "Récupération des données..."],
  },
  zh: {
    dateFormat: (d) => `${d.getFullYear()}年${String(d.getMonth()+1).padStart(2,"0")}月${String(d.getDate()).padStart(2,"0")}日`,
    prompt: (dateStr) => `你是"地球重启系统"的分析AI。
今天是${dateStr}。

请综合评估当前全球形势，仅返回以下JSON格式内容。
不得包含HTML标签、引用标签或Markdown格式。所有内容均为纯文本。

{
  "reboot_years_from_now": <0.5到50之间的数值>,
  "summary": "<用恐怖、末日风格写约200字的中文内容>",
  "threats": {
    "geopolitical": <0到100的整数>,
    "environmental": <0到100的整数>,
    "economic": <0到100的整数>,
    "social": <0到100的整数>
  },
  "threat_evidence": {
    "geopolitical": ["<依据1（30字以内）>", "<依据2>", "<依据3>"],
    "environmental": ["<依据1>", "<依据2>", "<依据3>"],
    "economic":      ["<依据1>", "<依据2>", "<依据3>"],
    "social":        ["<依据1>", "<依据2>", "<依据3>"]
  },
  "key_factors": ["<主要因素1（15字以内）>", "<主要因素2>", "<主要因素3>"]
}`,
    fallbackSummary: "分析系统暂时过载。但地球的倒计时从未停止。系统即将恢复。",
    fallbackFactors: ["系统过载", "分析暂停", "即将恢复"],
    fallbackEvidence: ["数据获取中...", "数据获取中...", "数据获取中..."],
  },
};

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const forceRefresh = req.query.refresh === "1";
  const lang = ["ja", "en", "de", "fr", "zh"].includes(req.query.lang) ? req.query.lang : "ja";
  const cacheKey = `analysis_cache_${lang}`;
  const now = Date.now();

  const redis = new Redis({
    url: process.env.KV_REST_API_URL,
    token: process.env.KV_REST_API_TOKEN,
  });

  if (!forceRefresh) {
    try {
      const cached = await redis.get(cacheKey);
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
      const cached = await redis.get(cacheKey);
      if (cached) return res.status(200).json({ ...cached, cached: true, rate_limited: true, next_update_minutes: waitSecs });
      return res.status(200).json(getFallback(waitSecs, lang));
    }
  } catch (e) { console.log("Rate limit check error:", e.message); }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "API key not configured" });

  const config = LANG_CONFIG[lang];
  const today = new Date();
  const dateStr = config.dateFormat(today);
  const prompt = config.prompt(dateStr);

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
        const cached = await redis.get(cacheKey);
        if (cached) return res.status(200).json({ ...cached, cached: true, fallback: true });
      } catch(e){}
      return res.status(200).json(getFallback(60, lang));
    }

    const data = await response.json();
    const text = (data.content || []).filter(b => b.type === "text").map(b => b.text).join("");
    const clean = text.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(clean);

    if (parsed.summary_jp && !parsed.summary) parsed.summary = parsed.summary_jp;
    if (parsed.summary) parsed.summary = removeTags(parsed.summary);
    if (parsed.summary_jp) parsed.summary_jp = parsed.summary;
    if (parsed.key_factors) parsed.key_factors = parsed.key_factors.map(f => removeTags(f));
    if (parsed.threat_evidence) {
      Object.keys(parsed.threat_evidence).forEach(k => {
        parsed.threat_evidence[k] = parsed.threat_evidence[k].map(e => removeTags(e));
      });
    }

    const result = {
      ...parsed,
      lang,
      analyzed_at: new Date().toISOString(),
      cached: false,
      cache_age_minutes: 0,
      next_update_minutes: Math.ceil(CACHE_DURATION_MS / 60000),
    };

    try { await redis.set(cacheKey, result); } catch(e){}
    try { await redis.del("rate_limit_until"); } catch(e){}

    return res.status(200).json(result);

  } catch (err) {
    console.error("Handler error:", err);
    try {
      const cached = await redis.get(cacheKey);
      if (cached) return res.status(200).json({ ...cached, cached: true, fallback: true });
    } catch(e){}
    return res.status(200).json(getFallback(60, lang));
  }
}

function removeTags(str) {
  if (!str) return str;
  return str.replace(/<cite[^>]*>.*?<\/cite>/gi, "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

function getFallback(nextMinutes, lang = "ja") {
  const config = LANG_CONFIG[lang] || LANG_CONFIG.ja;
  const ev = config.fallbackEvidence;
  return {
    reboot_years_from_now: 7.3,
    summary: config.fallbackSummary,
    summary_jp: config.fallbackSummary,
    lang,
    threats: { geopolitical: 72, environmental: 68, economic: 61, social: 55 },
    threat_evidence: {
      geopolitical: [...ev],
      environmental: [...ev],
      economic: [...ev],
      social: [...ev],
    },
    key_factors: config.fallbackFactors,
    analyzed_at: new Date().toISOString(),
    cached: true,
    cache_age_minutes: 0,
    next_update_minutes: nextMinutes,
    fallback: true,
  };
}
