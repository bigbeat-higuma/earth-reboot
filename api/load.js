// api/load.js — Upstash RedisからゲームのセーブデータをロードするS
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const redisUrl   = process.env.KV_REST_API_URL;
  const redisToken = process.env.KV_REST_API_TOKEN;
  if (!redisUrl || !redisToken) {
    return res.status(500).json({ error: "Redis not configured" });
  }

  const { userId } = req.query;
  if (!userId) {
    return res.status(400).json({ error: "userId は必須です" });
  }

  const key = `save:${userId}`;

  try {
    // Upstash Redis REST API: GET key
    const response = await fetch(`${redisUrl}/get/${encodeURIComponent(key)}`, {
      headers: {
        Authorization: `Bearer ${redisToken}`,
      },
    });

    if (!response.ok) {
      const err = await response.json();
      console.error("Redis load error:", err);
      return res.status(502).json({ error: "Redis error", detail: err });
    }

    const result = await response.json();

    // セーブデータなし
    if (result.result === null) {
      return res.status(200).json({ save: null });
    }

    const save = JSON.parse(result.result);
    return res.status(200).json({ save });
  } catch (err) {
    console.error("Load handler error:", err);
    return res.status(500).json({ error: err.message });
  }
}
