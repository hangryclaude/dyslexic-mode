import { test } from 'node:test';
import assert from 'node:assert/strict';
import { systemPrompt } from '../lib/prompt.mjs';
import { STYLES, STYLE_NAMES } from '../lib/thinking.mjs';

const SKILL = '---\nname: x\n---\n# Pass\nSKILLBODY';
const count = (s, sub) => s.split(sub).length - 1;

test('thinking defaults to off, and off, explorer and base add nothing', () => {
  const plain = systemPrompt({ skillMd: SKILL });
  assert.doesNotMatch(plain, /How to think/);
  for (const thinking of ['off', 'explorer', 'base']) assert.equal(systemPrompt({ skillMd: SKILL, thinking }), plain, thinking);
});

test('each style goes in a How to think section, before the skill', () => {
  for (const name of STYLE_NAMES.filter(n => n !== 'base')) {
    const s = systemPrompt({ skillMd: SKILL, thinking: name });
    assert.equal(count(s, STYLES[name]), 1, name);
    assert.equal(count(s, '## How to think'), 1, name);
    // Intro, then thinking, then the line that introduces the skill, then the skill.
    const at = ['You are the assistant', '## How to think', STYLES[name], 'Before you answer', 'SKILLBODY'].map(p => s.indexOf(p));
    assert.deepEqual(at, [...at].sort((a, b) => a - b), name);
    assert.ok(at.every(i => i >= 0), name);
  }
});

test('the thinking stays out of the reply: private if it can, else one fenced block', () => {
  const s = systemPrompt({ skillMd: SKILL, thinking: 'strong' });
  assert.match(s, /think privately[\s\S]*keep it out of the reply/);
  assert.match(s, /one fenced block tagged `thinking`, just before the reply/);
  assert.match(s, /reply never holds these parts/);
});

test('thinking leaves the other parts alone: tools, the skill, and the profile last', () => {
  const s = systemPrompt({ skillMd: SKILL, tools: true, profile: '- short bullets', thinking: 'extreme' });
  assert.match(s, /full access[\s\S]*codex exec[\s\S]*How to think[\s\S]*Before you answer[\s\S]*SKILLBODY[\s\S]*own rules[\s\S]*- short bullets$/);
  assert.doesNotMatch(systemPrompt({ skillMd: SKILL, thinking: 'dyslexic' }), /own rules/);
});

test('an unknown thinking style throws and names the choices', () => {
  assert.throws(() => systemPrompt({ skillMd: SKILL, thinking: 'nope' }), /unknown thinking style: nope \(use off, explorer, base, careful, dyslexic, strong, extreme\)/);
  // Names that exist on every object are still not styles.
  for (const thinking of ['constructor', 'toString', '__proto__', '', 'Dyslexic', null]) {
    assert.throws(() => systemPrompt({ skillMd: SKILL, thinking }), /unknown thinking style/, String(thinking));
  }
});

test('the real skill carries the reply shape and the study plan, after the thinking', () => {
  const s = systemPrompt({ thinking: 'dyslexic' });
  for (const part of ['## Reply shape', '## Study plans', 'Line 1 is the answer', 'Goal', '[ ] boxes', '25 minutes or less']) {
    assert.ok(s.indexOf(part) > s.indexOf('## How to think'), part);
  }
  assert.doesNotMatch(s, /^name: dyslexic-reread/m);
});
