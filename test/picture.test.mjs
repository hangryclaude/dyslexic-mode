import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  extractSvg, prepareSvg, htmlPage, needsBrowser, renderPng,
  drawPrompt, picturePrompt, whiteboardPrompt, picture, whiteboard, claudeText, claudeImage,
} from '../bench/picture.mjs';

const FAKE = fileURLToPath(new URL('./fixtures/fake-claude-picture.mjs', import.meta.url));
const WORK = fileURLToPath(new URL('../bench/.work', import.meta.url));
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PNG = Buffer.from('89504e470d0a1a0a', 'hex');
const tmp = () => mkdtempSync(join(tmpdir(), 'dm-pic-'));
const size = file => { const b = readFileSync(file); return [b.readUInt32BE(16), b.readUInt32BE(20)]; };
const haveRsvg = spawnSync('rsvg-convert', ['--version']).status === 0;

// --- extractSvg ------------------------------------------------------------------------------

test('extractSvg pulls the picture out of prose and code fences', () => {
  const svg = '<svg viewBox="0 0 8 8"><rect width="4" height="4"/></svg>';
  assert.equal(extractSvg(svg), svg);
  assert.equal(extractSvg(`Here you go:\n\`\`\`svg\n${svg}\n\`\`\`\nHope that helps.`), svg);
  assert.equal(extractSvg(`<?xml version="1.0"?>\n<!DOCTYPE svg>\n${svg}`), svg);
  assert.equal(extractSvg(svg.toUpperCase()), svg.toUpperCase());
});

test('extractSvg takes the first picture, keeps a nested svg inside it, and takes a bare empty one', () => {
  assert.equal(extractSvg('<svg id="a"></svg> then <svg id="b"></svg>'), '<svg id="a"></svg>');
  const nested = '<svg id="a"><svg id="inner"><g/></svg><rect/></svg>';
  assert.equal(extractSvg(`x ${nested} y <svg id="b"></svg>`), nested);
  assert.equal(extractSvg('before <svg viewBox="0 0 1 1"/> after'), '<svg viewBox="0 0 1 1"/>');
});

test('extractSvg says there is no picture when the reply holds none, or stops before the end tag', () => {
  assert.equal(extractSvg('I would draw a grid, but I cannot.'), null);
  assert.equal(extractSvg(''), null);
  assert.equal(extractSvg('<svg viewBox="0 0 8 8"><rect width="4"'), null);
  assert.equal(extractSvg('</svg> stray end, <svgfoo></svgfoo>'), null);
  assert.equal(extractSvg(undefined), null);
});

// --- prepareSvg and htmlPage -----------------------------------------------------------------

test('prepareSvg puts every picture on the same 900 by 900 canvas, whatever the model wrote', () => {
  const head = '<svg xmlns="http://www.w3.org/2000/svg" ';
  assert.match(prepareSvg('<svg viewBox="0 0 400 200"><rect/></svg>'), new RegExp(`^${head}viewBox="0 0 400 200" width="900" height="900"><rect/></svg>$`));
  assert.match(prepareSvg('<svg width="300px" height="150"><rect/></svg>'), /viewBox="0 0 300 150" width="900" height="900"/);
  assert.match(prepareSvg('<svg><rect/></svg>'), /viewBox="0 0 800 800"/);
  assert.match(prepareSvg('<svg width="100%" height="100%" viewBox="bad"></svg>'), /viewBox="0 0 800 800"/);
  const kept = prepareSvg('<svg width="100%" height="50" viewBox="10 20 300 400" preserveAspectRatio="none" style=\'font-family:"Arial"\'></svg>');
  assert.match(kept, /style="font-family:&quot;Arial&quot;" viewBox="10 20 300 400" width="900" height="900"/);
  assert.doesNotMatch(kept, /preserveAspectRatio|50|100%/);
});

