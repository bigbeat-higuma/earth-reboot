// api/generate-image.js
//
// 管理者専用・開発支援ツール。公開ゲームフローからは呼ばれない。
// シナリオ拡充用の新規シーン背景（8枚等）を生成するための内部ツール。
// OpenAI Image API（モデル: gpt-image-1-mini, 価格 $0.005/枚）を呼び出し、
// 生成された画像データをそのまま返す。
//
// 必要な環境変数:
//   - OPENAI_API_KEY : OpenAI APIキー（画像生成に使用）
//   - ADMIN_SECRET    : 管理者認証用シークレット。
//                        リクエストヘッダ "Authorization: Bearer <ADMIN_SECRET>" と比較する。
//
// 認証はタイミング攻撃を避けるため crypto.timingSafeEqual による定数時間比較を行う。

import crypto from "crypto";

const DEFAULT_SIZE = "1024x1024";
const OPENAI_IMAGE_MODEL = "gpt-image-1-mini";

// "Authorization: Bearer <secret>" ヘッダーと ADMIN_SECRET を定数時間で比較する。
// 長さが異なる場合は timingSafeEqual がエラーを投げるため、
// 比較前にダミーバッファでパディングしてから比較する（タイミング攻撃対策）。
function isAuthorized(req, adminSecret) {
  const authHeader = req.headers["authorization"] || "";
  const expected = `Bearer ${adminSecret}`;

  const provided = Buffer.from(authHeader, "utf8");
  const expectedBuf = Buffer.from(expected, "utf8");

  if (provided.length !== expectedBuf.length) {
    // 長さの不一致自体も即時returnしない（タイミング攻撃の手がかりを減らすため、
    // 同じ長さのダミーバッファ同士で比較してから false を返す）
    crypto.timingSafeEqual(expectedBuf, expectedBuf);
    return false;
  }

  return crypto.timingSafeEqual(provided, expectedBuf);
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const adminSecret = process.env.ADMIN_SECRET;
  if (!adminSecret) {
    console.error("ADMIN_SECRET not configured — rejecting request for safety");
    return res.status(500).json({ error: "Admin authentication not configured" });
  }

  if (!isAuthorized(req, adminSecret)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "OPENAI_API_KEY is not configured on the server" });
  }

  const { prompt, size } = req.body || {};
  if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
    return res.status(400).json({ error: "prompt is required" });
  }

  const imageSize = typeof size === "string" && size.trim() ? size.trim() : DEFAULT_SIZE;

  try {
    const response = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: OPENAI_IMAGE_MODEL,
        prompt,
        size: imageSize,
        n: 1,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("OpenAI Image API error:", response.status, errText);
      return res.status(502).json({ error: "Image generation failed. Please try again later." });
    }

    const data = await response.json();
    // OpenAI Image API のレスポンス形式（data[0].b64_json または data[0].url）をそのまま返す
    return res.status(200).json({
      ok: true,
      model: OPENAI_IMAGE_MODEL,
      size: imageSize,
      data: data.data,
    });

  } catch (err) {
    console.error("generate-image handler error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
