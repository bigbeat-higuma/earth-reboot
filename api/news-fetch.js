// api/news-fetch.js
// NewsAPI から6カテゴリの実ニュースを取得し、ゲーム用ダイジェストに整形する。
// - fetchNews(): daily-build から呼ばれるコア関数
// - default handler: 単体テスト/手動確認用（GET /api/news-fetch）
//
// 注意: NewsAPI の q パラメータは単語単位のあいまい一致になりやすく、
// 曖昧な短い単語（"WHO" 等）を含めると無関係な記事が混入する。
// そのため取得後に「テーマ関連語を含むか」で再フィルタし、
// マッチしない場合はそのカテゴリを空（= その日は見出し注入なし）として扱う。
//
// フィルタは2段構え:
// - relevance: 主題語。単独でマッチすれば採用
// - weak + context: 他分野でも使われる曖昧語。context 語との共起がある場合のみ採用

// 章テーマ → NewsAPI 検索クエリ・対応する日次スロット・関連性チェック用正規表現
export const CATEGORIES = [
  {
    key: "climate", slot: "daily_slot_ch1", label: "環境", theme: "環境危機",
    q: '("climate change" OR flooding OR drought OR wildfire OR heatwave OR "extreme weather" OR "sea level")',
    relevance: /(climate|flood|drought|wildfire|heatwave|heat wave|sea level|hurricane|typhoon|cyclone|emission|warming|environment)/i,
  },
  {
    key: "conflict", slot: "daily_slot_ch2", label: "紛争", theme: "国際紛争",
    q: '(war OR "military conflict" OR nuclear OR ceasefire OR sanctions OR airstrike)',
    // 「strike」単独は労働争議と紛れるため、軍事的な言い回しに限定して拾う
    relevance: /(war|military|nuclear|ceasefire|sanction|airstrike|air strike|troops|missile|invasion|conflict|strikes? (on|against)|threaten(s|ed)? to attack)/i,
  },
  {
    key: "virus", slot: "daily_slot_ch3", label: "感染症", theme: "感染症",
    q: '(outbreak OR pandemic OR "infectious disease" OR vaccine OR "World Health Organization" OR epidemic)',
    relevance: /(outbreak|pandemic|epidemic|vaccin|infection|infectious|virus strain|world health organization|\bWHO\b\.?\s)/i,
  },
  {
    key: "economy", slot: "daily_slot_ch4", label: "経済", theme: "経済不安",
    q: '(inflation OR recession OR "stock market crash" OR bankruptcy OR "national debt" OR unemployment)',
    relevance: /(inflation|recession|stock market|bankrupt|national debt|unemployment|economic crisis|economy)/i,
  },
  {
    key: "social", slot: "daily_slot_ch5", label: "社会", theme: "社会分断",
    q: '(protest OR "social unrest" OR misinformation OR riot OR "civil unrest")',
    relevance: /(protest|unrest|riot|civil disorder|polariz)/i,
    // 「誤解を正す」系の科学・動物記事にも misinformation 等が使われるため
    // （2026-08-08: ガラガラヘビの通説を扱う記事が CH5 に混入した）、社会文脈語との共起を必須にする。
    // context に police / authorities / community のような汎用語を入れると意味がない
    // （上記の記事は "police officers ... have spread misinformation" で police に一致していた）。
    // 社会分断そのものを指す語だけに絞る。
    weak: /(misinformation|disinformation|conspiracy|rumou?rs?)/i,
    context: /(election|voter|politic|social media|propaganda|extremis|polari[sz]|far-right|far-left|hate speech|censorship|civil society)/i,
  },
  {
    key: "ai", slot: "daily_slot_ch6", label: "AI", theme: "AIの台頭",
    q: '("artificial intelligence" OR "AI regulation" OR "machine learning" OR chatbot OR "AI model")',
    relevance: /(artificial intelligence|\bAI\b|machine learning|chatbot|generative ai|ai model|ai regulation)/i,
  },
];

function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

// 記事がカテゴリのテーマにどの程度合致するかを段階で返す
//   2 = 主題語に一致（確実に該当）
//   1 = 曖昧語＋文脈語に一致（該当の可能性が高いが確証はない）
//   0 = 不一致
export function relevanceTier(cat, article) {
  const text = `${article.title || ""} ${article.description || ""}`;
  if (cat.relevance.test(text)) return 2;
  if (cat.weak && cat.weak.test(text) && cat.context.test(text)) return 1;
  return 0;
}

export function isRelevant(cat, article) {
  return relevanceTier(cat, article) > 0;
}

function todayStr() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
}

// 1カテゴリ分のニュースを取得し、関連性フィルタを通したものだけ残す
async function fetchCategory(cat, apiKey) {
  const url = `https://newsapi.org/v2/everything?q=${encodeURIComponent(cat.q)}&language=en&sortBy=relevancy&pageSize=10`;
  try {
    const res = await fetch(url, { headers: { "X-Api-Key": apiKey, "User-Agent": "earth-reboot/1.0" } });
    if (!res.ok) {
      return { key: cat.key, ok: false, status: res.status, articles: [] };
    }
    const data = await res.json();
    const all = (data.articles || []).filter((a) => a && a.title && a.title !== "[Removed]");

    // 関連性フィルタ: タイトル+概要にテーマ語を含むものだけ採用。
    // 各章のスロットには先頭1件だけが使われるため、曖昧語で拾った記事が1位に来ると
    // 後続に本物の記事があってもスロットが汚染される。主題語に一致した記事を前に出す。
    // sort は安定なので、同じ段階の中では NewsAPI の relevancy 順が保たれる。
    const relevant = all
      .map((a) => ({ a, tier: relevanceTier(cat, a) }))
      .filter((x) => x.tier > 0)
      .sort((x, y) => y.tier - x.tier)
      .map((x) => x.a);

    const articles = relevant.slice(0, 5).map((a) => ({
      title: a.title.trim(),
      source: (a.source && a.source.name) || "Unknown",
      // url はメインサイトで出典リンクとして使う（AI要約だけでなく元記事を辿れるようにする）
      url: a.url || null,
      publishedAt: a.publishedAt || null,
      description: (a.description || "").trim().slice(0, 200),
    }));
    return { key: cat.key, ok: true, articles, rawCount: all.length, filteredOutCount: all.length - relevant.length };
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

  // 全カテゴリの代表見出しを3件（関連性フィルタを通過したものから）
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
    meta: results.map((r) => ({
      key: r.key, ok: r.ok, count: r.articles.length, status: r.status,
      rawCount: r.rawCount, filteredOutCount: r.filteredOutCount,
    })),
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
