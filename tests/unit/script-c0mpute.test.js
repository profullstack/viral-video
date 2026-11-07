import { expect } from 'chai';
import { generateScript } from '../../src/index.js';

const plan = {
  title: 'T',
  hook: 'H',
  sections: [
    { label: 'Intro/Context', sec: 30, text: 'a' },
    { label: 'Wrap/CTA', sec: 30, text: 'b' },
  ],
  image_prompts: ['p1', 'p2'],
  tts_style: 'female, smooth, educational',
  disclaimer: 'D',
};

const openai = (content) => {
  const calls = [];
  return {
    calls,
    chat: { completions: { create: async (req) => (calls.push(req), { choices: [{ message: { content } }] }) } },
  };
};

describe('generateScript, c0mpute first', () => {
  const cfg = { VIDEO_SEC: 60, SCENES_COUNT: 2 };

  it('uses the c0mpute plan and never calls OpenAI', async () => {
    const client = openai('{}');
    const c0mpute = { generateObject: async () => ({ object: plan, provider: 'c0mpute' }) };
    const out = await generateScript({ topic: 'x', client, cfg, c0mpute });
    expect(out.title).to.equal('T');
    expect(out.provider).to.equal('c0mpute');
    expect(out.imagePrompts).to.deep.equal(['p1', 'p2']);
    expect(client.calls).to.have.length(0);
  });

  it('falls back to OpenAI when c0mpute fails', async () => {
    const client = openai(JSON.stringify(plan));
    const c0mpute = {
      generateObject: async () => {
        throw new Error('no node');
      },
    };
    const out = await generateScript({ topic: 'x', client, cfg, c0mpute });
    expect(out.provider).to.equal('openai');
    expect(client.calls).to.have.length(1);
  });

  it('throws the c0mpute error when there is no OpenAI client', async () => {
    const c0mpute = {
      generateObject: async () => {
        throw new Error('no node');
      },
    };
    try {
      await generateScript({ topic: 'x', cfg, c0mpute });
      expect.fail('should throw');
    } catch (e) {
      expect(e.message).to.match(/no node/);
    }
  });
});
