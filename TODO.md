# Viral Video Kit — Architecture Duplication Plan

Goal: Mirror the CLI/package architecture from [amazon-affiliate-video-automation](/home/ettinger/src/profullstack.com/amazon-affiliate/README.md) while keeping this project minimal and focused. Provide a `viral` CLI with `--topic` shortcut that orchestrates the existing generator.

## Checklist

- [ ] Initialize Node.js ESM package layout (pnpm-based) similar to the reference project
  - [ ] Create package.json with:
    - `"type": "module"`
    - `"bin": { "viral": "./bin/viral.js" }`
    - Mocha + Chai test scripts
    - ESLint + Prettier scripts
    - `"packageManager": "pnpm@>=9"`
- [ ] CLI entry: `bin/viral.js`
  - [ ] Shebang, ESM import
  - [ ] Parse `--topic "..."` (minimal parser, no heavy deps)
  - [ ] Support `DRY_RUN=1 viral --topic "..."` for tests (no external API calls)
- [ ] Refactor generator into `src/index.js`
  - [ ] Export `run(topic, options)` (no process.exit inside core)
  - [ ] Reuse/improve existing functions (script, images, TTS, captions, render)
  - [ ] Guard: fail early when `OPENAI_API_KEY` missing unless `dryRun: true`
- [ ] Tests (Mocha + Chai) under `./tests/`
  - [ ] `tests/cli/viral.test.js`:
    - [ ] Without `--topic` returns usage and non-zero exit
    - [ ] With `DRY_RUN=1` and `--topic` exits zero and prints expected log
- [ ] Linting/Formatting
  - [ ] `.eslintrc.json` (ESM, node env) — no warnings
  - [ ] `.prettierrc.json`
- [ ] Documentation
  - [ ] README usage and examples
  - [ ] pnpm install commands and environment variable requirements
- [ ] Optional follow-ups
  - [ ] Split helpers (generate-script, images, tts, captions, render) for clearer unit tests
  - [ ] Additional CLI commands like `viral render`, `viral clean` if needed

## Notes

- Keep it simple (KISS). Avoid unnecessary dependencies; use Node built-ins.
- Maintain ESM (Node 20+).
- Prefer `pnpm` for all package operations.
- Tests must not hit OpenAI or ffmpeg; rely on `DRY_RUN` path.
