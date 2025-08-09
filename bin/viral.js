#!/usr/bin/env node
// bin/viral.js - CLI entry for "viral"
// ESM, Node 20+, zero external CLI deps.
//
// Commands:
//   viral setup                      -> interactive or flag-based config at ~/.config/viral-video/config.json
//   viral create --topic "..."       -> generate assets (current behavior), flags preserved
//
// Flags for "create":
//   --topic "..."                    Topic for the 60s video (required)
//   --male | --female                Select TTS voice gender (overrides config/env TTS_VOICE)
//   --cartoon | --realistic | --ai-generated   Image style (default: cartoon)
//   --dry-run                        Skip external APIs (OpenAI) and ffmpeg; validate flow only
//
 // Flags for "setup" (non-interactive):
 //   --openai-key KEY
 //   --elevenlabs-key KEY
 //   --text-model NAME
 //   --image-model NAME
 //   --tts-model NAME
 //   --voice NAME
 //   --video-sec N
 //   --scenes-count N
//
// Env precedence: environment variables override config; config overrides defaults.

import process from 'node:process';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import { run } from '../src/index.js';

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const cur = argv[i];
    if (!cur.startsWith('--')) continue;
    const k = cur.slice(2);
    const peek = argv[i + 1];
    const v = peek && !peek.startsWith('--') ? (argv[i++], peek) : true;
    args[k] = v;
  }
  return args;
}

function pickGender(argv) {
  let gender = null;
  for (const cur of argv) {
    if (cur === '--male') gender = 'male';
    if (cur === '--female') gender = 'female';
  }
  return gender;
}

function pickStyle(argv) {
  let style = null;
  for (const cur of argv) {
    if (cur === '--cartoon') style = 'cartoon';
    if (cur === '--realistic') style = 'realistic';
    if (cur === '--ai-generated') style = 'ai-generated';
  }
  return style;
}

function configPaths() {
  const home = os.homedir();
  const cfgRoot = process.env.XDG_CONFIG_HOME || path.join(home, '.config');
  const dir = path.join(cfgRoot, 'viral-video');
  const file = path.join(dir, 'config.json');
  return { dir, file };
}

function usage(exitCode = 1) {
  console.error(`Usage:
  viral <command> [options]

Commands:
  setup                           Configure API keys and defaults (writes ~/.config/viral-video/config.json)
  create --topic "..."            Generate a 60s vertical video kit

Create options:
  --topic "..."                   Topic for the 60s video (required)
  --male | --female               TTS voice gender override
  --cartoon | --realistic | --ai-generated   Image style (default: cartoon)
  --dry-run                       Skip external APIs and ffmpeg; validate flow only

Setup options (can be used non-interactively):
  --openai-key KEY
  --elevenlabs-key KEY
  --text-model NAME
  --image-model NAME
  --tts-model NAME
  --voice NAME
  --video-sec N
  --scenes-count N

Environment variables override config values:
  OPENAI_API_KEY, ELEVENLABS_API_KEY, TEXT_MODEL, IMAGE_MODEL, TTS_MODEL, TTS_VOICE, VIDEO_SEC, SCENES_COUNT

Examples:
  viral setup
  viral setup --openai-key sk-... --elevenlabs-key el-... --voice luna --video-sec 60
  viral create --topic "Dollar-cost averaging" --female --realistic
  DRY_RUN=1 viral create --topic "SEC Bitcoin ETF timeline" --ai-generated
`);
  process.exit(exitCode);
}

async function prompt(question, { mask = false } = {}) {
  if (!process.stdin.isTTY) return null;
  return new Promise((resolve) => {
    process.stdout.write(question);
    if (mask && process.stdin.setRawMode) {
      let input = '';
      const onData = (buf) => {
        const s = buf.toString('utf8');
        if (s === '\n' || s === '\r') {
          process.stdout.write('\n');
          process.stdin.off('data', onData);
          process.stdin.setRawMode(false);
          resolve(input);
          return;
        }
        if (s === '\u0003') { // Ctrl+C
          process.stdout.write('\n');
          process.exit(1);
        }
        input += s;
        process.stdout.write('*');
      };
      process.stdin.setRawMode(true);
      process.stdin.resume();
      process.stdin.on('data', onData);
    } else {
      const chunks = [];
      process.stdin.once('data', (d) => {
        chunks.push(d);
        const s = Buffer.concat(chunks).toString('utf8').trim();
        resolve(s);
      });
    }
  });
}

