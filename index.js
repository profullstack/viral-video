#!/usr/bin/env node
// make-video.mjs
// ESM CLI to generate a 60s vertical video kit + (optional) render MP4 using ffmpeg
// Uses OpenAI: GPT-5 for script, gpt-image-1 for images, gpt-4o-mini-tts for TTS.
// Models reference: GPT-5 / gpt-image-1 / audio.speech TTS. 
// Docs: platform.openai.com (models, images, audio). 

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import axios from "axios";
import OpenAI from "openai";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---------- Config ----------
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
if (!OPENAI_API_KEY) {
  console.error("Missing OPENAI_API_KEY env var.");
  process.exit(1);
}

const TEXT_MODEL   = process.env.TEXT_MODEL   || "gpt-5";           // main writer
const IMAGE_MODEL  = process.env.IMAGE_MODEL  || "gpt-image-1";     // image gen
const TTS_MODEL    = process.env.TTS_MODEL    || "gpt-4o-mini-tts"; // TTS
const TTS_VOICE    = process.env.TTS_VOICE    || "alloy";           // alloy is a solid default
const VIDEO_SEC    = parseInt(process.env.VIDEO_SEC || "60", 10);
const SCENES_COUNT = parseInt(process.env.SCENES_COUNT || "6", 10);
const WIDTH        = 1080;
const HEIGHT       = 1920;
const FPS          = 30;

const client = new OpenAI({ apiKey: OPENAI_API_KEY });

// ---------- Arg parsing ----------
const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, cur, i, arr) => {
    if (cur.startsWith("--")) {
      const k = cur.replace(/^--/, "");
      const v = arr[i + 1] && !arr[i + 1].startsWith("--") ? arr[i + 1] : true;
      acc.push([k, v]);
    }
    return acc;
  }, [])
);

if (!args.topic || typeof args.topic !== "string") {
  console.error("Usage: node make-video.mjs --topic \"Your video topic\"");
  process.exit(1);
}

function slugify(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}
const slug = slugify(args.topic);

// ---------- FS helpers ----------
async function ensureDir(p) { await fs.mkdir(p, { recursive: true }); }
async function writeJSON(p, obj) { await fs.writeFile(p, JSON.stringify(obj, null, 2), "utf8"); }

// ---------- Step 1: Script & scene breakdown with GPT-5 ----------
async function generateScript(topic) {
  const prompt = `You are a concise scriptwriter for 60-second vertical videos (TikTok).
Audience: beginner to intermediate.
Goal: educational, calm, trustworthy male voice.
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
    // exactly ${SCENES_COUNT} prompts for vertical 1080x1920 stylized cartoon frames, 
    // each descriptive, vivid, and non-duplicative
  ],
  "tts_style": "male, smooth, educational",
  "disclaimer": "Educational only. Not financial advice."
}
Total seconds should sum to ~${VIDEO_SEC}. Keep jargon minimal.`;

  const res = await client.chat.completions.create({
    model: TEXT_MODEL,
    messages: [
      { role: "system", content: "Return only valid JSON. No commentary." },
      { role: "user", content: prompt }
    ],
    temperature: 0.6,
    response_format: { type: "json_object" }
  });

  let data;
  try {
    data = JSON.parse(res.choices[0].message.content);
  } catch (e) {
    throw new Error("Model did not return valid JSON.");
  }

  // Normalize sections to exactly SCENES_COUNT segments by splitting/merging if needed
  const total = data.sections?.reduce((a, b) => a + (b.sec || 0), 0) || VIDEO_SEC;
  const scale = VIDEO_SEC / Math.max(1, total);
  let durations = data.sections?.map(s => Math.max(2, Math.round(s.sec * scale))) || [];
  let sum = durations.reduce((a,b)=>a+b,0);
  while (sum > VIDEO_SEC) { durations[durations.length-1]--; sum--; }
  while (sum < VIDEO_SEC) { durations[durations.length-1]++; sum++; }

  // Build scene list length = SCENES_COUNT from sections (split if fewer)
  const scenes = [];
  let idx = 0;
  for (let i=0; i<SCENES_COUNT; i++) {
    const sec = Math.round(VIDEO_SEC/SCENES_COUNT);
    const secText = data.sections?.[idx]?.text || data.hook || data.title;
    scenes.push({ i: i+1, sec, text: secText });
    idx = Math.min(idx+1, (data.sections?.length||1)-1);
  }

  // If model didn't give enough image prompts, synthesize them
  let imagePrompts = Array.isArray(data.image_prompts) ? data.image_prompts.slice(0, SCENES_COUNT) : [];
  while (imagePrompts.length < SCENES_COUNT) {
    imagePrompts.push(`Stylized cartoon vertical frame illustrating "${args.topic}", clean composition, soft gradients, bold outlines, high contrast, 1080x1920.`);
  }

  return {
    title: data.title || args.topic,
    hook: data.hook || "",
    sections: data.sections || [],
    scenes,
    imagePrompts,
    ttsStyle: data.tts_style || "male, smooth, educational",
    disclaimer: data.disclaimer || ""
  };
}

