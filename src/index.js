import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import OpenAI from "openai";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---------- Config ----------
const WIDTH = 1080;
const HEIGHT = 1920;
const FPS = 30;

const DEFAULTS = {
  TEXT_MODEL: "gpt-5",
  IMAGE_MODEL: "gpt-image-1",
  TTS_MODEL: "gpt-4o-mini-tts",
  TTS_VOICE: "alloy",
  VIDEO_SEC: 60,
  SCENES_COUNT: 6,
};

// Load user config from ~/.config/viral-video/config.json (or XDG_CONFIG_HOME)
function configPaths() {
  const home = os.homedir();
  const cfgRoot = process.env.XDG_CONFIG_HOME || path.join(home, ".config");
  const dir = path.join(cfgRoot, "viral-video");
  const file = path.join(dir, "config.json");
  return { dir, file };
}

export async function loadUserConfig() {
  const { file } = configPaths();
  try {
    const raw = await fs.readFile(file, "utf8");
    const json = JSON.parse(raw);
    return json && typeof json === "object" ? json : {};
  } catch {
    return {};
  }
}

function slugify(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

async function ensureDir(p) {
  await fs.mkdir(p, { recursive: true });
}
async function writeJSON(p, obj) {
  await fs.writeFile(p, JSON.stringify(obj, null, 2), "utf8");
}

function imageStyleBlock(imageStyle) {
  if (imageStyle === "realistic") {
    return "photorealistic, high detail, realistic lighting, natural textures";
  }
  if (imageStyle === "ai-generated") {
    return "AI-generated art style, algorithmic patterns, modern generative design";
  }
  // default cartoon
  return "stylized, cartoon, bold outlines, soft gradients, high contrast";
}

// ---------- Generators ----------
async function generateScript({ topic, client, cfg, dryRun }) {
  if (dryRun) {
    const sections = [
      { label: "Intro/Context", sec: 10, text: `Intro on: ${topic}` },
      { label: "Point 1", sec: 14, text: `Point 1 about ${topic}` },
      { label: "Point 2", sec: 14, text: `Point 2 about ${topic}` },
      { label: "Point 3", sec: 10, text: `Point 3 about ${topic}` },
      { label: "Wrap/CTA", sec: 12, text: `Wrap and CTA for ${topic}` },
    ];
    const scenes = Array.from({ length: cfg.SCENES_COUNT }, (_, i) => ({
      i: i + 1,
      sec: Math.round(cfg.VIDEO_SEC / cfg.SCENES_COUNT),
      text: sections[Math.min(i, sections.length - 1)].text,
    }));
    const imagePrompts = Array.from(
      { length: cfg.SCENES_COUNT },
      (_, i) => `Placeholder scene ${i + 1} for ${topic}, vertical 1080x1920.`
    );
    return {
      title: topic,
      hook: `Why ${topic} matters in 60 seconds`,
      sections,
      scenes,
      imagePrompts,
      ttsStyle: "male, smooth, educational",
      disclaimer: "Educational only. Not financial advice.",
    };
  }

  const prompt = `You are a concise scriptwriter for 60-second vertical videos (TikTok).
Audience: beginner to intermediate.
Goal: educational, calm, trustworthy voice.
Topic: "${topic}"

Deliver JSON with:
{
  "title": "Short catchy title",
  "hook": "0-3s strong hook",
  "sections": [
    {"label": "Intro/Context", "sec": 10, "text": "..."},
    {"label": "Point 1", "sec": 14, "text": "..."},
    {"label": "Point 2", "sec": 14, "text": "..."},
    {"label": "Point 3", "sec": 10, "text": "..."},
    {"label": "Wrap/CTA", "sec": 9, "text": "..."}
  ],
  "image_prompts": [
    // exactly ${cfg.SCENES_COUNT} prompts for vertical 1080x1920 frames, descriptive, vivid, non-duplicative
  ],
  "tts_style": "male or female, smooth, educational",
  "disclaimer": "Educational only. Not financial advice."
}
Total seconds should sum to ~${cfg.VIDEO_SEC}. Keep jargon minimal.`;

  const res = await client.chat.completions.create({
    model: cfg.TEXT_MODEL,
    messages: [
      { role: "system", content: "Return only valid JSON. No commentary." },
      { role: "user", content: prompt },
    ],response_format: { type: "json_object" },
  });

  let data;
  try {
    data = JSON.parse(res.choices[0].message.content);
  } catch {
    throw new Error("Model did not return valid JSON.");
  }

  const total = data.sections?.reduce((a, b) => a + (b.sec || 0), 0) || cfg.VIDEO_SEC;
  const scale = cfg.VIDEO_SEC / Math.max(1, total);
  let durations = data.sections?.map((s) => Math.max(2, Math.round(s.sec * scale))) || [];
  let sum = durations.reduce((a, b) => a + b, 0);
  while (sum > cfg.VIDEO_SEC) {
    durations[durations.length - 1]--;
    sum--;
  }
  while (sum < cfg.VIDEO_SEC) {
    durations[durations.length - 1]++;
    sum++;
  }

  const scenes = [];
  let idx = 0;
  for (let i = 0; i < cfg.SCENES_COUNT; i++) {
    const sec = Math.round(cfg.VIDEO_SEC / cfg.SCENES_COUNT);
    const secText = data.sections?.[idx]?.text || data.hook || data.title;
    scenes.push({ i: i + 1, sec, text: secText });
    idx = Math.min(idx + 1, (data.sections?.length || 1) - 1);
  }

  let imagePrompts = Array.isArray(data.image_prompts) ? data.image_prompts.slice(0, cfg.SCENES_COUNT) : [];
  while (imagePrompts.length < cfg.SCENES_COUNT) {
    imagePrompts.push(`Vertical frame illustrating "${topic}", clean composition, high contrast, 1080x1920.`);
  }

  return {
    title: data.title || topic,
    hook: data.hook || "",
    sections: data.sections || [],
    scenes,
    imagePrompts,
    ttsStyle: data.tts_style || "male, smooth, educational",
    disclaimer: data.disclaimer || "",
  };
}

async function generateImage({ promptText, outPng, client, cfg, dryRun, imageStyle }) {
  if (dryRun) {
    await fs.writeFile(outPng, "");
    return;
  }
  const style = imageStyleBlock(imageStyle);
  const img = await client.images.generate({
    model: cfg.IMAGE_MODEL,
    // OpenAI Images API supports: 1024x1024, 1024x1536 (portrait), 1536x1024 (landscape), or "auto"
    // We generate portrait at 1024x1536, then ffmpeg scales to 1080x1920 during render.
    size: "1024x1536",
    prompt: `${promptText}\nStyle: ${style}; vertical 1080x1920, clean composition, minimal text.`,
    quality: "high",
  });
  const b64 = img.data[0].b64_json;
  const buf = Buffer.from(b64, "base64");
  await fs.writeFile(outPng, buf);
}

async function synthesizeTTS({ text, outMp3, client, cfg, dryRun }) {
  if (dryRun) {
    await fs.writeFile(outMp3, "");
    return;
  }
  const speech = await client.audio.speech.create({
    model: cfg.TTS_MODEL,
    voice: cfg.TTS_VOICE,
    input: text,
  });
  const buf = Buffer.from(await speech.arrayBuffer());
  await fs.writeFile(outMp3, buf);
}

// ---------- Captions / Storyboard ----------
function splitForCaptions(text, totalSec) {
  const parts = text.replace(/\n+/g, " ").split(/(?<=[.!?])\s+/).filter(Boolean).slice(0, 10);
  const each = Math.max(2, Math.floor(totalSec / Math.max(1, parts.length)));
  const spans = [];
  let t = 0;
  for (let i = 0; i < parts.length; i++) {
    const start = t;
    const end = i === parts.length - 1 ? totalSec : Math.min(totalSec, t + each);
    spans.push({ start, end, text: parts[i] });
    t = end;
  }
  if (spans.length === 0) spans.push({ start: 0, end: totalSec, text });
  return spans;
}

function toAss(cues) {
  const header = `
[Script Info]
Title=Captions
ScriptType=v4.00+
PlayResX=${WIDTH}
PlayResY=${HEIGHT}
ScaledBorderAndShadow=yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Caption,Montserrat SemiBold,64,&H00FFFFFF,&H00000000,&H96000000,&H64000000,-1,0,0,0,100,100,0,0,1,6,0,2,80,80,120,0

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`.trim();

  const lines = cues.map((c) => {
    const fmt = (s) => {
      const hh = String(Math.floor(s / 3600)).padStart(2, "0");
      const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
      const ss = (s % 60).toFixed(2).padStart(5, "0");
      return `${hh}:${mm}:${ss}`;
    };
    return `Dialogue: 0,${fmt(c.start)},${fmt(c.end)},Caption,,0,0,0,,${c.text.replace(/\n/g, "\\N")}`;
  });
  return `${header}\n${lines.join("\n")}\n`;
}

function toStoryboard(scenePngs, perScene) {
  const rows = ["filename,start,duration,cue"];
  let t = 0;
  for (let i = 0; i < scenePngs.length; i++) {
    rows.push(`${path.basename(scenePngs[i])},${t},${perScene},${i + 1}`);
    t += perScene;
  }
  return rows.join("\n") + "\n";
}

// ---------- ffmpeg helpers ----------
async function hasFfmpeg() {
  return new Promise((resolve) => {
    const p = spawn("ffmpeg", ["-version"]);
    p.on("error", () => resolve(false));
    p.on("close", (code) => resolve(code === 0));
  });
}

async function renderVideo(outDir, perScene) {
  const scenesDir = path.join(outDir, "scenes");
  const buildDir = path.join(outDir, "build");
  await ensureDir(path.join(buildDir, "segs"));

  const csv = await fs.readFile(path.join(outDir, "storyboard.csv"), "utf8");
  const lines = csv.trim().split("\n").slice(1);
  for (const line of lines) {
    if (!line.trim()) continue;
    const [fname, , durationStr] = line.split(",");
    const duration = parseInt(durationStr, 10);
    const base = fname.replace(/\.png$/i, "");
    const inP = path.join(scenesDir, fname);
    const outP = path.join(buildDir, "segs", `${base}.mp4`);

    await new Promise((resolve, reject) => {
      const args = [
        "-nostdin",
        "-y",
        "-loop",
        "1",
        "-t",
        String(duration),
        "-i",
        inP,
        "-vf",
        `scale=${WIDTH}:${HEIGHT},zoompan=z='min(zoom+0.0009,1.06)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':fps=${FPS}:d=${
          duration * FPS
        },format=yuv420p`,
        "-r",
        String(FPS),
        "-pix_fmt",
        "yuv420p",
        "-an",
        outP,
      ];
      const p = spawn("ffmpeg", args, { stdio: "inherit" });
      p.on("error", reject);
      p.on("close", (code) => (code === 0 ? resolve() : reject(new Error("ffmpeg seg fail"))));
    });
  }

  const concatTxt = (await fs.readdir(path.join(buildDir, "segs")))
    .filter((f) => f.endsWith(".mp4"))
    .sort()
    .map((f) => `file '${path.join(buildDir, "segs", f)}'`)
    .join("\n");
  const concatPath = path.join(buildDir, "concat.txt");
  await fs.writeFile(concatPath, concatTxt, "utf8");

  const nocaptions = path.join(buildDir, "video_nocaptions.mp4");
  await new Promise((resolve, reject) => {
    const p = spawn("ffmpeg", ["-nostdin", "-y", "-f", "concat", "-safe", "0", "-i", concatPath, "-c", "copy", nocaptions], {
      stdio: "inherit",
    });
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve() : reject(new Error("concat fail"))));
  });

  const captions = path.join(outDir, "captions.ass");
  const withCaptions = path.join(buildDir, "video_captions.mp4");
  await new Promise((resolve, reject) => {
    const p = spawn("ffmpeg", ["-nostdin", "-y", "-i", nocaptions, "-vf", `ass=${captions}`, "-c:a", "copy", withCaptions], {
      stdio: "inherit",
    });
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve() : reject(new Error("burn captions fail"))));
  });

  const voice = path.join(outDir, "audio", "voiceover.mp3");
  const music = path.join(outDir, "audio", "music.mp3");
  const output = path.join(outDir, "output.mp4");

  const exists = async (p) => !!(await fs.stat(p).catch(() => false));
  const haveVO = await exists(voice);
  const haveBG = await exists(music);

  if (haveVO && haveBG) {
    await new Promise((resolve, reject) => {
      const args = [
        "-nostdin",
        "-y",
        "-i",
        withCaptions,
        "-i",
        voice,
        "-i",
        music,
        "-filter_complex",
        "[1:a]aformat=channel_layouts=stereo,volume=1.0[vo];[2:a]aformat=channel_layouts=stereo,compand=gain=-2[bg];[bg][vo]sidechaincompress=threshold=0.05:ratio=8:attack=5:release=300[ducked];[ducked]volume=0.5[mix]",
        "-map",
        "0:v",
        "-map",
        "[mix]",
        "-c:v",
        "libx264",
        "-profile:v",
        "high",
        "-level",
        "4.1",
        "-pix_fmt",
        "yuv420p",
        "-r",
        String(FPS),
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-shortest",
        output,
      ];
      const p = spawn("ffmpeg", args, { stdio: "inherit" });
      p.on("error", reject);
      p.on("close", (code) => (code === 0 ? resolve() : reject(new Error("audio mix fail"))));
    });
  } else if (haveVO) {
    await new Promise((resolve, reject) => {
      const p = spawn(
        "ffmpeg",
        [
          "-nostdin",
          "-y",
          "-i",
          withCaptions,
          "-i",
          voice,
          "-map",
          "0:v",
          "-map",
          "1:a",
          "-c:v",
          "libx264",
          "-pix_fmt",
          "yuv420p",
          "-r",
          String(FPS),
          "-c:a",
          "aac",
          "-b:a",
          "192k",
          "-shortest",
          output,
        ],
        { stdio: "inherit" }
      );
      p.on("error", reject);
      p.on("close", (code) => (code === 0 ? resolve() : reject(new Error("mux VO fail"))));
    });
  } else if (haveBG) {
    await new Promise((resolve, reject) => {
      const p = spawn(
        "ffmpeg",
        [
          "-nostdin",
          "-y",
          "-i",
          withCaptions,
          "-i",
          music,
          "-map",
          "0:v",
          "-map",
          "1:a",
          "-c:v",
          "libx264",
          "-pix_fmt",
          "yuv420p",
          "-r",
          String(FPS),
          "-c:a",
          "aac",
          "-b:a",
          "192k",
          "-shortest",
          output,
        ],
        { stdio: "inherit" }
      );
      p.on("error", reject);
      p.on("close", (code) => (code === 0 ? resolve() : reject(new Error("mux music fail"))));
    });
  } else {
    await fs.copyFile(withCaptions, output);
  }

  console.log(`\n✅ Rendered ${output}`);
}

