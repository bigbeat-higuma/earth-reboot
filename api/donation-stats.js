// api/donation-stats.js — 寄付累計・履歴をフロントに返す
import { Redis } from "@upstash/redis";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();

  const redis = new Redis({
    url: process.env.KV_REST_API_URL,
    token: process.env.KV_REST_API_TOKEN,
  });

  try {
    const [total, logs] = await Promise.all([
      redis.get("donation_total"),
      redis.get("donation_logs"),
    ]);

    return res.status(200).json({
      total: total || { amount: 0, delay_seconds: 0, count: 0 },
      logs:  Array.isArray(logs) ? logs.slice(0, 10) : [],
    });
  } catch (err) {
    console.error("donation-stats error:", err);
    return res.status(500).json({ error: err.message });
  }
}
