// api/donate.js — Stripeの決済セッションを作成する
// 運営協力金（サーバー・API利用料等）の金額を受け取り、Stripe Checkoutページへリダイレクト
// 注: 寄付による再起動カウントダウンの延命機能は廃止済み（カウントダウンは実ニュース連動）
//
// レート制限: Upstash Redisを使い、IPごとに1分間5回までのCheckoutセッション作成を許可する。
// これにより、高速リクエストによるStripe API枯渇・Redisへのスパムセッション作成・
// サーバーレス関数のリソース枯渇（DoS）を防ぐ。

import { Redis } from "@upstash/redis";
import { applyRestrictedCors, getClientIp } from "./_security.js";

const RATE_LIMIT_WINDOW_SECONDS = 60; // 1分間
const RATE_LIMIT_MAX_REQUESTS = 5;    // 最大5回/IP/分

async function checkRateLimit(req) {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) return { allowed: true }; // Redis未設定時はレート制限をスキップ（機能を壊さない）

  const redis = new Redis({ url, token });
  const ip = getClientIp(req);
  const key = `ratelimit:donate:${ip}`;

  const count = await redis.incr(key);
  if (count === 1) {
    await redis.expire(key, RATE_LIMIT_WINDOW_SECONDS);
  }
  return { allowed: count <= RATE_LIMIT_MAX_REQUESTS };
}

export default async function handler(req, res) {
  applyRestrictedCors(req, res, "POST, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) {
    console.error("Donate handler: Stripe not configured");
    return res.status(500).json({ error: "Service unavailable" });
  }

  const { amount } = req.body || {}; // 円単位（例: 500）
  if (!amount || amount < 100 || amount > 100000) {
    return res.status(400).json({ error: "金額は100円〜100,000円の範囲で指定してください" });
  }

  try {
    const rate = await checkRateLimit(req);
    if (!rate.allowed) {
      return res.status(429).json({ error: "リクエストが多すぎます。しばらく待ってから再度お試しください" });
    }
  } catch (err) {
    // レート制限チェック自体の失敗は寄付フローを止めない（フェイルオープン）が、ログには残す
    console.error("Donate handler: rate limit check failed:", err);
  }

  try {
    const origin = req.headers.origin || `https://${req.headers.host}`;

    const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${stripeKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        "payment_method_types[]": "card",
        "line_items[0][price_data][currency]": "jpy",
        "line_items[0][price_data][product_data][name]": "地球再起動時間 — 運営協力金",
        "line_items[0][price_data][product_data][description]": "サーバー運営費・API利用料等の運営協力金としてご活用させていただきます",
        "line_items[0][price_data][unit_amount]": String(amount),
        "line_items[0][quantity]": "1",
        "mode": "payment",
        "success_url": `${origin}/?donated=1&amount=${amount}`,
        "cancel_url": `${origin}/?donated=0`,
        "metadata[amount_jpy]": String(amount),
        "submit_type": "donate",
      }),
    });

    if (!response.ok) {
      const err = await response.json();
      console.error("Stripe error:", err);
      return res.status(502).json({ error: "Payment service unavailable" });
    }

    const session = await response.json();
    return res.status(200).json({ url: session.url });

  } catch (err) {
    console.error("Donate handler error:", err);
    return res.status(500).json({ error: "Service unavailable" });
  }
}
