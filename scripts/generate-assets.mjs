#!/usr/bin/env node
/**
 * EARTH REBOOT asset generator CLI
 * Usage:
 *   node scripts/generate-assets.mjs image <key>
 *   node scripts/generate-assets.mjs music <key> [--duration 45]
 *   node scripts/generate-assets.mjs sfx <key> [--duration 2]
 *   node scripts/generate-assets.mjs batch-priority
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

// .env.local を Node プロセスに読み込む（vercel dev は別プロセスのため CLI 側でも必要）
function loadEnvLocal() {
  const envPath = path.join(ROOT, ".env.local");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}
loadEnvLocal();

const API_BASE = process.env.ASSET_API_BASE || "http://localhost:3000";
const ADMIN_SECRET = process.env.ADMIN_SECRET;

const IMAGE_PROMPTS = {
  economy: "Abandoned stock exchange trading floor at night, shattered screens showing red crash graphs, homeless crowds outside skyscrapers, dystopian cyberpunk, cinematic wide shot, no text, photorealistic",
  society: "Divided city street at dusk, opposing protest groups with conflicting holographic news feeds, broken trust atmosphere, dystopian near-future, cinematic, no text, photorealistic",
  federation: "Earth from orbit under unified global government, cold blue order, geometric grid overlay, cinematic sci-fi, no text",
  anarchy: "Collapsed megacity with fires, no central authority, chaotic orange-red sky, dystopian, cinematic, no text",
  ecocide: "Dead forest and dried riverbed, extreme heat haze, lifeless brown landscape, climate collapse, cinematic, no text",
  nuclear: "Mushroom cloud on distant horizon, silhouettes of ruins, apocalyptic red sky, cinematic, no text",
  pandemic: "Empty hospital corridor, green emergency lighting, abandoned stretchers, cinematic, no text",
  transcend: "Human consciousness merging with light network, abstract cosmic purple-gold, cinematic sci-fi art, no text",
  loop: "Infinite recursive corridor of identical doorways, surreal glitch aesthetic, cinematic, no text",
  human: "Single candle in dark room, fragile warmth, intimate close shot, cinematic, no text",
};

const MUSIC_PROMPTS = {
  opening: "Dark ambient cinematic, slow pulse, countdown tension, minimal synth, no vocals, loopable",
  gaia: "Ethereal AI consciousness theme, soft digital choir pad, hopeful but unsettling, instrumental loop",
  flood: "Melancholic orchestral with rain textures, refugee crisis mood, slow tempo, instrumental loop",
  war: "Tense military drums, low brass, nuclear brinkmanship, dark cinematic, instrumental loop",
  virus: "Clinical ambient, subtle heartbeat, pandemic isolation, muted strings, instrumental loop",
  economy: "Glitchy financial collapse, descending tones, market crash anxiety, electronic orchestral loop",
  society: "Dissonant voice fragments, misinformation chaos, unsettling ambient, instrumental loop",
  hope: "Rising orchestral hope with underlying dread, final choice moment, instrumental loop",
  ending_hope: "Bittersweet resolution, gentle piano and strings, ambiguous hope, instrumental",
  ending_bad: "Deep drone, fading heartbeat, apocalyptic silence, slow decay, instrumental",
};

const SFX_PROMPTS = {
  alert: "Emergency broadcast alert beep, sci-fi terminal, urgent",
  choice: "Soft UI click with subtle digital confirmation",
  transition: "Whoosh data stream transition, subtle sci-fi",
  save: "Positive digital chime, short confirmation beep",
  ending: "Deep cinematic impact with reverb, dramatic reveal",
};

function parseArgs(argv) {
  const args = { duration: null };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--duration" && argv[i + 1]) {
      args.duration = Number(argv[++i]);
    } else if (!argv[i].startsWith("--")) {
      positional.push(argv[i]);
    }
  }
  return { positional, ...args };
}

function missingEnvVars(kind) {
  const required = ["ADMIN_SECRET"];
  if (kind === "image") required.push("OPENAI_API_KEY");
  if (kind === "audio") required.push("ELEVENLABS_API_KEY");
  return required.filter(k => !process.env[k]);
}

async function apiPost(body) {
  const kind = body.kind || body.type;
  const missing = missingEnvVars(kind === "image" ? "image" : "audio");
  if (missing.length) {
    throw new Error(
      `未設定の環境変数: ${missing.join(", ")}\n` +
      `.env.local に追加してください（Vercel には未登録の変数です）。\n` +
      `追加後: ターミナル1の vercel dev を再起動 → ターミナル2で再実行`
    );
  }
  const res = await fetch(`${API_BASE}/api/generate-asset`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${ADMIN_SECRET}`,
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

async function saveImage(key, prompt) {
  const data = await apiPost({ kind: "image", prompt, size: "1536x1024" });
  const item = data.data?.[0];
  if (!item?.b64_json) throw new Error("No image data in response");
  const outDir = path.join(ROOT, "public", "images");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `${key}.jpg`);
  fs.writeFileSync(outPath, Buffer.from(item.b64_json, "base64"));
  console.log(`Saved ${outPath}`);
}

async function saveAudio(subdir, key, type, prompt, duration) {
  const data = await apiPost({
    kind: type === "music" ? "music" : "sfx",
    prompt,
    duration: duration || (type === "music" ? 30 : 2),
  });
  if (!data.audio_base64) throw new Error("No audio data in response");
  const outDir = path.join(ROOT, "public", "audio", subdir);
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `${key}.mp3`);
  fs.writeFileSync(outPath, Buffer.from(data.audio_base64, "base64"));
  console.log(`Saved ${outPath} (${data.duration_seconds}s)`);
}

async function batchPriority() {
  console.log("=== Priority batch: images ===");
  for (const key of ["economy", "society"]) {
    console.log(`Generating image: ${key}`);
    await saveImage(key, IMAGE_PROMPTS[key]);
  }
  console.log("=== Priority batch: BGM ===");
  for (const key of ["opening", "flood", "war", "virus"]) {
    console.log(`Generating music: ${key}`);
    await saveAudio("bgm", key, "music", MUSIC_PROMPTS[key], 45);
  }
  console.log("=== Priority batch: SFX ===");
  for (const key of ["alert", "choice", "transition"]) {
    console.log(`Generating sfx: ${key}`);
    await saveAudio("sfx", key, "sfx", SFX_PROMPTS[key], key === "choice" ? 1 : 2);
  }
  console.log("Done.");
}

async function main() {
  const { positional, duration } = parseArgs(process.argv.slice(2));
  const [cmd, key] = positional;
  if (!cmd) {
    console.log(`Usage:
  node scripts/generate-assets.mjs image <key>
  node scripts/generate-assets.mjs music <key> [--duration 45]
  node scripts/generate-assets.mjs sfx <key> [--duration 2]
  node scripts/generate-assets.mjs batch-priority

Keys — image: ${Object.keys(IMAGE_PROMPTS).join(", ")}
Keys — music: ${Object.keys(MUSIC_PROMPTS).join(", ")}
Keys — sfx: ${Object.keys(SFX_PROMPTS).join(", ")}`);
    process.exit(1);
  }
  if (cmd === "batch-priority") {
    await batchPriority();
    return;
  }
  if (cmd === "image") {
    const prompt = IMAGE_PROMPTS[key];
    if (!prompt) throw new Error(`Unknown image key: ${key}`);
    await saveImage(key, prompt);
    return;
  }
  if (cmd === "music") {
    const prompt = MUSIC_PROMPTS[key];
    if (!prompt) throw new Error(`Unknown music key: ${key}`);
    await saveAudio("bgm", key, "music", prompt, duration || 45);
    return;
  }
  if (cmd === "sfx") {
    const prompt = SFX_PROMPTS[key];
    if (!prompt) throw new Error(`Unknown sfx key: ${key}`);
    await saveAudio("sfx", key, "sfx", prompt, duration || 2);
    return;
  }
  throw new Error(`Unknown command: ${cmd}`);
}

main().catch(err => {
  console.error("Error:", err.message);
  process.exit(1);
});
