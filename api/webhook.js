// api/webhook.js — Stripe Webhookを受け取り、寄付をUpstash Redisに記録する
import { Redis } from "@upstash/redis";
import crypto from "crypto";

export const config = { api: { bodyParser: false } };

async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

// Stripeの署名検証（Stripe SDK不使用・既存のfetchベース実装と統一）
// 署名ヘッダー形式: "t=<timestamp>,v1=<signature>,v0=<signature>"
// 署名対象: "<timestamp>.<rawBody>" を webhook secret でHMAC-SHA256したhex文字列
const SIGNATURE_TOLERANCE_SECONDS = 5 * 60; // Stripe推奨の許容誤差（リプレイ攻撃対策）

function verifyStripeSignature(rawBody, sigHeader, secret) {
  if (!sigHeader || !secret) return false;
  const parts = {};
  for (const seg of sigHeader.split(",")) {
    const idx = seg.indexOf("=");
    if (idx === -1) continue;
    parts[seg.slice(0, idx)] = seg.slice(idx + 1);
  }
  const timestamp = parts.t;
  const signature = parts.v1;
  if (!timestamp || !signature) return false;

  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - parseInt(timestamp, 10)) > SIGNATURE_TOLERANCE_SECONDS) return false;

  const signedPayload = `${timestamp}.${rawBody.toString("utf8")}`;
  const expected = crypto.createHmac("sha256", secret).update(signedPayload).digest("hex");

  try {
    return crypto.timingSafeEqual(Buffer.from(signature, "hex"), Buffer.from(expected, "hex"));
  } catch (e) {
    return false; // 長さ不一致など
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error("STRIPE_WEBHOOK_SECRET not configured — rejecting webhook for safety");
    return res.status(500).json({ error: "Webhook secret not configured" });
  }

  const redis = new Redis({
    url: process.env.KV_REST_API_URL,
    token: process.env.KV_REST_API_TOKEN,
  });

  const rawBody = await getRawBody(req);
  const sig = req.headers["stripe-signature"];

  if (!verifyStripeSignature(rawBody, sig, webhookSecret)) {
    console.error("Webhook signature verification failed");
    return res.status(400).json({ error: "Invalid signature" });
  }

  let event;
  try {
    event = JSON.parse(rawBody.toString());
  } catch (err) {
    return res.status(400).json({ error: "Invalid JSON" });
  }

  if (event.type !== "checkout.session.completed") {
    return res.status(200).json({ received: true });
  }

  const session = event.data.object;
  const amountJpy = parseInt(session.metadata?.amount_jpy || "0");
  const donatedAt = new Date().toISOString();
  const sessionId = session.id;

  try {
    // 注: 寄付は「運営協力金」として記録するのみで、再起動カウントダウンには一切影響しない。
    // delay フィールドは新規寄付では記録しない（過去ログのdelay値は履歴としてそのまま保持される）。
    const logsRaw = await redis.get("donation_logs");
    const logs = Array.isArray(logsRaw) ? logsRaw : [];
    logs.unshift({ id: sessionId, amount: amountJpy, at: donatedAt });
    if (logs.length > 50) logs.splice(50);
    await redis.set("donation_logs", logs);

    const totalRaw = await redis.get("donation_total");
    const total = totalRaw || { amount: 0, count: 0 };
    total.amount      += amountJpy;
    total.count       += 1;
    total.last_updated = donatedAt;
    await redis.set("donation_total", total);

    return res.status(200).json({ received: true });
  } catch (err) {
    console.error("Redis write error:", err);
    return res.status(500).json({ error: err.message });
  }
}
