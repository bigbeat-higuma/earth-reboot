// api/generate-asset.js
//
// 管理者専用・開発支援ツール。公開ゲームフローからは呼ばれない。
// 画像（OpenAI）・BGM/SFX（ElevenLabs）を kind で切り替えて生成する。
//
// 必要な環境変数:
//   - ADMIN_SECRET        : 管理者認証
//   - OPENAI_API_KEY      : kind=image のとき
//   - ELEVENLABS_API_KEY  : kind=music|sfx のとき

import crypto from "crypto";
import { loadLocalEnv } from "./_load-local-env.js";

loadLocalEnv();

const DEFAULT_IMAGE_SIZE = "1024x1024";
const OPENAI_IMAGE_MODEL = "gpt-image-1-mini";
const DEFAULT_MUSIC_DURATION_SECONDS = 30;
const DEFAULT_SFX_DURATION_SECONDS = 5;
const ELEVENLABS_MUSIC_URL = "https://api.elevenlabs.io/v1/music";
const ELEVENLABS_SFX_URL = "https://api.elevenlabs.io/v1/sound-generation";

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

function resolveKind(body) {
  const raw = body?.kind || body?.type;
  if (raw === "image" || raw === "music" || raw === "sfx") return raw;
  return null;
}

async function generateImage(apiKey, prompt, size) {
  const imageSize = typeof size === "string" && size.trim() ? size.trim() : DEFAULT_IMAGE_SIZE;
  const response = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
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
    let detail = "Image generation failed. Please try again later.";
    try {
      const parsed = JSON.parse(errText);
      const msg = parsed?.error?.message;
      if (msg?.includes("billing") || parsed?.error?.code === "billing_hard_limit_reached") {
        detail = "OpenAI の利用上限に達しています。platform.openai.com の Billing で支払い方法・上限を確認してください。";
      } else if (msg) {
        detail = `OpenAI error: ${msg}`;
      }
    } catch (_) {}
    return { status: 502, body: { error: detail } };
  }

  const data = await response.json();
  return {
    status: 200,
    body: { ok: true, kind: "image", model: OPENAI_IMAGE_MODEL, size: imageSize, data: data.data },
  };
}

async function generateAudio(apiKey, kind, prompt, duration) {
  const defaultDuration = kind === "music" ? DEFAULT_MUSIC_DURATION_SECONDS : DEFAULT_SFX_DURATION_SECONDS;
  const durationSeconds = Number.isFinite(Number(duration)) && Number(duration) > 0
    ? Number(duration)
    : defaultDuration;

  const response = await fetch(
    kind === "music" ? ELEVENLABS_MUSIC_URL : ELEVENLABS_SFX_URL,
    {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(
        kind === "music"
          ? { prompt, music_length_ms: Math.round(durationSeconds * 1000) }
          : { text: prompt, duration_seconds: durationSeconds }
      ),
    }
  );

  if (!response.ok) {
    const errText = await response.text();
    console.error(`ElevenLabs ${kind} API error:`, response.status, errText);
    return { status: 502, body: { error: "Audio generation failed. Please try again later." } };
  }

  const arrayBuffer = await response.arrayBuffer();
  const base64Audio = Buffer.from(arrayBuffer).toString("base64");
  const contentType = response.headers.get("content-type") || "audio/mpeg";

  return {
    status: 200,
    body: {
      ok: true,
      kind,
      duration_seconds: durationSeconds,
      content_type: contentType,
      audio_base64: base64Audio,
    },
  };
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

  const { prompt, size, duration } = req.body || {};
  if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
    return res.status(400).json({ error: "prompt is required" });
  }

  const kind = resolveKind(req.body);
  if (!kind) {
    return res.status(400).json({ error: 'kind must be "image", "music", or "sfx"' });
  }

  try {
    if (kind === "image") {
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) {
        return res.status(500).json({ error: "OPENAI_API_KEY is not configured on the server" });
      }
      const result = await generateImage(apiKey, prompt, size);
      return res.status(result.status).json(result.body);
    }

    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "ELEVENLABS_API_KEY is not configured on the server" });
    }
    const result = await generateAudio(apiKey, kind, prompt, duration);
    return res.status(result.status).json(result.body);
  } catch (err) {
    console.error("generate-asset handler error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
