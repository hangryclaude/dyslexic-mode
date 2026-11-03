// The chat as a markdown file. Each of your messages is quoted, so it stays apart from the
// reply under it, whose own headings would otherwise run into the speaker names.
export function chatMarkdown(history, { date, model, thinking, session }) {
  return [
    `# Chat, ${date}`,
    '',
    `Model: ${model ?? 'default'}. Thinking: ${thinking}.${session ? ` Session: ${session}.` : ''}`,
    '',
    ...history.flatMap(t => ['## You', '', ...t.q.split('\n').map(l => `> ${l}`), '', '## Claude', '', t.text.trim(), '']),
  ].join('\n');
}