// ---------- Public API ----------
export async function run(topic, options = {}) {
  if (!topic || typeof topic !== "string") {
    throw new Error('Missing required "topic"');
  }

  const userCfg = await loadUserConfig();

  // Precedence: env > user config > defaults
  const cfg = {
    TEXT_MODEL: process.env.TEXT_MODEL || userCfg.TEXT_MODEL || DEFAULTS.TEXT_MODEL,
    IMAGE_MODEL: process.env.IMAGE_MODEL || userCfg.IMAGE_MODEL || DEFAULTS.IMAGE_MODEL,
    TTS_MODEL: process.env.TTS_MODEL || userCfg.TTS_MODEL || DEFAULTS.TTS_MODEL,
    TTS_VOICE: process.env.TTS_VOICE || userCfg.TTS_VOICE || DEFAULTS.TTS_VOICE,
    VIDEO_SEC: parseInt(process.env.VIDEO_SEC || userCfg.VIDEO_SEC || DEFAULTS.VIDEO_SEC, 10),
    SCENES_COUNT: parseInt(process.env.SCENES_COUNT || userCfg.SCENES_COUNT || DEFAULTS.SCENES_COUNT, 10),
    ELEVENLABS_API_KEY: process.env.ELEVENLABS_API_KEY || userCfg.ELEVENLABS_API_KEY,
  };

  const dryRun = options.dryRun === true;

  // Gender -> voice mapping (flags override env/default)
  if (options.gender === "male") cfg.TTS_VOICE = "alloy";
  if (options.gender === "female") cfg.TTS_VOICE = "luna";

  // Image style selection (default cartoon)
  const imageStyle = options.style || "cartoon";

  const OPENAI_API_KEY = process.env.OPENAI_API_KEY || userCfg.OPENAI_API_KEY || "";
  if (!OPENAI_API_KEY && !dryRun) {
    throw new Error("Missing OPENAI_API_KEY. Set environment variable or run 'viral setup'.");
  }
  const client = dryRun ? null : new OpenAI({ apiKey: OPENAI_API_KEY });

  const slug = slugify(topic);
  const outDir = path.join(process.cwd(), "build", slug);
  const scenesDir = path.join(outDir, "scenes");
  const audioDir = path.join(outDir, "audio");
  await ensureDir(scenesDir);
  await ensureDir(audioDir);

  const plan = await generateScript({ topic, client, cfg, dryRun });

  // Override ttsStyle in saved metadata when gender flag provided
  if (options.gender) {
    plan.ttsStyle = `${options.gender}, smooth, educational`;
  }

  const voText = [plan.hook, ...plan.sections.map((s) => s.text), plan.disclaimer].filter(Boolean).join("\n");
  await writeJSON(path.join(outDir, "script.json"), plan);
  await fs.writeFile(path.join(outDir, "voiceover.txt"), voText, "utf8");

  const perScene = Math.round(cfg.VIDEO_SEC / cfg.SCENES_COUNT);
  const sceneFiles = [];
  for (let i = 0; i < cfg.SCENES_COUNT; i++) {
    const prompt =
      plan.imagePrompts[i] ||
      `${topic}, ${imageStyle === "realistic" ? "photorealistic" : imageStyle === "ai-generated" ? "AI-generated" : "stylized cartoon"} vertical frame, 1080x1920.`;
    const name = `scene${String(i + 1).padStart(2, "0")}.png`;
    const outPng = path.join(scenesDir, name);
    await generateImage({ promptText: prompt, outPng, client, cfg, dryRun, imageStyle });
    sceneFiles.push(outPng);
  }

  await synthesizeTTS({ text: voText, outMp3: path.join(audioDir, "voiceover.mp3"), client, cfg, dryRun });

  const cues = splitForCaptions(voText, cfg.VIDEO_SEC);
  const assText = toAss(cues);
  await fs.writeFile(path.join(outDir, "captions.ass"), assText, "utf8");
  const storyboard = toStoryboard(sceneFiles, perScene);
  await fs.writeFile(path.join(outDir, "storyboard.csv"), storyboard, "utf8");

  const readme = `# Video kit for: ${topic}
- Scenes: ${cfg.SCENES_COUNT} PNGs in scenes/
- Voiceover: audio/voiceover.mp3 (voice: ${cfg.TTS_VOICE})
- Captions: captions.ass
- Storyboard: storyboard.csv
- Duration: ~${cfg.VIDEO_SEC}s, ${perScene}s per scene
- Image style: ${imageStyle}

## Render
If ffmpeg is installed, this CLI can render output.mp4 automatically.
- macOS:  brew install ffmpeg
- Ubuntu: sudo apt-get update && sudo apt-get install -y ffmpeg
`;
  await fs.writeFile(path.join(outDir, "README.md"), readme, "utf8");

  if (!dryRun && (await hasFfmpeg())) {
    await renderVideo(outDir, perScene);
  } else if (!dryRun) {
    console.log("⚠️ ffmpeg not found. Assets are ready in:", outDir);
  }

  return outDir;
}