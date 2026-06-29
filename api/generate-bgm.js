// api/generate-bgm.js
//
// 管理者専用・開発支援ツール。公開ゲームフローからは呼ばれない。
// シナリオ拡充用のBGM/SFXを生成するための内部ツール。
// ElevenLabs Music API（BGM生成, $0.80/分）と
// ElevenLabs Sound Effects API（SFX生成, $0.12/分）の両方を呼び出せる。
// リクエストボディの type ("music" | "sfx") で呼び出し先を切り替える。
//
// 必要な環境変数:
//   - ELEVENLABS_API_KEY : ElevenLabs APIキー（音声生成に使用）
//   - ADMIN_SECRET        : 管理者認証用シークレット。
//                            リクエストヘッダ "Authorization: Bearer <ADMIN_SECRET>" と比較する。
//
// 認証はタイミング攻撃を避けるため crypto.timingSafeEqual による定数時間比較を行う。

import crypto from "crypto";

const DEFAULT_MUSIC_DURATION_SECONDS = 30;
const DEFAULT_SFX_DURATION_SECONDS = 5;

const ELEVENLABS_MUSIC_URL = "https://api.elevenlabs.io/v1/music";
const ELEVENLABS_SFX_URL = "https://api.elevenlabs.io/v1/sound-generation";

// "Authorization: Bearer <secret>" ヘッダーと ADMIN_SECRET を定数時間で比較する。
// 長さが異なる場合は timingSafeEqual がエラーを投げるため、
// 比較前に長さチェックを行い、ダミー比較を挟んでからfalseを返す（タイミング攻撃対策）。
function isAuthorized(req, adminSecret) {
  const authHeader = req.headers["authorization"] || "";
  const expected = `Bearer ${adminSecret}`;

  const provided = Buffer.from(authHeader, "utf8");
  const expectedBuf = Buffer.from(expected, "utf8");

  if (provided.length !== expectedBuf.length) {
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

  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "ELEVENLABS_API_KEY is not configured on the server" });
  }

  const { prompt, duration, type } = req.body || {};
  if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
    return res.status(400).json({ error: "prompt is required" });
  }

  const kind = type === "sfx" ? "sfx" : type === "music" ? "music" : null;
  if (!kind) {
    return res.status(400).json({ error: 'type must be "music" or "sfx"' });
  }

  const defaultDuration = kind === "music" ? DEFAULT_MUSIC_DURATION_SECONDS : DEFAULT_SFX_DURATION_SECONDS;
  const durationSeconds = Number.isFinite(Number(duration)) && Number(duration) > 0
    ? Number(duration)
    : defaultDuration;

  try {
    let response, audioBuffer;

    if (kind === "music") {
      response = await fetch(ELEVENLABS_MUSIC_URL, {
        method: "POST",
        headers: {
          "xi-api-key": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          prompt,
          music_length_ms: Math.round(durationSeconds * 1000),
        }),
      });
    } else {
      response = await fetch(ELEVENLABS_SFX_URL, {
        method: "POST",
        headers: {
          "xi-api-key": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text: prompt,
          duration_seconds: durationSeconds,
        }),
      });
    }

    if (!response.ok) {
      const errText = await response.text();
      console.error(`ElevenLabs ${kind} API error:`, response.status, errText);
      return res.status(502).json({ error: "Audio generation failed. Please try again later." });
    }

    // ElevenLabs の音声生成エンドポイントはバイナリ音声データ（audio/mpeg等）を直接返す
    const arrayBuffer = await response.arrayBuffer();
    audioBuffer = Buffer.from(arrayBuffer);
    const base64Audio = audioBuffer.toString("base64");
    const contentType = response.headers.get("content-type") || "audio/mpeg";

    return res.status(200).json({
      ok: true,
      type: kind,
      duration_seconds: durationSeconds,
      content_type: contentType,
      audio_base64: base64Audio,
    });

  } catch (err) {
    console.error("generate-bgm handler error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
