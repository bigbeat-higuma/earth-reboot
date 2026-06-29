// api/save.js — ゲームの進行状況をVercel KVに保存する
//
// 所有権検証（トークン方式）:
// userId だけでは「知っていれば誰でも上書きできる」ため、初回保存時にサーバーが
// ランダムなトークンを発行してクライアントに返し、以後の保存はそのトークンが
// 一致しない限り拒否する。
//
// 移行ウィンドウの保護（修正版）:
// トークン未発行の状態（新規ユーザー、または移行前の既存セーブ）でトークンを新規発行する際は
// SET NX（キーが存在しない場合のみ書き込み）でアトミックに「所有権クレーム」を行う。
// これにより、同一 userId に対して複数のクライアントがほぼ同時にトークンを獲得しようとしても、
// Redis側で必ず1件だけが成功し、以後は他のリクエストは「トークン不一致」で拒否される。
// 結果として、トークン未発行の期間が「無制限に誰でも何度でも上書きできる」状態から
// 「最初の1回だけクレームでき、それ以降は保護される」状態に変わり、攻撃者が同じuserIdに対して
// 繰り返し上書きすることはできなくなる。クレーム時には監査ログを残す。
import crypto from "crypto";
import { applyRestrictedCors, timingSafeTokenEqual } from "./_security.js";

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

// NX付きSET（キーが存在しない場合のみ書き込む）。Redisレベルでアトミックに実行されるため、
// 「トークン未発行の既存セーブ」に対する同時アクセスでも、最初の1件だけが所有権を獲得できる。
async function kvSetNx(redisUrl, redisToken, key, value, exSeconds) {
  // Upstash REST APIの公式構文: "SET key value NX EX seconds" -> "/set/key/value/NX/EX/seconds"
  const url = exSeconds
    ? `${redisUrl}/set/${encodeURIComponent(key)}/${encodeURIComponent(value)}/NX/EX/${exSeconds}`
    : `${redisUrl}/set/${encodeURIComponent(key)}/${encodeURIComponent(value)}/NX`;
  const r = await fetch(url, { method: "GET", headers: { Authorization: `Bearer ${redisToken}` } });
  if (!r.ok) throw new Error("redis set nx failed");
  const j = await r.json();
  return j.result === "OK"; // NXで書き込めた場合のみ "OK"、既存キーがあれば null
}

export default async function handler(req, res) {
  applyRestrictedCors(req, res, "POST, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const redisUrl   = process.env.KV_REST_API_URL;
  const redisToken = process.env.KV_REST_API_TOKEN;
  if (!redisUrl || !redisToken) {
    console.error("Save handler: Redis not configured");
    return res.status(500).json({ error: "Service unavailable" });
  }

  const { userId, sceneId, stats, gameTime, version, flags, choiceHistory, token } = req.body || {};
  if (!userId || !sceneId) {
    return res.status(400).json({ error: "userId と sceneId は必須です" });
  }

  const key      = `save:${userId}`;
  const tokenKey = `save_token:${userId}`;

  try {
    const existingToken = await kvGet(redisUrl, redisToken, tokenKey);

    let issuedToken = null;
    if (existingToken) {
      // トークン発行済み（既にこの変更後に一度保存されたユーザー）→ 定数時間で一致確認
      if (!timingSafeTokenEqual(token, existingToken)) {
        return res.status(403).json({ error: "Invalid or missing save token" });
      }
    } else {
      // トークン未発行 → 新規発行し、NXでアトミックにクレーム（先着1件のみ成功）
      issuedToken = crypto.randomBytes(24).toString("hex");
      const claimed = await kvSetNx(redisUrl, redisToken, tokenKey, issuedToken, TTL_SECONDS);
      if (!claimed) {
        // 他のリクエストが同時にクレーム済み → 自分は所有者ではないため拒否
        console.error(`Save handler: token claim race lost for userId=${userId}`);
        return res.status(403).json({ error: "Invalid or missing save token" });
      }
      console.error(`Save handler: new save token claimed for userId=${userId}`); // 監査ログ（情報レベル）
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
    if (existingToken) {
      // 既存トークンのTTLを更新（アクティブなプレイヤーが期限切れで保護を失わないように）
      await kvSet(redisUrl, redisToken, tokenKey, existingToken, TTL_SECONDS);
    }

    const responseBody = { ok: true };
    if (issuedToken) responseBody.token = issuedToken; // 初回発行時のみクライアントに返す
    return res.status(200).json(responseBody);
  } catch (err) {
    console.error("Save handler error:", err);
    return res.status(502).json({ error: "Service unavailable" });
  }
}
