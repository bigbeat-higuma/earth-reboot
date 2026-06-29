// api/load.js — Vercel KVからゲームのセーブデータをロードする
//
// 所有権検証: save.js が発行したトークン（save_token:<userId>）が存在する場合、
// クエリの token が一致しない限りデータを返さない（存在の有無も明かさず save:null を返す）。
// トークン未発行（移行前の旧セーブ）の場合は従来通り許可する。
// トークン比較は crypto.timingSafeEqual を使った定数時間比較で行い、タイミング攻撃を防止する。
import { timingSafeTokenEqual } from "./_security.js";

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

  const { userId, token } = req.query;
  if (!userId) {
    return res.status(400).json({ error: "userId は必須です" });
  }

  const key      = `save:${userId}`;
  const tokenKey = `save_token:${userId}`;

  try {
    const tokenResp = await fetch(`${redisUrl}/get/${encodeURIComponent(tokenKey)}`, {
      headers: { Authorization: `Bearer ${redisToken}` },
    });
    if (tokenResp.ok) {
      const tokenResult = await tokenResp.json();
      const existingToken = tokenResult.result;
      if (existingToken && !timingSafeTokenEqual(token, existingToken)) {
        // トークン不一致 → データの存在自体を明かさない
        return res.status(200).json({ save: null });
      }
    }

    const response = await fetch(`${redisUrl}/get/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${redisToken}` },
    });

    if (!response.ok) {
      return res.status(502).json({ error: "Redis error" });
    }

    const result = await response.json();
    if (result.result === null || result.result === undefined) {
      return res.status(200).json({ save: null });
    }

    // result.result が配列の場合（古い形式）→ 先頭要素を使う
    let raw = result.result;
    if (Array.isArray(raw)) {
      raw = raw[0];
    }

    // 文字列の場合はJSONパース
    const save = typeof raw === 'string' ? JSON.parse(raw) : raw;

    // saveがsceneIdを持っていない場合は無効データとして扱う
    if (!save || !save.sceneId) {
      return res.status(200).json({ save: null });
    }

    return res.status(200).json({ save });
  } catch (err) {
    console.error("Load handler error:", err);
    return res.status(500).json({ error: "Service unavailable" });
  }
}
