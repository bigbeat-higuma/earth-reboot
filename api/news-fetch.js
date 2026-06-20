// api/news-fetch.js
// NewsAPI から6カテゴリの実ニュースを取得し、ゲーム用ダイジェストに整形する。
// - fetchNews(): daily-build から呼ばれるコア関数
// - default handler: 単体テスト/手動確認用（GET /api/news-fetch）

// 章テーマ → NewsAPI 検索クエリ・対応する日次スロット
export const CATEGORIES = [
  { key: "climate",  slot: "daily_slot_ch1", label: "環境",   theme: "環境危機",   q: '(climate OR flooding OR drought OR wildfire OR heatwave OR "extreme weather")' },
  { key: "conflict", slot: "daily_slot_ch2", label: "紛争",   theme: "国際紛争",   q: '(war OR military OR nuclear OR ceasefire OR sanctions OR conflict)' },
  { key: "virus",    slot: "daily_slot_ch3", label: "感染症", theme: "感染症",     q: '(outbreak OR pandemic OR virus OR vaccine OR WHO OR infection)' },
  { key: "economy",  slot: "daily_slot_ch4", label: "経済",   theme: "経済不安",   q: '(inflation OR recession OR "stock market" OR bankruptcy OR debt OR unemployment)' },
  { key: "social",   slot: "daily_slot_ch5", label: "社会",   theme: "社会分断",   q: '(protest OR "social unrest" OR misinformation OR election OR riot)' },
  { key: "ai",       slot: "daily_slot_ch6", label: "AI",     theme: "AIの台頭",   q: '("artificial intelligence" OR "AI regulation" OR automation OR "machine learning" OR robot)' },
];

function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

function todayStr() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
}

// 1カテゴリ分のニュースを取得
async function fetchCategory(cat, apiKey) {
  const url = `https://newsapi.org/v2/everything?q=${encodeURIComponent(cat.q)}&language=en&sortBy=publishedAt&pageSize=5`;
  try {
    const res = await fetch(url, { headers: { "X-Api-Key": apiKey, "User-Agent": "earth-reboot/1.0" } });
    if (!res.ok) {
      return { key: cat.key, ok: false, status: res.status, articles: [] };
    }
    const data = await res.json();
    const articles = (data.articles || [])
      .filter((a) => a && a.title && a.title !== "[Removed]")
      .slice(0, 5)
      .map((a) => ({
        title: a.title.trim(),
        source: (a.source && a.source.name) || "Unknown",
        publishedAt: a.publishedAt || null,
        description: (a.description || "").trim().slice(0, 200),
      }));
    return { key: cat.key, ok: true, articles };
  } catch (e) {
    return { key: cat.key, ok: false, error: String(e), articles: [] };
  }
}

// 全カテゴリを並列取得し、ダイジェストを構築
export async function fetchNews() {
  const apiKey = process.env.NEWSAPI_KEY;
  if (!apiKey) {
    return { ok: false, reason: "NEWSAPI_KEY not configured", date: todayStr(), categories: {}, digest: {} };
  }

  const results = await Promise.all(CATEGORIES.map((c) => fetchCategory(c, apiKey)));

  const categories = {};
  const digest = {};
  let anyOk = false;

  results.forEach((r, i) => {
    const cat = CATEGORIES[i];
    categories[cat.key] = r.articles;
    if (r.ok && r.articles.length > 0) anyOk = true;
    // 簡易スコア: 記事数とタイトル中の強い語の出現で 30〜95 にマップ（Phase Cのプロンプト材料）
    const strongWords = /(crisis|war|nuclear|collapse|deadly|emergency|record|surge|warn|killed|outbreak)/i;
    const hits = r.articles.reduce((n, a) => n + (strongWords.test(a.title) ? 1 : 0), 0);
    digest[cat.key + "_score"] = clamp(45 + r.articles.length * 4 + hits * 5, 30, 95);
  });

  // 全カテゴリの代表見出しを3件
  const top3 = [];
  for (const cat of CATEGORIES) {
    const arr = categories[cat.key];
    if (arr && arr[0]) top3.push(arr[0].title);
    if (top3.length >= 3) break;
  }
  digest.top3_headlines = top3;

  return {
    ok: anyOk,
    date: todayStr(),
    fetchedAt: new Date().toISOString(),
    categories,
    digest,
    meta: results.map((r) => ({ key: r.key, ok: r.ok, count: r.articles.length, status: r.status })),
  };
}

// 手動確認用ハンドラ
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") return res.status(200).end();
  try {
    const news = await fetchNews();
    return res.status(200).json(news);
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e) });
  }
}
