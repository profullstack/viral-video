
# Viral Video Kit • 60‑sec Vertical Videos

<!-- BADGES:START -->
<p align="left">
  <a href="./package.json"><img alt="version" src="https://img.shields.io/badge/version-0.1.0-blue?style=for-the-badge"></a>
  <a href="#license"><img alt="license" src="https://img.shields.io/badge/license-MIT-green?style=for-the-badge"></a>
  <a href="./package.json"><img alt="node" src="https://img.shields.io/badge/node-%3E%3D20.0.0-339933?logo=node.js&amp;logoColor=white&amp;style=for-the-badge"></a>
  <a href="https://pnpm.io/"><img alt="pnpm" src="https://img.shields.io/badge/pnpm-9%2B-F69220?logo=pnpm&amp;logoColor=white&amp;style=for-the-badge"></a>
  <a href="https://mochajs.org/"><img alt="tests" src="https://img.shields.io/badge/tests-Mocha-8D6748?logo=mocha&amp;logoColor=white&amp;style=for-the-badge"></a>
  <a href="https://nodejs.org/api/esm.html"><img alt="esm" src="https://img.shields.io/badge/ESM-Enabled-000000?style=for-the-badge"></a>
</p>
<!-- BADGES:END -->
Generate a complete short‑video kit from a topic: script, scene images, captions, voiceover, and an optional rendered MP4. Built for Node.js 20+ using modern ESM.

Core files:
- CLI entry: [bin/viral.js](bin/viral.js)
- Main runtime: [run()](src/index.js:460)
- Image generation helper: [generateImage()](src/index.js:176)
- CLI helpers: [usage()](bin/viral.js:72), [setupCommand()](bin/viral.js:143), [prompt()](bin/viral.js:107)

Features
- 1080×1920 vertical target with smooth zoom pan
- Script+captions tailored to the requested duration
- Per‑scene image prompts; styles: cartoon, realistic, ai-generated
- Voiceover via OpenAI TTS (ElevenLabs key persisted for future TTS integration)
- Config precedence: environment > user config > defaults

Requirements
- Node.js 20+
- pnpm 9+
- ffmpeg (optional, for auto‑render)

Install

```bash
pnpm install
```

Optionally link CLI globally:

```bash
pnpm link --global
# then you can run: viral ...
```

Setup

Use interactive mode to save API keys at ~/.config/viral-video/config.json (0600 perms):

```bash
viral setup
```

Or non‑interactive:

```bash
viral setup --openai-key sk-... --elevenlabs-key el-... --voice luna --video-sec 60
```

Create a video kit

```bash
viral create --topic "How to make money while you sleep" --male --cartoon
```

Flags
- --topic "..." required
- --male | --female sets TTS voice preset
- --cartoon | --realistic | --ai-generated image style
- --dry-run validate flow without calling APIs or ffmpeg

What gets generated

Inside build/your-topic/:
- vertical/
  - scenes/sceneXX.png: portrait frames (generated at 1024×1536, upscaled to 1080×1920 on render)
  - audio/voiceover.mp3 (copied)
  - captions.ass
  - storyboard.csv
  - build/: intermediate segments and rendered artifacts
  - output.mp4: final portrait video (when ffmpeg available)
- horizontal/
  - scenes/sceneXX.png: landscape frames (generated at 1536×1024, upscaled to 1920×1080 on render)
  - audio/voiceover.mp3 (copied)
  - captions.ass
  - storyboard.csv
  - build/: intermediate segments and rendered artifacts
  - output.mp4: final landscape video (when ffmpeg available)
- audio/voiceover.mp3: root voiceover source
- README.md: per‑video instructions

Rendering details

The pipeline scales frames using ffmpeg to 1080×1920:
- We request OpenAI images at 1024×1536 (portrait) due to API constraints, then upscale to 1080×1920 during render.
- If ffmpeg is installed, rendering runs automatically:
  - macOS: brew install ffmpeg
  - Ubuntu: sudo apt-get update && sudo apt-get install -y ffmpeg

Configuration

Precedence: env > user config > defaults. The config loader lives in [run()](src/index.js:460) and the setup logic is in [setupCommand()](bin/viral.js:143).

Environment variables
- OPENAI_API_KEY: required unless DRY_RUN=1
- ELEVENLABS_API_KEY: optional (future TTS)
- TEXT_MODEL (default gpt-5)
- IMAGE_MODEL (default gpt-image-1)
- TTS_MODEL (default gpt-4o-mini-tts)
- TTS_VOICE (default alloy; use luna for female)
- VIDEO_SEC (default 60)
- SCENES_COUNT (default 6)

User config file
- Path: ~/.config/viral-video/config.json or $XDG_CONFIG_HOME/viral-video/config.json
- Written by [setupCommand()](bin/viral.js:143) with chmod 600

Examples

Validate without APIs:

```bash
DRY_RUN=1 viral create --topic "SEC Bitcoin ETF timeline" --ai-generated
```

Female realistic style:

```bash
viral create --topic "Dollar-cost averaging explained" --female --realistic
```

Troubleshooting
- Missing OPENAI_API_KEY: run viral setup or export OPENAI_API_KEY.
- “Unsupported image size”: fixed by generating 1024×1536 and scaling during render in [generateImage()](src/index.js:176).
- Interactive setup “hang”: resolved by releasing stdin in [prompt()](bin/viral.js:107).

Development

```bash
pnpm test
pnpm lint
pnpm format
```

License

MIT
