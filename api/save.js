// api/save.js — ゲームの進行状況をVercel KVに保存する
//
// 所有権検証（トークン方式）:
// userId だけでは「知っていれば誰でも上書きできる」ため、初回保存時にサーバーが
// ランダムなトークンを発行してクライアントに返し、以後の保存はそのトークンが
// 一致しない限り拒否する。既存（移行前）のセーブはトークン未発行のため、
// この変更後の最初の保存でトークンが発行され、以後保護される。
import crypto from "crypto";

const TTL_SECONDS = 60 * 60 * 24 * 30; // 30日

async function kvGet(redisUrl, redisToken, key) {
  const r = await fetch(`${redisUrl}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${redisToken}` },
  });
  if (!r.ok) throw new Error("redis get failed");
  const j = await r.json();
  return j.result;
}

async function kvSet(redisUrl, redisToken, key, value, exSeconds) {
  const url = `${redisUrl}/set/${encodeURIComponent(key)}/${encodeURIComponent(value)}${exSeconds ? `?ex=${exSeconds}` : ""}`;
  const r = await fetch(url, { method: "GET", headers: { Authorization: `Bearer ${redisToken}` } });
  if (!r.ok) throw new Error("redis set failed");
  return r.json();
}

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

  const { userId, sceneId, stats, gameTime, version, flags, choiceHistory, token } = req.body;
  if (!userId || !sceneId) {
    return res.status(400).json({ error: "userId と sceneId は必須です" });
  }

  const key      = `save:${userId}`;
  const tokenKey = `save_token:${userId}`;

  try {
    const existingToken = await kvGet(redisUrl, redisToken, tokenKey);

    let issuedToken = null;
    if (existingToken) {
      // トークン発行済み（既にこの変更後に一度保存されたユーザー）→ 一致しなければ拒否
      if (!token || token !== existingToken) {
        return res.status(403).json({ error: "Invalid or missing save token" });
      }
    } else {
      // 初回保存（新規ユーザー、または移行前の既存セーブ）→ トークンを新規発行
      issuedToken = crypto.randomBytes(24).toString("hex");
    }

    const data = JSON.stringify({
      version: typeof version === "number" ? version : 1,
      sceneId,
      stats,
      flags: flags && typeof flags === "object" ? flags : {},
      choiceHistory: Array.isArray(choiceHistory) ? choiceHistory : [],
      gameTime,
      savedAt: new Date().toISOString(),
    });

    await kvSet(redisUrl, redisToken, key, data, TTL_SECONDS);
    // トークンのTTLも更新（アクティブなプレイヤーが期限切れで保護を失わないように）
    await kvSet(redisUrl, redisToken, tokenKey, existingToken || issuedToken, TTL_SECONDS);

    const responseBody = { ok: true };
    if (issuedToken) responseBody.token = issuedToken; // 初回発行時のみクライアントに返す
    return res.status(200).json(responseBody);
  } catch (err) {
    console.error("Save handler error:", err.message);
    return res.status(502).json({ error: "Redis error" });
  }
}
