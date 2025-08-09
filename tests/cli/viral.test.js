import { expect } from 'chai';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const BIN = path.join(process.cwd(), 'bin', 'viral.js');

function runCLI(args = [], opts = {}) {
  return spawnSync('node', [BIN, ...args], {
    encoding: 'utf8',
    env: { ...process.env, DRY_RUN: '1', ...(opts.env || {}) },
    timeout: 30000,
  });
}

describe('viral CLI', () => {
  before(() => {
    // Ensure bin exists
    expect(fs.existsSync(BIN)).to.equal(true, 'bin/viral.js must exist');
  });

  it('prints usage and exits non-zero when --topic is missing', () => {
    const res = runCLI([]);
    expect(res.status).to.not.equal(0);
    expect(res.stderr).to.match(/Usage:/);
  });

  it('runs in DRY_RUN with --topic and exits zero', () => {
    const res = runCLI(['--topic', 'Test Topic', '--dry-run']);
    expect(res.status).to.equal(0, `stderr: ${res.stderr || ''}`);
    expect(res.stdout).to.match(/DRY_RUN complete/);
  });

  it('accepts gender and style flags and still completes in DRY_RUN', () => {
    const topic = 'Flag Test';
    const res = runCLI(['--topic', topic, '--female', '--realistic', '--dry-run']);
    expect(res.status).to.equal(0, `stderr: ${res.stderr || ''}`);
    const outDir = path.join(process.cwd(), 'video-flag-test');
    const scriptPath = path.join(outDir, 'script.json');
    // Allow some time for filesystem sync on slower environments
    expect(fs.existsSync(scriptPath)).to.equal(true, 'script.json should exist in output dir');
    const data = JSON.parse(fs.readFileSync(scriptPath, 'utf8'));
    expect(String(data.ttsStyle || '')).to.match(/female/i);
    // cleanup
    try { fs.rmSync(outDir, { recursive: true, force: true }); } catch {}
  });

  it('setup persists ELEVENLABS_API_KEY alongside OPENAI_API_KEY', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'viral-config-'));
    const res = runCLI(
      ['setup', '--openai-key', 'sk-test-123', '--elevenlabs-key', 'el-test-123'],
      { env: { XDG_CONFIG_HOME: tmp } }
    );
    expect(res.status).to.equal(0, `stderr: ${res.stderr || ''}`);

    const cfgPath = path.join(tmp, 'viral-video', 'config.json');
    expect(fs.existsSync(cfgPath)).to.equal(true, 'config.json should be written');

    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    expect(cfg.OPENAI_API_KEY).to.equal('sk-test-123');
    expect(cfg.ELEVENLABS_API_KEY).to.equal('el-test-123');

    // cleanup
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  });
});