test('prepareSvg escapes a stray ampersand but leaves real entities, and declares xlink only when used', () => {
  assert.match(prepareSvg('<svg><text>R&D &amp; R&#38;D &#x26; &lt;</text></svg>'), /R&amp;D &amp; R&#38;D &#x26; &lt;/);
  assert.doesNotMatch(prepareSvg('<svg><rect/></svg>'), /xlink/);
  assert.match(prepareSvg('<svg><use xlink:href="#a"/></svg>'), /^<svg xmlns="[^"]+" xmlns:xlink="http:\/\/www\.w3\.org\/1999\/xlink" /);
});

test('prepareSvg drops script and event handlers, keeps a self-closing root, and is idempotent', () => {
  const dirty = prepareSvg('<svg onload="x()"><script>alert(1)</script><rect onclick=\'y()\' width="1"/></svg>');
  assert.doesNotMatch(dirty, /script|onload|onclick|alert/);
  assert.match(dirty, /<rect width="1"\/><\/svg>$/);
  assert.match(prepareSvg('<svg viewBox="0 0 1 1"/>'), /height="900" \/>$/);
  const once = prepareSvg('<svg width="5" height="5"><text>a & b</text></svg>');
  assert.equal(prepareSvg(once), once);
  assert.throws(() => prepareSvg('no picture here'), /no <svg>/);
});

test('htmlPage is a white page that fits the svg to the window', () => {
  const page = htmlPage('<svg id="x"></svg>');
  assert.match(page, /^<!doctype html>/);
  assert.match(page, /html,body\{margin:0;background:#fff\}/);
  assert.match(page, /svg\{[^}]*width:100vw[^}]*height:100vh/);
  assert.ok(page.includes('<body><svg id="x"></svg></body>'));
});

test('needsBrowser sends what rsvg-convert drops silently to Chrome, and nothing else', () => {
  for (const svg of [
    '<svg><foreignObject><div>hi</div></foreignObject></svg>',
    '<svg><path id="p"/><text><textPath href="#p">on a path</textPath></text></svg>',
    '<svg><style>:root{--c:red}.a{fill:var(--c)}</style></svg>',
    '<svg><rect style="transform-origin:10px 10px"/></svg>',
    '<svg><text>\u{1F3B2}</text></svg>',
  ]) assert.equal(needsBrowser(svg), true, svg);
  assert.equal(needsBrowser('<svg><rect fill="red"/><text>1 → 2 ⚀⚅ ▲ ✓ ★</text></svg>'), false);
});

// --- the prompts -----------------------------------------------------------------------------

const item = {
  id: 'grid-walk',
  family: 'spatial',
  prompt: 'A robot starts at column 2, row 2 of a 5 by 5 grid and moves right 2. In which column and row does it end?',
  ask: 'In which column and row does it end?',
  format: 'End with ANSWER: <column>,<row>',
  answer: '4,2',
};

test('the draw prompt asks for one SVG with every fact and no answer, and ends on the question', () => {
  const p = drawPrompt('QUESTION TEXT');
  for (const rule of [/ONE SVG/, /never the question/, /every fact/, /copy them exactly/, /Do not solve/, /not show the answer/, /viewBox="0 0 800 800"/, /Reply with the SVG and nothing else/]) assert.match(p, rule);
  assert.ok(p.endsWith('Question:\nQUESTION TEXT'));
  assert.doesNotMatch(p, /last reply/);
});

test('the strict draw prompt says the last reply had no SVG and asks for nothing else', () => {
  const p = drawPrompt('QUESTION TEXT', true);
  assert.match(p, /^Your last reply had no SVG in it\. Reply with ONLY the SVG[\s\S]*no code fence\.\n\nTurn the question below/);
  assert.ok(p.endsWith('Question:\nQUESTION TEXT'));
});

test('the picture prompt carries the ask and the format and nothing of the question', () => {
  const p = picturePrompt(item);
  assert.ok(p.includes(item.ask) && p.includes(item.format));
  assert.doesNotMatch(p, /robot|5 by 5|moves right|column 2/);
  assert.ok(!picturePrompt({ ask: 'Q?' }).includes('undefined'));
});

test('the whiteboard prompt carries the full question and the format, with the ask once', () => {
  const p = whiteboardPrompt(item);
  assert.ok(p.includes(item.prompt) && p.includes(item.format));
  assert.equal(p.split(item.ask).length - 1, 1);
  const bare = whiteboardPrompt({ ...item, prompt: 'A robot starts at column 2, row 2 and moves right 2.' });
  assert.match(bare, /moves right 2\.\n\nIn which column and row does it end\?\n\nEnd with ANSWER/);
});

// --- the two conditions, with fake runners ---------------------------------------------------

const SVG = '<svg viewBox="0 0 800 800"><rect width="10" height="10"/></svg>';
const REPLY = `Here you go:\n\`\`\`svg\n${SVG}\n\`\`\`\nDone.`;

// Records every call. `texts` are the draw replies in order, the last one repeating.
function fakes({ texts = [REPLY], answer = 'ANSWER: 4,2' } = {}) {
  const seen = { text: [], image: [], render: [] };
  return {
    seen,
    runText: async (model, prompt) => { seen.text.push({ model, prompt }); return texts[Math.min(seen.text.length, texts.length) - 1]; },
    runImage: async (model, png, prompt) => { seen.image.push({ model, png, prompt }); return answer; },
    render: async (svg, png) => { seen.render.push({ svg, png }); writeFileSync(png, PNG); },
  };
}

test('picture draws from the full question and answers from the picture and the bare ask only', async () => {
  const f = fakes(), dir = tmp();
  const r = await picture({ model: 'claude:haiku', item, dir, ...f });
  assert.deepEqual(Object.keys(r).sort(), ['calls', 'png', 'text']);
  assert.equal(r.text, 'ANSWER: 4,2');
  assert.equal(r.calls, 2);
  assert.equal(f.seen.text.length, 1);
  assert.equal(f.seen.text[0].model, 'claude:haiku');
  assert.ok(f.seen.text[0].prompt.includes(item.prompt));
  assert.equal(f.seen.render.length, 1);
  assert.equal(f.seen.render[0].svg, SVG);
  assert.equal(f.seen.render[0].png, r.png);
  assert.ok(r.png.startsWith(dir) && r.png.endsWith('.png'));
  assert.equal(readFileSync(r.png.replace(/\.png$/, '.svg'), 'utf8'), SVG);
  assert.equal(f.seen.image.length, 1);
  assert.equal(f.seen.image[0].model, 'claude:haiku');
  assert.equal(f.seen.image[0].png, r.png);
  assert.equal(f.seen.image[0].prompt, picturePrompt(item));
  assert.doesNotMatch(f.seen.image[0].prompt, /robot|5 by 5|moves right/);
});

test('whiteboard answers from the picture and the full question', async () => {
  const f = fakes(), dir = tmp();
  const r = await whiteboard({ model: 'claude:haiku', item, dir, ...f });
  assert.equal(r.calls, 2);
  assert.equal(f.seen.text.length, 1);
  assert.equal(f.seen.image[0].png, r.png);
  assert.equal(f.seen.image[0].prompt, whiteboardPrompt(item));
  assert.ok(f.seen.image[0].prompt.includes(item.prompt));
});

test('both conditions add an ask that the prompt lacks, to the draw prompt and to the whiteboard', async () => {
  const bare = { ...item, prompt: 'A robot starts at column 2, row 2 and moves right 2.' };
  for (const condition of [picture, whiteboard]) {
    const f = fakes();
    await condition({ model: 'm', item: bare, dir: tmp(), ...f });
    assert.ok(f.seen.text[0].prompt.endsWith(`${bare.prompt}\n\n${bare.ask}`));
  }
});

test('a reply with no SVG gets one retry with the strict prompt, and counts as a call', async () => {
  const f = fakes({ texts: ['I cannot draw that.', REPLY] });
  const r = await picture({ model: 'm', item, dir: tmp(), ...f });
  assert.equal(r.calls, 3);
  assert.equal(f.seen.text.length, 2);
  assert.doesNotMatch(f.seen.text[0].prompt, /last reply/);
  assert.match(f.seen.text[1].prompt, /^Your last reply had no SVG/);
  assert.equal(f.seen.image.length, 1);
});

test('two replies with no SVG stop the item before any picture is rendered or read', async () => {
  const f = fakes({ texts: ['no', 'still no'] });
  await assert.rejects(whiteboard({ model: 'm', item, dir: tmp(), ...f }), /grid-walk: the model drew no SVG in 2 tries/);
  assert.equal(f.seen.text.length, 2);
  assert.equal(f.seen.render.length + f.seen.image.length, 0);
});

test('runners may answer with { text }, and one that answers with nothing fails loudly', async () => {
  const r = await picture({
    model: 'm', item, dir: tmp(), render: fakes().render,
    runText: async () => ({ text: REPLY }),
    runImage: async () => ({ text: 'ANSWER: 1' }),
  });
  assert.equal(r.text, 'ANSWER: 1');
  await assert.rejects(picture({ model: 'm', item, dir: tmp(), ...fakes(), runImage: async () => undefined }), /returned no text/);
});

test('pictures never collide by default, and a name pins the file', async () => {
  const dir = tmp();
  const [a, b] = await Promise.all([picture({ model: 'claude:haiku', item, dir, ...fakes() }), picture({ model: 'claude:haiku', item, dir, ...fakes() })]);
  assert.notEqual(a.png, b.png);
  assert.match(a.png, /grid-walk-picture-claude-haiku-[0-9a-f]{6}\.png$/);
  const named = await whiteboard({ model: 'm', item, dir, name: 'grid-walk.whiteboard', ...fakes() });
  assert.equal(named.png, join(dir, 'grid-walk.whiteboard.png'));
});

// --- rendering, for real ---------------------------------------------------------------------

test('renderPng draws a 900 by 900 PNG with rsvg-convert, even from SVG a strict parser refuses', { skip: !haveRsvg }, async () => {
  const work = tmp(), png = join(work, 'a.png'), blank = join(work, 'blank.png');
  const via = await renderPng('<svg viewBox="0 0 400 200"><rect width="400" height="200" fill="red"/><text x="10" y="50">R&D</text></svg>', png, { work, order: ['rsvg-convert'] });
  await renderPng('<svg viewBox="0 0 400 200"></svg>', blank, { work, order: ['rsvg-convert'] });
  assert.equal(via, 'rsvg-convert');
  assert.ok(readFileSync(png).subarray(0, 8).equals(PNG));
  assert.deepEqual(size(png), [900, 900]);
  assert.ok(!readFileSync(png).equals(readFileSync(blank)), 'the drawing changed the picture');
});

test('renderPng falls back to Chrome in a fresh profile that it removes, and keeps the work folder ignored', { skip: !existsSync(CHROME) }, async () => {
  const work = tmp(), png = join(work, 'a.png');
  process.env.DYSLEXIC_RSVG_BIN = '/nonexistent/rsvg-convert';
  try {
    const via = await renderPng('<svg viewBox="0 0 800 800"><circle cx="400" cy="400" r="300" fill="blue"/></svg>', png, { work, order: ['rsvg-convert', 'chrome'] });
    assert.equal(via, 'chrome');
  } finally {
    delete process.env.DYSLEXIC_RSVG_BIN;
  }
  assert.ok(readFileSync(png).subarray(0, 8).equals(PNG));
  assert.deepEqual(size(png), [900, 900]);
  assert.deepEqual(readdirSync(work).sort(), ['.gitignore', 'a.png']);
  assert.equal(readFileSync(join(work, '.gitignore'), 'utf8'), '*\n');
});

test('renderPng names why each renderer failed when none worked', async () => {
  process.env.DYSLEXIC_RSVG_BIN = '/nonexistent/rsvg-convert';
  process.env.DYSLEXIC_CHROME_BIN = '/nonexistent/chrome';
  try {
    await assert.rejects(renderPng('<svg/>', join(tmp(), 'a.png'), { work: tmp() }), /could not render the picture \(rsvg-convert: .*ENOENT.*; chrome: .*ENOENT.*\)/);
  } finally {
    delete process.env.DYSLEXIC_RSVG_BIN;
    delete process.env.DYSLEXIC_CHROME_BIN;
  }
});

// --- the claude helpers, against a fake CLI --------------------------------------------------

process.env.DYSLEXIC_CLAUDE_BIN = FAKE;
const launch = log => JSON.parse(readFileSync(log, 'utf8').trim().split('\n').pop());
const flag = (argv, name) => argv[argv.indexOf(name) + 1];

test('claudeText runs plain claude with the bridge marker and returns the result text', async () => {
  const log = join(tmp(), 'argv');
  process.env.FAKE_LOG = log;
  assert.equal(await claudeText('claude:haiku', '-starts with a dash'), 'echo: -starts with a dash');
  const { argv, bridge, cwd } = launch(log);
  for (const [name, value] of [['--model', 'haiku'], ['--tools', ''], ['--setting-sources', ''], ['--system-prompt', 'You are a helpful assistant.'], ['--output-format', 'json']]) assert.equal(flag(argv, name), value, name);
  assert.ok(argv.includes('-p') && argv.includes('--no-session-persistence'));
  assert.ok(!argv.includes('--input-format'));
  assert.equal(bridge, '1');
  assert.equal(realpathSync(cwd), realpathSync(WORK));
  assert.equal(readFileSync(join(WORK, '.gitignore'), 'utf8'), '*\n');
});

test('claudeImage sends the PNG as an image block over stream-json and returns the result text', async () => {
  const log = join(tmp(), 'argv'), png = join(tmp(), 'p.png');
  process.env.FAKE_LOG = log;
  writeFileSync(png, Buffer.concat([PNG, Buffer.from('rest')]));
  assert.equal(await claudeImage('sonnet', png, 'What is it?'), 'image image/png png=true bytes=12; echo: What is it?');
  const { argv, bridge } = launch(log);
  for (const [name, value] of [['--model', 'sonnet'], ['--tools', ''], ['--setting-sources', ''], ['--input-format', 'stream-json'], ['--output-format', 'stream-json']]) assert.equal(flag(argv, name), value, name);
  assert.ok(argv.includes('--verbose'));
  assert.equal(bridge, '1');
});

test('claude errors surface as the CLI\'s own message, and a missing claude rejects', async () => {
  const png = join(tmp(), 'p.png');
  writeFileSync(png, PNG);
  await assert.rejects(claudeText('haiku', 'FAIL now'), /boom/);
  await assert.rejects(claudeImage('haiku', png, 'FAIL now'), /boom/);
  process.env.DYSLEXIC_CLAUDE_BIN = '/nonexistent/claude';
  try {
    await assert.rejects(claudeText('haiku', 'hi'), /ENOENT/);
  } finally {
    process.env.DYSLEXIC_CLAUDE_BIN = FAKE;
  }
});