// ---------- Step 2: Generate images (gpt-image-1) ----------
async function generateImage(promptText, outPng) {
  const img = await client.images.generate({
    model: IMAGE_MODEL,
    size: `${WIDTH}x${HEIGHT}`,
    prompt: `${promptText}\nStyle: stylized, cartoon, vertical 1080x1920, clean UI-like layout, minimal text.`,
    quality: "high"
  });
  const b64 = img.data[0].b64_json;
  const buf = Buffer.from(b64, "base64");
  await fs.writeFile(outPng, buf);
}

// ---------- Step 3: TTS (audio/speech) ----------
async function synthesizeTTS(text, outMp3) {
  const speech = await client.audio.speech.create({
    model: TTS_MODEL,
    voice: TTS_VOICE,
    input: text
  });
  const buf = Buffer.from(await speech.arrayBuffer());
  await fs.writeFile(outMp3, buf);
}

// ---------- Step 4: Build captions.ass & storyboard.csv ----------
function splitForCaptions(text, totalSec) {
  // naive split by sentences; assign equal ranges
  const parts = text
    .replace(/\n+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .filter(Boolean)
    .slice(0, 10);

  const each = Math.max(2, Math.floor(totalSec / Math.max(1, parts.length)));
  const spans = [];
  let t = 0;
  for (let i = 0; i < parts.length; i++) {
    const start = t;
    const end = (i === parts.length - 1) ? totalSec : Math.min(totalSec, t + each);
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

  const lines = cues.map(c => {
    const fmt = (s) => {
      const hh = String(Math.floor(s / 3600)).padStart(2, "0");
      const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
      const ss = (s % 60).toFixed(2).padStart(5, "0");
      return `${hh}:${mm}:${ss}`;
    };
    return `Dialogue: 0,${fmt(c.start)},${fmt(c.end)},Caption,,0,0,0,,${c.text.replace(/\n/g,"\\N")}`;
  });
  return `${header}\n${lines.join("\n")}\n`;
}

function toStoryboard(scenePngs, perScene) {
  const rows = ["filename,start,duration,cue"];
  let t = 0;
  for (let i = 0; i < scenePngs.length; i++) {
    rows.push(`${path.basename(scenePngs[i])},${t},${perScene},${i+1}`);
    t += perScene;
  }
  return rows.join("\n") + "\n";
}

// ---------- Step 5 (optional): Render with ffmpeg ----------
async function hasFfmpeg() {
  return new Promise((resolve) => {
    const p = spawn("ffmpeg", ["-version"]);
    p.on("error", () => resolve(false));
    p.on("close", (code) => resolve(code === 0));
  });
}

async function renderVideo(outDir, perScene) {
  const scenesDir = path.join(outDir, "scenes");
  const buildDir  = path.join(outDir, "build");
  await ensureDir(path.join(buildDir, "segs"));

  // Generate each segment with gentle Ken Burns
  const csv = await fs.readFile(path.join(outDir, "storyboard.csv"), "utf8");
  const lines = csv.trim().split("\n").slice(1);
  for (const line of lines) {
    if (!line.trim()) continue;
    const [fname,, durationStr] = line.split(",");
    const duration = parseInt(durationStr, 10);
    const base = fname.replace(/\.png$/i, "");
    const inP = path.join(scenesDir, fname);
    const outP = path.join(buildDir, "segs", `${base}.mp4`);

    await new Promise((resolve, reject) => {
      const args = [
        "-nostdin", "-y",
        "-loop", "1", "-t", String(duration), "-i", inP,
        "-vf", `scale=${WIDTH}:${HEIGHT},zoompan=z='min(zoom+0.0009,1.06)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':fps=${FPS}:d=${duration*FPS},format=yuv420p`,
        "-r", String(FPS),
        "-pix_fmt", "yuv420p",
        "-an", outP
      ];
      const p = spawn("ffmpeg", args, { stdio: "inherit" });
      p.on("error", reject);
      p.on("close", code => code===0?resolve():reject(new Error("ffmpeg seg fail")));
    });
  }

  // Concat
  const concatTxt = (await fs.readdir(path.join(buildDir, "segs")))
    .filter(f => f.endsWith(".mp4"))
    .sort()
    .map(f => `file '${path.join(buildDir, "segs", f)}'`)
    .join("\n");
  const concatPath = path.join(buildDir, "concat.txt");
  await fs.writeFile(concatPath, concatTxt, "utf8");

  const nocaptions = path.join(buildDir, "video_nocaptions.mp4");
  await new Promise((resolve, reject) => {
    const p = spawn("ffmpeg", ["-nostdin","-y","-f","concat","-safe","0","-i",concatPath,"-c","copy",nocaptions], { stdio: "inherit" });
    p.on("error", reject);
    p.on("close", code => code===0?resolve():reject(new Error("concat fail")));
  });

  // Burn captions
  const captions = path.join(outDir, "captions.ass");
  const withCaptions = path.join(buildDir, "video_captions.mp4");
  await new Promise((resolve, reject) => {
    const p = spawn("ffmpeg", ["-nostdin","-y","-i",nocaptions,"-vf",`ass=${captions}`,"-c:a","copy",withCaptions], { stdio: "inherit" });
    p.on("error", reject);
    p.on("close", code => code===0?resolve():reject(new Error("burn captions fail")));
  });

  // Mix audio (duck music if present)
  const voice = path.join(outDir, "audio", "voiceover.mp3");
  const music = path.join(outDir, "audio", "music.mp3");
  const output = path.join(outDir, "output.mp4");

  const exists = async p => !!(await fs.stat(p).catch(()=>false));
  const haveVO = await exists(voice);
  const haveBG = await exists(music);

  if (haveVO && haveBG) {
    await new Promise((resolve, reject) => {
      const args = [
        "-nostdin","-y",
        "-i", withCaptions, "-i", voice, "-i", music,
        "-filter_complex",
        "[1:a]aformat=channel_layouts=stereo,volume=1.0[vo];[2:a]aformat=channel_layouts=stereo,compand=gain=-2[bg];[bg][vo]sidechaincompress=threshold=0.05:ratio=8:attack=5:release=300[ducked];[ducked]volume=0.5[mix]",
        "-map","0:v","-map","[mix]",
        "-c:v","libx264","-profile:v","high","-level","4.1","-pix_fmt","yuv420p","-r",String(FPS),
        "-c:a","aac","-b:a","192k","-shortest", output
      ];
      const p = spawn("ffmpeg", args, { stdio: "inherit" });
      p.on("error", reject);
      p.on("close", code => code===0?resolve():reject(new Error("audio mix fail")));
    });
  } else if (haveVO) {
    await new Promise((resolve, reject) => {
      const p = spawn("ffmpeg", ["-nostdin","-y","-i",withCaptions,"-i",voice,"-map","0:v","-map","1:a","-c:v","libx264","-pix_fmt","yuv420p","-r",String(FPS),"-c:a","aac","-b:a","192k","-shortest", output], { stdio: "inherit" });
      p.on("error", reject);
      p.on("close", code => code===0?resolve():reject(new Error("mux VO fail")));
    });
  } else if (haveBG) {
    await new Promise((resolve, reject) => {
      const p = spawn("ffmpeg", ["-nostdin","-y","-i",withCaptions,"-i",music,"-map","0:v","-map","1:a","-c:v","libx264","-pix_fmt","yuv420p","-r",String(FPS),"-c:a","aac","-b:a","192k","-shortest", output], { stdio: "inherit" });
      p.on("error", reject);
      p.on("close", code => code===0?resolve():reject(new Error("mux music fail")));
    });
  } else {
    await fs.copyFile(withCaptions, output);
  }

  console.log(`\n✅ Rendered ${output}`);
}

// ---------- Main ----------
(async () => {
  const outDir = path.join(process.cwd(), `video-${slug}`);
  const scenesDir = path.join(outDir, "scenes");
  const audioDir  = path.join(outDir, "audio");
  await ensureDir(scenesDir);
  await ensureDir(audioDir);

  console.log("🔮 Generating script with GPT-5...");
  const plan = await generateScript(args.topic);

  // Build voiceover text (hook + sections + disclaimer)
  const voText = [
    plan.hook,
    ...plan.sections.map(s => s.text),
    plan.disclaimer
  ].filter(Boolean).join("\n");

  await fs.writeFile(path.join(outDir, "script.json"), JSON.stringify(plan, null, 2), "utf8");
  await fs.writeFile(path.join(outDir, "voiceover.txt"), voText, "utf8");

  console.log("🎨 Generating scene images...");
  const perScene = Math.round(VIDEO_SEC / SCENES_COUNT);
  const sceneFiles = [];
  for (let i=0; i<SCENES_COUNT; i++) {
    const prompt = plan.imagePrompts[i] || `${args.topic}, stylized cartoon vertical frame, 1080x1920.`;
    const name = `scene${String(i+1).padStart(2,"0")}.png`;
    await generateImage(prompt, path.join(scenesDir, name));
    sceneFiles.push(path.join(scenesDir, name));
  }

  console.log("🔊 Synthesizing voiceover (OpenAI TTS)...");
  await synthesizeTTS(voText, path.join(audioDir, "voiceover.mp3"));

  console.log("💬 Creating captions & storyboard...");
  const cues = splitForCaptions(voText, VIDEO_SEC);
  const assText = toAss(cues);
  await fs.writeFile(path.join(outDir, "captions.ass"), assText, "utf8");
  const storyboard = toStoryboard(sceneFiles, perScene);
  await fs.writeFile(path.join(outDir, "storyboard.csv"), storyboard, "utf8");

  // Add a README
  const readme = `# Video kit for: ${args.topic}
- Scenes: ${SCENES_COUNT} PNGs in scenes/
- Voiceover: audio/voiceover.mp3
- Captions: captions.ass
- Storyboard: storyboard.csv
- Duration: ~${VIDEO_SEC}s, ${perScene}s per scene

## Render
If ffmpeg is installed, this CLI will render output.mp4 automatically.
If not, install ffmpeg and rerun:
  - macOS:  brew install ffmpeg
  - Ubuntu: sudo apt-get update && sudo apt-get install -y ffmpeg
`;
  await fs.writeFile(path.join(outDir, "README.md"), readme, "utf8");

  // Try rendering automatically
  if (await hasFfmpeg()) {
    console.log("🎬 ffmpeg detected — rendering output.mp4...");
    await renderVideo(outDir, perScene);
  } else {
    console.log("⚠️ ffmpeg not found. Assets are ready in:", outDir);
  }
})().catch(err => {
  console.error("Build failed:", err?.message || err);
  process.exit(1);
});
