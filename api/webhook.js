// api/webhook.js — Stripe Webhookを受け取り、寄付をUpstash Redisに記録する
import { Redis } from "@upstash/redis";

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

  const redis = new Redis({
    url: process.env.KV_REST_API_URL,
    token: process.env.KV_REST_API_TOKEN,
  });

  const rawBody = await getRawBody(req);
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
  const amountJpy    = parseInt(session.metadata?.amount_jpy || "0");
  const delaySeconds = parseInt(session.metadata?.delay_seconds || "0");
  const donatedAt    = new Date().toISOString();
  const sessionId    = session.id;

  try {
    const logsRaw = await redis.get("donation_logs");
    const logs = Array.isArray(logsRaw) ? logsRaw : [];
    logs.unshift({ id: sessionId, amount: amountJpy, delay: delaySeconds, at: donatedAt });
    if (logs.length > 50) logs.splice(50);
    await redis.set("donation_logs", logs);

    const totalRaw = await redis.get("donation_total");
    const total = totalRaw || { amount: 0, delay_seconds: 0, count: 0 };
    total.amount        += amountJpy;
    total.delay_seconds += delaySeconds;
    total.count         += 1;
    total.last_updated   = donatedAt;
    await redis.set("donation_total", total);

    return res.status(200).json({ received: true });
  } catch (err) {
    console.error("Redis write error:", err);
    return res.status(500).json({ error: err.message });
  }
}
