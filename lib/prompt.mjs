import { readFileSync } from 'node:fs';

const SKILL = new URL('../skill/SKILL.md', import.meta.url);

// The whole skill is the system prompt, so the model gets the reader model and the pass itself,
// not a paraphrase of them.
const NO_TOOLS = 'You have no tools, so never offer to build pages, open files, or run commands.';
const TOOLS = [
  'You have full access to this Mac: files, the shell, the web, the user\'s skills, and Claude subagents.',
  'Codex is installed. Run `codex exec "<prompt>"` in the shell for a second opinion, or when asked.',
  'Ask before anything you cannot undo. Move files to ~/.Trash instead of deleting them.',
  // The app already shows each tool call on a live status line, so notes between calls are
  // extra reading that pushes the answer down.
  'Write no text before or between tool calls. The user sees a live status line for each one.',
  'When you finish using tools, report what you did in the reply style below.',
].join('\n');

export function systemPrompt({ skillMd = readFileSync(SKILL, 'utf8'), profile = '', tools = false } = {}) {
  const body = skillMd.replace(/^---\n[\s\S]*?\n---\n/, '');
  return [
    'You are the assistant inside a terminal chat app called dyslexic mode.',
    'The user is dyslexic. Answer anything they ask at full depth.',
    tools ? TOOLS : NO_TOOLS,
    'Before you answer, apply the skill below to your draft. Output only the final reply, in plain markdown.',
    '',
    body.trim(),
    // The skill says his feedback beats any general rule, so his own rules go last and win.
    ...(profile ? ['', "## This reader's own rules", 'Learned from replies that tripped them. They beat any rule above.', profile] : []),
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
