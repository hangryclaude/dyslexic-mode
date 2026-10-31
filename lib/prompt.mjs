import { readFileSync } from 'node:fs';

const SKILL = new URL('../skill/SKILL.md', import.meta.url);

// The whole skill is the system prompt, so the model gets the reader model and the pass itself,
// not a paraphrase of them.
export function systemPrompt(skillMd = readFileSync(SKILL, 'utf8')) {
  const body = skillMd.replace(/^---\n[\s\S]*?\n---\n/, '');
  return [
    'You are the assistant inside a terminal chat app called dyslexic mode.',
    'The user is dyslexic. Answer anything they ask at full depth.',
    'You have no tools, so never offer to build pages, open files, or run commands.',
    'Before you answer, apply the skill below to your draft. Output only the final reply, in plain markdown.',
    '',
    body.trim(),
  ].join('\n');
}

export function rewritePrompt(draft, hard) {
  const hits = hard.map(f => `- line ${f.line}: ${f.rule}, ${f.message} → ${f.suggestion}`).join('\n');
  return [
    'Your last reply broke these hard limits from the skill:',
    hits,
    '',
    'Rewrite that reply so every hard limit passes. Keep every fact. Output only the new reply.',
    '',
    '<reply>',
    draft,
    '</reply>',
  ].join('\n');
}
