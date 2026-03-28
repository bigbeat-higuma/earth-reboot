// api/donation-stats.js — 寄付累計・履歴をフロントに返す
import { kv } from "@vercel/kv";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const [total, logs] = await Promise.all([
      kv.get("donation_total"),
      kv.get("donation_logs"),
    ]);

    return res.status(200).json({
      total: total || { amount: 0, delay_seconds: 0, count: 0 },
      logs:  Array.isArray(logs) ? logs.slice(0, 10) : [], // 最新10件
    });
  } catch (err) {
    console.error("donation-stats error:", err);
    return res.status(500).json({ error: err.message });
  }
}
