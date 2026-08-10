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
  federation: "Earth from orbit under a cold unified global government, blue geometric surveillance grid over continents, authoritarian sci-fi order, cinematic wide shot, no text, photorealistic",
  anarchy: "Collapsed megacity with street fires and broken towers, no central authority, chaotic orange-red sky, dystopian riot aftermath, cinematic wide shot, no text, photorealistic",
  ecocide: "Dead forest and dried cracked riverbed under extreme heat haze, lifeless brown landscape, climate collapse, cinematic wide shot, no text, photorealistic",
  nuclear: "Distant mushroom cloud beyond ruined city silhouettes, ash falling, apocalyptic red-gray sky, cinematic wide shot, no text, photorealistic",
  pandemic: "Empty hospital corridor with green emergency lighting, abandoned stretchers and PPE, eerie silence, cinematic wide shot, no text, photorealistic",
  transcend: "Human silhouette dissolving into a luminous neural light network, purple-gold cosmic fusion of mind and AI, cinematic sci-fi, no text, photorealistic",
  loop: "Infinite recursive corridor of identical glowing doorways repeating forever, surreal time-loop atmosphere, cinematic wide shot, no text, photorealistic",
  human: "Single candle flame in a dark empty room, fragile human warmth against darkness, intimate cinematic close shot, no text, photorealistic",
  dark: "Pitch-black command bunker corridor lit only by sparse red emergency strips, void-like silence between crises, moody cinematic wide shot, no text, photorealistic",

  // --- 2026-08-10 追加: 背景の単調さを解消するための8枚 ---
  // 121シーンに対し背景が7種しかなく、特に gaia がオープニング・CH6・クライマックス・
  // 幕間を兼任していた（全体の27%）。物語の最高潮が道中と同じ絵になっていたため分離する。

  // オープニング専用（従来は gaia を流用）
  intro: "Vast dark server cathedral awakening, a single column of pale blue light rising through endless data towers, the first breath of an artificial mind, cold and immense, cinematic wide shot, no text, photorealistic",
  // クライマックス専用（従来は gaia を流用）
  // 注: "decision interface" と書くと ✓/?/✗ のアイコンが描かれ、UIモックアップのような絵になった。
  // 抽象概念ではなく「場所」として描写し、文字が重なる中央部が明るくなりすぎないようにする。
  climax: "Colossal dark control chamber at the core of a planetary AI, a lone human silhouette standing on a narrow platform facing an immense curved wall of dim flickering monitors, Earth faintly visible far below through a fractured dome, oppressive scale, deep blues and blacks, cinematic wide shot, no text, no symbols, no user interface, photorealistic",

  // 各章の「余波」。章の後半で景色が変わり、危機の収束と代償を可視化する
  flood_after: "Receding floodwater over a drowned district at dawn, mud-covered streets and stranded belongings, survivors' temporary shelters in pale morning light, aftermath stillness, cinematic wide shot, no text, photorealistic",
  war_after: "Ceasefire dawn over a shelled city, silent artillery abandoned in snow, thin smoke columns under a gray truce sky, exhausted quiet after conflict, cinematic wide shot, no text, photorealistic",
  virus_after: "Field hospital being dismantled at sunrise, empty rows of stripped beds and folded isolation tents, disinfectant mist in pale light, the quiet after an outbreak, cinematic wide shot, no text, photorealistic",
  economy_after: "Former trading floor repurposed as a communal distribution hall, dead screens above orderly ration queues, cold daylight through cracked glass, austere new normal, cinematic wide shot, no text, photorealistic",
  society_after: "Emptied protest square at night after the crowds have gone, scattered placards and a single lit public screen, uneasy silence between factions, cinematic wide shot, no text, photorealistic",
  gaia_after: "Vast server hall in low-power dormancy, most lights extinguished, one console still glowing among cooling machines, an intelligence holding its breath, cinematic wide shot, no text, photorealistic",
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

  // --- 2026-08-10 追加（Phase 3） ---
  // クライマックス専用。従来は CH6 と同じ gaia が鳴り続け、最高潮に音の変化が無かった
  climax: "Slow massive build to a single suspended decision, deep pulsing low end, sparse piano over vast reverb, unbearable stillness before an irreversible choice, instrumental loop",
  // 各章の後半（react以降）。背景が「余波」へ切り替わるのと同じ位置で音楽も変える。
  // 2026-08-10: 当初は全章共通の aftermath 1曲だったが、1周で6回同じ曲を聴くことになり
  // 単調だったため、章ごとの曲に分けた。曲名は背景キーと一致させている（BGM_FOR_BG が1対1）。
  // 各曲は「その章の危機の曲」の音色を引き継ぎつつ、力を失った状態として書く。
  flood_after: "The rain has stopped. Hollow strings over dripping water and distant wind, waterlogged silence, mourning what the flood took, slow and thin, instrumental loop",
  war_after: "The drums have stopped. A single distant horn over ash and low wind, spent brass fading into cold quiet, the exhaustion after shelling ends, instrumental loop",
  virus_after: "The heartbeat slows to normal. Sterile ambient with faint room tone, empty ward calm, relief indistinguishable from emptiness, muted and clinical, instrumental loop",
  economy_after: "The glitches have settled. Slow mechanical hum and dull repeating pulse, resigned order after collapse, grey and procedural, instrumental loop",
  society_after: "The shouting has faded to a murmur. Blurred distant voices under a soft unresolved pad, uneasy quiet between people who still disagree, instrumental loop",
  gaia_after: "The choir has dimmed to a single held tone. Vast machine at rest, faint cooling drone and slow breath, an intelligence waiting in the dark, instrumental loop",
  // transcend / loop 用。従来は11エンディングを ending_hope / ending_bad の2曲で賄っていた
  ending_strange: "Uncanny weightless resolution, shimmering detuned pads and reversed tones, neither victory nor defeat, dreamlike and unresolved, instrumental",
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

async function batchEndings() {
  const keys = [
    "federation", "anarchy", "ecocide", "nuclear",
    "pandemic", "transcend", "loop", "human", "dark",
  ];
  console.log("=== Ending + dark backgrounds ===");
  for (const key of keys) {
    console.log(`Generating image: ${key}`);
    await saveImage(key, IMAGE_PROMPTS[key]);
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
  node scripts/generate-assets.mjs batch-endings

Keys — image: ${Object.keys(IMAGE_PROMPTS).join(", ")}
Keys — music: ${Object.keys(MUSIC_PROMPTS).join(", ")}
Keys — sfx: ${Object.keys(SFX_PROMPTS).join(", ")}`);
    process.exit(1);
  }
  if (cmd === "batch-priority") {
    await batchPriority();
    return;
  }
  if (cmd === "batch-endings") {
    await batchEndings();
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