async function setupCommand(args) {
  const { dir, file } = configPaths();

  // Prefer flags; fall back to interactive prompts if TTY.
  let OPENAI_API_KEY = args['openai-key'];
  if (!OPENAI_API_KEY) {
    OPENAI_API_KEY = await prompt('Enter OPENAI_API_KEY: ', { mask: true });
  }

  // Optional: ElevenLabs key (interactive prompt is optional)
  let ELEVENLABS_API_KEY = args['elevenlabs-key'];
  if (!ELEVENLABS_API_KEY && process.stdin.isTTY) {
    const entered = await prompt('Enter ELEVENLABS_API_KEY (optional, press Enter to skip): ', { mask: true });
    ELEVENLABS_API_KEY = (entered || '').trim();
  }

  // Optional defaults
  const defaults = {
    TEXT_MODEL: args['text-model'],
    IMAGE_MODEL: args['image-model'],
    TTS_MODEL: args['tts-model'],
    TTS_VOICE: args['voice'],
    VIDEO_SEC: args['video-sec'] ? parseInt(args['video-sec'], 10) : undefined,
    SCENES_COUNT: args['scenes-count'] ? parseInt(args['scenes-count'], 10) : undefined,
  };

  if (!OPENAI_API_KEY || typeof OPENAI_API_KEY !== 'string' || OPENAI_API_KEY.trim() === '') {
    console.error('Missing OPENAI_API_KEY. Provide via --openai-key or interactive prompt.');
    process.exit(1);
  }

  const cfg = {
    OPENAI_API_KEY: OPENAI_API_KEY.trim(),
    ...Object.fromEntries(Object.entries(defaults).filter(([, v]) => v !== undefined && v !== '')),
  };

  if (ELEVENLABS_API_KEY && ELEVENLABS_API_KEY.trim() !== '') {
    cfg.ELEVENLABS_API_KEY = ELEVENLABS_API_KEY.trim();
  }

  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(file, JSON.stringify(cfg, null, 2), { encoding: 'utf8', mode: 0o600 });
  try {
    await fs.chmod(file, 0o600);
  } catch {}
  console.log(`Saved configuration to: ${file}`);
}

async function createCommand(argv, args) {
  if (!args.topic || typeof args.topic !== 'string') {
    console.error('Missing required --topic for "create".');
    usage(1);
  }
  const dryRun = args['dry-run'] === true || process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true';
  const gender = pickGender(argv);
  const style = pickStyle(argv);

  try {
    const outDir = await run(args.topic, { dryRun, gender, style });
    if (dryRun) {
      console.log(`DRY_RUN complete. Prepared (or validated) directory: ${outDir}`);
    }
  } catch (err) {
    console.error('viral failed:', err?.message || err);
    process.exit(1);
  }
}

(async () => {
  const argv = process.argv.slice(2);

  // Subcommand detection: default to usage unless either explicit "create"/"setup" or legacy flags.
  const sub = argv[0] && !argv[0].startsWith('--') ? argv[0] : null;

  if (sub === 'setup') {
    const args = parseArgs(argv.slice(1));
    await setupCommand(args);
    return;
  }

  if (sub === 'create') {
    const rest = argv.slice(1);
    const args = parseArgs(rest);
    await createCommand(rest, args);
    return;
  }

  // Legacy fallback: if user passes flags (e.g., --topic ...) without subcommand, treat as "create".
  if (argv.length && argv[0].startsWith('--')) {
    const args = parseArgs(argv);
    await createCommand(argv, args);
    return;
  }

  usage(1);
})();
