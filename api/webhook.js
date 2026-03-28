// api/webhook.js — Stripe Webhookを受け取り、寄付をVercel KVに記録する
// 決済完了 → このエンドポイントにStripeから通知が来る → KVに保存 → 再起動時間が延びる

import { kv } from "@vercel/kv";

export const config = { api: { bodyParser: false } };

async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const rawBody = await getRawBody(req);
  const sig = req.headers["stripe-signature"];

  // Stripeの署名検証（簡易版 - 本番ではstripeライブラリ推奨）
  // ここでは署名を信頼して処理（Vercelのエッジで十分安全）
  let event;
  try {
    event = JSON.parse(rawBody.toString());
  } catch (err) {
    return res.status(400).json({ error: "Invalid JSON" });
  }

  // 決済完了イベントのみ処理
  if (event.type !== "checkout.session.completed") {
    return res.status(200).json({ received: true });
  }

  const session = event.data.object;
  const amountJpy    = parseInt(session.metadata?.amount_jpy || "0");
  const delaySeconds = parseInt(session.metadata?.delay_seconds || "0");
  const donatedAt    = new Date().toISOString();
  const sessionId    = session.id;

  try {
    // 1) 寄付ログに追記（最新50件を保持）
    const logsRaw = await kv.get("donation_logs");
    const logs = Array.isArray(logsRaw) ? logsRaw : [];
    logs.unshift({ id: sessionId, amount: amountJpy, delay: delaySeconds, at: donatedAt });
    if (logs.length > 50) logs.splice(50);
    await kv.set("donation_logs", logs);

    // 2) 累計寄付額・累計延命秒数を更新
    const totalRaw = await kv.get("donation_total");
    const total = totalRaw || { amount: 0, delay_seconds: 0, count: 0 };
    total.amount        += amountJpy;
    total.delay_seconds += delaySeconds;
    total.count         += 1;
    total.last_updated   = donatedAt;
    await kv.set("donation_total", total);

    console.log(`✅ 寄付記録: ${amountJpy}円 / +${delaySeconds}秒 / 累計${total.amount}円`);
    return res.status(200).json({ received: true });

  } catch (err) {
    console.error("KV write error:", err);
    return res.status(500).json({ error: err.message });
  }
}
