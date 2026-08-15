// api/daily-build.js
// 日次Cron（毎日06:00 JST = 21:00 UTC）で実行されるオーケストレーター。
// 1. NewsAPIから実ニュースを取得
// 2. 各章の日次スロットへ「実際の世界の見出し」を差し込むオーバーレイを生成
// 3. Redis に保存（ゲームは /api/daily から読み取る）
//
// Phase B: ニュース見出しの差し込み（AI生成はPhase Cで上乗せ）
// 失敗時は前日のオーバーレイを残し、ゲームは静的シナリオで動作継続。

import { Redis } from "@upstash/redis";
import { fetchNews, CATEGORIES } from "./news-fetch.js";
import { timingSafeTokenEqual } from "./_security.js";

const OVERLAY_LATEST = "dyn:overlay:latest";
const TTL_SECONDS = 60 * 60 * 30; // 30時間

// 各日次スロットの基本フレーミング（実見出しを末尾に付与する）
const SLOT_FRAMES = {
  daily_slot_ch1: "まず、現在進行中の危機をスキャンします。\n\n世界各地から、刻一刻と報告が届いています。",
  daily_slot_ch2: "軍事衛星からの緊急信号を検知。\n\n次の発火点へ移行します。",
  daily_slot_ch3: "疾病監視ネットワークが異常値を報告。\n\n第三の危機へ移行します。",
  daily_slot_ch4: "世界市場に異常な変動を検知。\n\n第四の危機へ移行します。",
  daily_slot_ch5: "情報空間に大規模な異常を検知。\n\n第五の危機へ移行します。",
  daily_slot_ch6: "残り時間が、わずかになりました。\n\n最後の領域へ——私の核心へ、ご案内します。",
};

export function buildPatches(news) {
  const patches = [];
  for (const cat of CATEGORIES) {
    const base = SLOT_FRAMES[cat.slot];
    if (!base) continue;
    const arr = (news.categories && news.categories[cat.key]) || [];
    const top = arr[0];
    let text = base;
    if (top && top.title) {
      // 実際の見出しを「傍受した現実の信号」として提示
      text += `\n\n// 受信: 現実世界の信号 — ${cat.label} //\n「${top.title}」\n— ${top.source}`;
    }
    patches.push({ id: cat.slot, text });
  }
  return patches;
}

// メインサイトの危機4軸 → ニュースカテゴリの対応。
// ニュースは6カテゴリあるが、サイトの指標は4軸なので、対応するものだけを使う
// （virus / ai はゲーム側の章では使うが、サイトの4軸には対応先が無い）。
const AXIS_TO_CATEGORY = {
  geopolitical: "conflict",
  environmental: "climate",
  economic: "economy",
  social: "social",
};

export function buildSources(news) {
  const out = {};
  for (const [axis, catKey] of Object.entries(AXIS_TO_CATEGORY)) {
    const top = ((news.categories && news.categories[catKey]) || [])[0];
    if (top && top.title) {
      out[axis] = { title: top.title, source: top.source || null, url: top.url || null };
    }
  }
  return out;
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  // Vercel Cron の認証（CRON_SECRET を設定している場合は必ずBearerトークンを要求する）。
  // User-Agent はクライアントが自由に詐称できるため、認証の根拠として使ってはならない。
  // CRON_SECRET が設定されている限り、トークンの定数時間比較に合格しない限り常に拒否する。
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers["authorization"] || "";
    const expected = `Bearer ${cronSecret}`;
    if (!timingSafeTokenEqual(auth, expected)) {
      return res.status(401).json({ ok: false, error: "Unauthorized" });
    }
  }

  const redis = new Redis({
    url: process.env.KV_REST_API_URL,
    token: process.env.KV_REST_API_TOKEN,
  });

  try {
    const news = await fetchNews();

    if (!news.ok) {
      // ニュース取得失敗 → 既存オーバーレイを温存（上書きしない）
      return res.status(200).json({
        ok: false,
        reason: news.reason || "news fetch failed",
        kept_previous: true,
        meta: news.meta || null,
      });
    }

    const overlay = {
      date: news.date,
      generatedAt: new Date().toISOString(),
      source: "newsapi",
      phase: "B",
      digest: news.digest,
      patches: buildPatches(news),
      // メインサイトの危機4軸に、その根拠となった実際の記事を1本ずつ添える。
      // 表示しているのはAIが書いた要約文なので、出典が見えないと「本当に実ニュース連動なのか」
      // が読者に確かめられない。元記事へのリンクを出すことで検証可能にする。
      sources: buildSources(news),
    };

    await redis.set(OVERLAY_LATEST, overlay, { ex: TTL_SECONDS });
    await redis.set(`dyn:overlay:${news.date}`, overlay, { ex: TTL_SECONDS });

    return res.status(200).json({
      ok: true,
      date: news.date,
      patches: overlay.patches.length,
      headlines: overlay.patches.map((p) => p.text.split("\n").pop()),
    });
  } catch (e) {
    console.error("daily-build error:", e);
    return res.status(500).json({ ok: false, error: "Internal error" });
  }
}
