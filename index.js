#!/usr/bin/env node
// index.js — thin wrapper for backward compatibility
// Delegates to the new module API [run()](src/index.js:1) and supports the same flags.
import process from "node:process";
import { run } from "./src/index.js";

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const cur = argv[i];
    if (!cur.startsWith("--")) continue;
    const k = cur.slice(2);
    const peek = argv[i + 1];
    const v = peek && !peek.startsWith("--") ? (argv[i++], peek) : true;
    args[k] = v;
  }
  return args;
}
function pickGender(argv) {
  let gender = null;
  for (const cur of argv) {
    if (cur === "--male") gender = "male";
    if (cur === "--female") gender = "female";
  }
  return gender;
}
function pickStyle(argv) {
  let style = null;
  for (const cur of argv) {
    if (cur === "--cartoon") style = "cartoon";
    if (cur === "--realistic") style = "realistic";
    if (cur === "--ai-generated") style = "ai-generated";
  }
  return style;
}

function usage(code = 1) {
  console.error('Usage: node index.js --topic "Your video topic" [--male|--female] [--cartoon|--realistic|--ai-generated] [--dry-run]');
  process.exit(code);
}

(async () => {
  const argv = process.argv.slice(2);
  const args = parseArgs(argv);
  if (!args.topic || typeof args.topic !== "string") usage(1);

  const dryRun =
    args["dry-run"] === true ||
    process.env.DRY_RUN === "1" ||
    process.env.DRY_RUN === "true";

  const gender = pickGender(argv);
  const style = pickStyle(argv);

  try {
    await run(args.topic, { dryRun, gender, style });
  } catch (err) {
    console.error("Build failed:", err?.message || err);
    process.exit(1);
  }
})();
