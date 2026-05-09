// api/save.js — ゲームの進行状況をUpstash Redisに保存する
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const redisUrl   = process.env.KV_REST_API_URL;
  const redisToken = process.env.KV_REST_API_TOKEN;
  if (!redisUrl || !redisToken) {
    return res.status(500).json({ error: "Redis not configured" });
  }

  const { userId, sceneId, stats, gameTime } = req.body;
  if (!userId || !sceneId) {
    return res.status(400).json({ error: "userId と sceneId は必須です" });
  }

  const key  = `save:${userId}`;
  const data = JSON.stringify({
    sceneId,
    stats,
    gameTime,
    savedAt: new Date().toISOString(),
  });

  try {
    // Upstash Redis REST API: SET key value EX 秒（30日間保持）
    const response = await fetch(`${redisUrl}/set/${encodeURIComponent(key)}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${redisToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify([data, "EX", 60 * 60 * 24 * 30]),
    });

    if (!response.ok) {
      const err = await response.json();
      console.error("Redis save error:", err);
      return res.status(502).json({ error: "Redis error", detail: err });
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("Save handler error:", err);
    return res.status(500).json({ error: err.message });
  }
}
