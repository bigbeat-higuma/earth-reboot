// api/analyze.js — 多言語対応版

import { Redis } from "@upstash/redis";

const CACHE_DURATION_MS = 6 * 60 * 60 * 1000;
const RETRY_WAIT_MS = 60 * 1000;

const LANG_CONFIG = {
  ja: {
    dateFormat: (d) => `${d.getFullYear()}年${String(d.getMonth()+1).padStart(2,"0")}月${String(d.getDate()).padStart(2,"0")}日`,
    prompt: (dateStr, newsDigest) => `あなたは「地球再起動システム」の解析AIです。
今日は${dateStr}です。
${newsDigest ? `\n以下は本日実際に報道された世界のニュース見出しです。これらの実際の出来事を分析の根拠として優先的に使用してください。\n${newsDigest}\n` : ""}
現在の世界情勢を総合評価し、以下のJSONのみを返してください。
HTMLタグ・引用タグ・Markdownは一切含めないこと。すべて純粋なテキストで記述。

{
  "reboot_years_from_now": <0.5〜50の数値。実際のニュースの深刻度を反映し、深刻であるほど小さく、平穏であるほど大きくしてください。ただし前回の評価から極端に飛躍せず、緩やかに変動させてください>,
  "summary": "<ホラー・終末感のある文体で200字程度の日本語>",
  "threats": {
    "geopolitical": <0〜100の整数>,
    "environmental": <0〜100の整数>,
    "economic": <0〜100の整数>,
    "social": <0〜100の整数>,
    "ai": <0〜100の整数。AIに起因するリスク（暴走・悪用・軍事利用・偽情報・雇用や産業の混乱・規制の失敗）>
  },
  "threat_evidence": {
    "geopolitical": ["<根拠1（40字以内）>", "<根拠2>", "<根拠3>"],
    "environmental": ["<根拠1（40字以内）>", "<根拠2>", "<根拠3>"],
    "economic":      ["<根拠1（40字以内）>", "<根拠2>", "<根拠3>"],
    "social":        ["<根拠1（40字以内）>", "<根拠2>", "<根拠3>"],
    "ai":        ["<根拠1（40字以内）>", "<根拠2>", "<根拠3>"]
  },
  "key_factors": ["<主要因1（20字以内）>", "<主要因2>", "<主要因3>"]
}`,
    fallbackSummary: "解析システムが一時的に過負荷状態にあります。しかし地球のカウントダウンは止まらない。システムは間もなく復旧します。",
    fallbackFactors: ["システム過負荷", "解析一時停止中", "間もなく復旧"],
    fallbackEvidence: ["データ取得中...", "データ取得中...", "データ取得中..."],
  },
  en: {
    dateFormat: (d) => `${d.toLocaleString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`,
    prompt: (dateStr, newsDigest) => `You are the AI of the "Earth Reboot System".
Today is ${dateStr}.
${newsDigest ? `\nBelow are real news headlines reported today. Use these actual events as the primary basis for your analysis.\n${newsDigest}\n` : ""}
Evaluate the current global situation and return ONLY the following JSON.
No HTML tags, no markdown, no quote tags. Pure text only.

{
  "reboot_years_from_now": <number between 0.5 and 50. Reflect the severity of the actual news above — more severe means smaller, calmer means larger. However, avoid drastic jumps from the previous assessment; vary gradually>,
  "summary": "<200-character horror/apocalyptic style text in English>",
  "threats": {
    "geopolitical": <integer 0-100>,
    "environmental": <integer 0-100>,
    "economic": <integer 0-100>,
    "social": <integer 0-100>,
    "ai": <integer 0-100. Risk originating from AI: loss of control, misuse, military use, disinformation, labor and industry disruption, regulatory failure>
  },
  "threat_evidence": {
    "geopolitical": ["<evidence 1 (under 60 chars)>", "<evidence 2>", "<evidence 3>"],
    "environmental": ["<evidence 1>", "<evidence 2>", "<evidence 3>"],
    "economic":      ["<evidence 1>", "<evidence 2>", "<evidence 3>"],
    "social":        ["<evidence 1>", "<evidence 2>", "<evidence 3>"],
    "ai":        ["<evidence 1>", "<evidence 2>", "<evidence 3>"]
  },
  "key_factors": ["<factor 1 (under 30 chars)>", "<factor 2>", "<factor 3>"]
}`,
    fallbackSummary: "Analysis system temporarily overloaded. But Earth's countdown never stops. System will recover shortly.",
    fallbackFactors: ["System overload", "Analysis paused", "Recovery soon"],
    fallbackEvidence: ["Fetching data...", "Fetching data...", "Fetching data..."],
  },
  de: {
    dateFormat: (d) => `${String(d.getDate()).padStart(2,"0")}.${String(d.getMonth()+1).padStart(2,"0")}.${d.getFullYear()}`,
    prompt: (dateStr, newsDigest) => `Du bist die KI des "Erde-Neustart-Systems".
Heute ist der ${dateStr}.
${newsDigest ? `\nNachfolgend finden Sie die heute tatsächlich gemeldeten Nachrichtenüberschriften. Verwenden Sie diese realen Ereignisse als vorrangige Grundlage für Ihre Analyse.\n${newsDigest}\n` : ""}
Bewerte die aktuelle Weltlage und gib NUR folgendes JSON zurück.
Keine HTML-Tags, kein Markdown, keine Anführungszeichen-Tags. Nur reiner Text.

{
  "reboot_years_from_now": <Zahl zwischen 0.5 und 50. Spiegle den Schweregrad der obigen tatsächlichen Nachrichten wider — schwerwiegender bedeutet kleiner, ruhiger bedeutet größer. Vermeide jedoch drastische Sprünge gegenüber der vorherigen Bewertung; variiere allmählich>,
  "summary": "<ca. 200 Zeichen langer Text im Horror-/Apokalypse-Stil auf Deutsch>",
  "threats": {
    "geopolitical": <ganze Zahl 0-100>,
    "environmental": <ganze Zahl 0-100>,
    "economic": <ganze Zahl 0-100>,
    "social": <ganze Zahl 0-100>,
    "ai": <ganze Zahl 0-100. Von KI ausgehende Risiken: Kontrollverlust, Missbrauch, militärische Nutzung, Desinformation, Umbrüche in Arbeit und Industrie, Regulierungsversagen>
  },
  "threat_evidence": {
    "geopolitical": ["<Beleg 1 (max. 60 Zeichen)>", "<Beleg 2>", "<Beleg 3>"],
    "environmental": ["<Beleg 1>", "<Beleg 2>", "<Beleg 3>"],
    "economic":      ["<Beleg 1>", "<Beleg 2>", "<Beleg 3>"],
    "social":        ["<Beleg 1>", "<Beleg 2>", "<Beleg 3>"],
    "ai":        ["<Beleg 1>", "<Beleg 2>", "<Beleg 3>"]
  },
  "key_factors": ["<Faktor 1 (max. 30 Zeichen)>", "<Faktor 2>", "<Faktor 3>"]
}`,
    fallbackSummary: "Das Analysesystem ist vorübergehend überlastet. Aber der Countdown der Erde stoppt nie. Das System wird bald wiederhergestellt.",
    fallbackFactors: ["Systemüberlastung", "Analyse pausiert", "Bald wiederhergestellt"],
    fallbackEvidence: ["Daten werden abgerufen...", "Daten werden abgerufen...", "Daten werden abgerufen..."],
  },
  fr: {
    dateFormat: (d) => `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}/${d.getFullYear()}`,
    prompt: (dateStr, newsDigest) => `Tu es l'IA du "Système de Redémarrage de la Terre".
Aujourd'hui, nous sommes le ${dateStr}.
${newsDigest ? `\nVoici les titres d'actualité réellement rapportés aujourd'hui. Utilisez ces événements réels comme base principale de votre analyse.\n${newsDigest}\n` : ""}
Évalue la situation mondiale actuelle et retourne UNIQUEMENT le JSON suivant.
Aucune balise HTML, aucun markdown, aucune balise de citation. Texte pur uniquement.

{
  "reboot_years_from_now": <nombre entre 0.5 et 50. Reflète la gravité des actualités réelles ci-dessus — plus grave signifie plus petit, plus calme signifie plus grand. Toutefois, évite les sauts brusques par rapport à l'évaluation précédente; varie progressivement>,
  "summary": "<texte d'environ 200 caractères en style horreur/apocalyptique en français>",
  "threats": {
    "geopolitical": <entier 0-100>,
    "environmental": <entier 0-100>,
    "economic": <entier 0-100>,
    "social": <entier 0-100>,
    "ai": <entier 0-100. Risques liés à l'IA : perte de contrôle, usage malveillant, usage militaire, désinformation, bouleversement de l'emploi et de l'industrie, échec de la régulation>
  },
  "threat_evidence": {
    "geopolitical": ["<preuve 1 (max. 60 caractères)>", "<preuve 2>", "<preuve 3>"],
    "environmental": ["<preuve 1>", "<preuve 2>", "<preuve 3>"],
    "economic":      ["<preuve 1>", "<preuve 2>", "<preuve 3>"],
    "social":        ["<preuve 1>", "<preuve 2>", "<preuve 3>"],
    "ai":        ["<preuve 1>", "<preuve 2>", "<preuve 3>"]
  },
  "key_factors": ["<facteur 1 (max. 30 caractères)>", "<facteur 2>", "<facteur 3>"]
}`,
    fallbackSummary: "Le système d'analyse est temporairement surchargé. Mais le compte à rebours de la Terre ne s'arrête jamais. Le système sera bientôt rétabli.",
    fallbackFactors: ["Surcharge système", "Analyse en pause", "Rétablissement imminent"],
    fallbackEvidence: ["Récupération des données...", "Récupération des données...", "Récupération des données..."],
  },
  zh: {
    dateFormat: (d) => `${d.getFullYear()}年${String(d.getMonth()+1).padStart(2,"0")}月${String(d.getDate()).padStart(2,"0")}日`,
    prompt: (dateStr, newsDigest) => `你是"地球重启系统"的分析AI。
今天是${dateStr}。
${newsDigest ? `\n以下是今天实际报道的世界新闻标题。请将这些真实事件作为分析的主要依据。\n${newsDigest}\n` : ""}
请综合评估当前全球形势，仅返回以下JSON格式内容。
不得包含HTML标签、引用标签或Markdown格式。所有内容均为纯文本。

{
  "reboot_years_from_now": <0.5到50之间的数值。反映上述真实新闻的严重程度——越严重数值越小，越平稳数值越大。但请避免与上次评估出现剧烈跳跃，应缓慢变化>,
  "summary": "<用恐怖、末日风格写约200字的中文内容>",
  "threats": {
    "geopolitical": <0到100的整数>,
    "environmental": <0到100的整数>,
    "economic": <0到100的整数>,
    "social": <0到100的整数>,
    "ai": <0到100的整数。源自AI的风险：失控、滥用、军事化、虚假信息、就业与产业冲击、监管失败>
  },
  "threat_evidence": {
    "geopolitical": ["<依据1（30字以内）>", "<依据2>", "<依据3>"],
    "environmental": ["<依据1>", "<依据2>", "<依据3>"],
    "economic":      ["<依据1>", "<依据2>", "<依据3>"],
    "social":        ["<依据1>", "<依据2>", "<依据3>"],
    "ai":        ["<依据1>", "<依据2>", "<依据3>"]
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

  // Phase B のニュースオーバーレイ（dyn:overlay:latest）を読み取り、分析の根拠に使う。
  // 存在しない/読み取り失敗時は newsDigestText="" のまま、従来通りClaudeの内部知識のみで分析する。
  let newsDigestText = "";
  try {
    const overlay = await redis.get("dyn:overlay:latest");
    if (overlay && overlay.digest) {
      newsDigestText = buildNewsDigestText(overlay.digest, overlay.date);
    }
  } catch (e) {
    console.log("News overlay read error:", e.message);
  }

  let parsed;
  try {
    parsed = await generateAnalysis({ lang, newsDigestText, apiKey });
  } catch (err) {
    console.error(err.apiError ? "Anthropic API error:" : "Handler error:", err.message);
    if (err.rateLimited) {
      try { await redis.set("rate_limit_until", String(now + RETRY_WAIT_MS)); } catch(e){}
    }
    try {
      const cached = await redis.get(cacheKey);
      if (cached) return res.status(200).json({ ...cached, cached: true, fallback: true });
    } catch(e){}
    return res.status(200).json(getFallback(60, lang));
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
}

// Claude に解析させ、整形済みの結果を返す。キャッシュには一切触れない。
// 上の handler（サイトの値）と、速報の見張り（_breaking.js）の試算の両方がこれを使う。
// 同じプロンプト・同じモデルを通すことで、試算の値をサイトの値と比べられるようにしている。
// 失敗時は例外を投げる（err.apiError: APIがエラーを返した / err.rateLimited: レート制限）。
export async function generateAnalysis({ lang = "ja", newsDigestText = "", apiKey }) {
  const config = LANG_CONFIG[lang] || LANG_CONFIG.ja;
  const prompt = config.prompt(config.dateFormat(new Date()), newsDigestText);

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      // 5軸×根拠3件に増えたぶん出力が長くなる。途中で切れると JSON.parse に失敗して
      // フォールバックに落ちるため、余裕を持たせる
      max_tokens: 1800,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    const err = new Error(errText.slice(0, 500));
    err.apiError = true;
    err.rateLimited = errText.includes("rate_limit_error");
    throw err;
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
  return parsed;
}

// Phase B の news-fetch.js が生成した digest（カテゴリ別スコア・主要見出し）を
// Claude プロンプトに埋め込むための短いテキストに整形する。
export function buildNewsDigestText(digest, date) {
  if (!digest) return "";
  const labels = { climate: "環境", conflict: "紛争", virus: "感染症", economy: "経済", social: "社会", ai: "AI" };
  const lines = [`[${date || ""}]`];
  for (const key of Object.keys(labels)) {
    const score = digest[key + "_score"];
    if (score != null) lines.push(`- ${labels[key]}スコア: ${score}/100`);
  }
  // カテゴリ別の見出し（2026-11-11〜）。以前は top3_headlines しか渡しておらず、それは
  // 先頭3カテゴリ（環境・紛争・感染症）の見出しだったため、経済・社会・AIの軸は
  // 実際の記事を一件も見ないまま採点されていた。
  if (digest.headlines && typeof digest.headlines === "object") {
    lines.push("カテゴリ別の主要見出し:");
    for (const key of Object.keys(labels)) {
      if (digest.headlines[key]) lines.push(`  • [${labels[key]}] ${digest.headlines[key]}`);
    }
  } else if (Array.isArray(digest.top3_headlines) && digest.top3_headlines.length) {
    lines.push("主要見出し:");
    digest.top3_headlines.forEach((h) => lines.push(`  • ${h}`));
  }
  return lines.join("\n");
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
    threats: { geopolitical: 72, environmental: 68, economic: 61, social: 55, ai: 60 },
    threat_evidence: {
      geopolitical: [...ev],
      environmental: [...ev],
      economic: [...ev],
      social: [...ev],
      ai: [...ev],
    },
    key_factors: config.fallbackFactors,
    analyzed_at: new Date().toISOString(),
    cached: true,
    cache_age_minutes: 0,
    next_update_minutes: nextMinutes,
    fallback: true,
  };
}
