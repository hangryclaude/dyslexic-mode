// Pictures instead of words. One model draws the question as a single SVG, the SVG becomes a PNG,
// and a model answers from the PNG.
//   picture     the answering model gets the PNG and the bare ask. It never reads the question.
//   whiteboard  it gets the PNG and the full question (Whiteboard-of-Thought), so a gain tells
//               "the picture helps" apart from "the picture is all there is".
// Both are async ({ model, item, runText, runImage }) => { text, calls, png }. runText(model, prompt)
// and runImage(model, pngPath, prompt) resolve to the reply text; claudeText and claudeImage below
// are that pair for the logged-in `claude` CLI.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const SIZE = 900;
const WORK = join(dirname(fileURLToPath(import.meta.url)), '.work');
const PNG = Buffer.from('89504e470d0a1a0a', 'hex');
const NS = 'http://www.w3.org/2000/svg';
const XLINK = 'http://www.w3.org/1999/xlink';
const SYSTEM = 'You are a helpful assistant.';

// Scratch space for pictures and throwaway browser profiles. It ignores itself, so the repo's
// .gitignore needs no line for it.
function workDir(dir = WORK) {
  mkdirSync(dir, { recursive: true });
  const ignore = join(dir, '.gitignore');
  if (!existsSync(ignore)) writeFileSync(ignore, '*\n');
  return dir;
}

// Runs a program to its end and keeps what it printed. It rejects only when the program cannot
// start or hangs. Callers read the exit code themselves, because claude reports its errors as JSON.
function capture(cmd, args, { input = '', env, cwd, timeout = 120_000 } = {}) {
  return new Promise((ok, no) => {
    const child = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'], env, cwd, timeout });
    let stdout = '', stderr = '';
    child.stdout.on('data', d => { stdout += d; });
    child.stderr.on('data', d => { stderr += d; });
    child.on('error', no);
    child.on('close', (code, signal) => (signal
      ? no(new Error(`${cmd} was stopped by ${signal} after at most ${timeout} ms`))
      : ok({ code, stdout, stderr })));
    // A process that dies before reading its input fails through `close`, not as an uncaught EPIPE.
    child.stdin.on('error', () => child.kill());
    child.stdin.end(input);
  });
}

const tail = s => s.trim().split('\n').slice(-3).join(' | ').slice(0, 300);
const failed = (cmd, r) => new Error(`${cmd} exited ${r.code}: ${tail(r.stderr) || tail(r.stdout) || 'no output'}`);

// --- the SVG ---------------------------------------------------------------------------------

// The first complete <svg>...</svg> in a reply, with any nested <svg> kept inside it. Models wrap
// the picture in prose and code fences. A reply cut off mid-picture has no end tag, which counts
// as no picture at all.
export function extractSvg(text) {
  const s = String(text);
  let depth = 0, start = 0;
  for (const m of s.matchAll(/<(\/?)svg(?=[\s>/])[^>]*>/gi)) {
    if (m[1]) {
      if (depth && !--depth) return s.slice(start, m.index + m[0].length);
    } else if (m[0].endsWith('/>')) {
      if (!depth) return m[0];
    } else if (!depth++) start = m.index;
  }
  return null;
}

// Models leave out xmlns, forget to escape "&", size the root in odd ways, and sometimes add a
// script. Every picture is rewritten onto the same 900 by 900 canvas, so what the answering model
// sees does not depend on which renderer drew it, and a wide or small drawing is centred in it.
// A drawing never needs script, and Chrome would run it.
export function prepareSvg(svg) {
  const clean = svg
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, '')
    .replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*')/gi, '')
    .replace(/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[\da-fA-F]+);)/g, '&amp;');
  const open = clean.match(/<svg\b[^>]*>/i)?.[0];
  if (!open) throw new Error('no <svg> element to prepare');
  const attrs = [...open.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)].map(m => [m[1], m[2] ?? m[3]]);
  const get = name => attrs.find(([k]) => k.toLowerCase() === name)?.[1];
  const px = v => Number(/^\s*(\d+(?:\.\d+)?)(?:px)?\s*$/i.exec(v ?? '')?.[1] ?? 0);
  let box = (get('viewbox') ?? '').trim().split(/[\s,]+/).map(Number);
  if (box.length !== 4 || !(box[2] > 0 && box[3] > 0) || box.some(n => !Number.isFinite(n))) {
    box = px(get('width')) && px(get('height')) ? [0, 0, px(get('width')), px(get('height'))] : [0, 0, 800, 800];
  }
  const drop = /^(?:xmlns|xmlns:xlink|width|height|viewbox|preserveaspectratio)$/i;
  const keep = attrs.filter(([k]) => !drop.test(k)).map(([k, v]) => `${k}="${v.replace(/"/g, '&quot;')}"`);
  const xlink = /\bxlink:/.test(clean) ? [`xmlns:xlink="${XLINK}"`] : [];
  const all = [`xmlns="${NS}"`, ...xlink, ...keep, `viewBox="${box.join(' ')}"`, `width="${SIZE}"`, `height="${SIZE}"`];
  return `<svg ${all.join(' ')}${open.endsWith('/>') ? ' />' : '>'}${clean.slice(clean.indexOf(open) + open.length)}`;
}

// The page Chrome draws. The svg fills the window and keeps its shape, so a window a few pixels
// short of 900 still shows the whole picture.
export const htmlPage = svg => `<!doctype html>
<html><head><meta charset="utf-8"><style>html,body{margin:0;background:#fff}svg{display:block;width:100vw;height:100vh}</style></head>
<body>${svg}</body></html>
`;

// --- the PNG ---------------------------------------------------------------------------------

// rsvg-convert takes 0.1 s against Chrome's 4 s, but it leaves out what it cannot draw, and says
// nothing: foreignObject, text on a path, CSS variables (it paints them black), a transform-origin
// it ignores, and colour emoji (black blobs). A picture with a label missing is worse than a slow
// render, so those go to Chrome.
// qlmanage is not used at all. On malformed SVG it exits 0 with a thumbnail of an XML error page,
// and the answering model would be shown that as the picture.
const BROWSER_ONLY = /<foreignObject|<textPath|var\(|transform-origin|transform-box|\p{Extended_Pictographic}/iu;
export const needsBrowser = svg => BROWSER_ONLY.test(svg);

const RENDERERS = {
  'rsvg-convert': async (svg, png) => {
    const r = await capture(process.env.DYSLEXIC_RSVG_BIN || 'rsvg-convert', ['-b', 'white', '-f', 'png', '-o', png], { input: svg });
    if (r.code !== 0) throw failed('rsvg-convert', r);
  },
  chrome: async (svg, png, work) => {
    const bin = process.env.DYSLEXIC_CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    // A new profile every time, so this never joins or touches the Chrome the user has open.
    const dir = mkdtempSync(join(work, 'chrome-'));
    try {
      const page = join(dir, 'page.html');
      writeFileSync(page, htmlPage(svg));
      const r = await capture(bin, [
        '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
        `--user-data-dir=${join(dir, 'profile')}`, `--screenshot=${png}`, `--window-size=${SIZE},${SIZE}`,
        '--hide-scrollbars', pathToFileURL(page).href,
      ], { timeout: 60_000 });
      if (r.code !== 0) throw failed('chrome', r);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
};

const isPng = file => existsSync(file) && readFileSync(file).subarray(0, 8).equals(PNG);

// Draws `svg` as a 900 by 900 PNG on white. Resolves with the name of the renderer that worked,
// and rejects only when none did, naming why each failed.
export async function renderPng(svg, png, { work = WORK, order } = {}) {
  const sized = prepareSvg(svg);
  const out = resolve(png);
  const tries = order ?? (needsBrowser(svg) ? ['chrome', 'rsvg-convert'] : ['rsvg-convert', 'chrome']);
  const why = [];
  // A PNG left from an earlier run must not pass for this one when the renderer wrote nothing.
  rmSync(out, { force: true });
  for (const name of tries) {
    try {
      await RENDERERS[name](sized, out, workDir(work));
      if (isPng(out)) return name;
      why.push(`${name} wrote no PNG`);
    } catch (err) {
      why.push(`${name}: ${err.message}`);
    }
  }
  throw new Error(`could not render the picture (${why.join('; ')})`);
}

// --- the prompts -----------------------------------------------------------------------------

// A question whose ask is not already in its prompt gets the ask added, so no reader is left
// without the thing to answer.
const fullQuestion = ({ prompt, ask }) => (ask && !prompt.includes(ask) ? `${prompt}\n\n${ask}` : prompt);

const RULES = [
  'Turn the question below into ONE SVG picture.',
  'Someone will see only your picture, never the question. They must be able to answer from the picture alone.',
  '- Put every fact the answer depends on into the picture: shapes, arrows, grids, tables, scales, colors, labels.',
  '- Words only as short labels. If the question is about particular words, letters or numbers, copy them exactly. Never write the question out as sentences.',
  '- Do not solve the question. Do not show the answer, a result or any working.',
  '- Show the situation as it is given, and keep any order (steps, moves, turns) visible, for example by numbering them.',
  '- Make it big and clear: viewBox="0 0 800 800", text at least 20px, nothing overlapping, no scripts, no external images.',
  'Reply with the SVG and nothing else.',
].join('\n');

const STRICT = 'Your last reply had no SVG in it. Reply with ONLY the SVG: the first characters are <svg and the last are </svg>. No words before or after it and no code fence.';

export const drawPrompt = (question, strict = false) => `${strict ? `${STRICT}\n\n` : ''}${RULES}\n\nQuestion:\n${question}`;

// The picture-only reader gets the ask and the answer format and nothing else of the question.
export const picturePrompt = ({ ask, format }) => [
  'The picture shows a problem. Look at it closely, then answer.',
  '',
  ask,
  ...(format ? ['', format] : []),
].join('\n');

export const whiteboardPrompt = item => [
  'Below are a question and a picture that was drawn from it. Look at the picture first, then answer the question.',
  '',
  'Question:',
  fullQuestion(item),
  ...(item.format ? ['', item.format] : []),
].join('\n');

// --- the two conditions ----------------------------------------------------------------------

// A runner may resolve with the bare reply or with { text }.
const asText = r => {
  const text = typeof r === 'string' ? r : r?.text;
  if (typeof text !== 'string') throw new Error('the model runner returned no text');
  return text;
};

const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// Draw, render, answer. Only the answer prompt differs between the conditions. The draw is tried
// once more with a stricter prompt when the reply holds no SVG. The raw SVG is kept beside the
// PNG, so what the model drew can be opened and re-rendered. By default the files get a random
// suffix, so runs in parallel never share a picture.
async function throughPicture(condition, answerPrompt, { model, item, runText, runImage, render = renderPng, dir, name }) {
  const question = fullQuestion(item);
  let calls = 1;
  let svg = extractSvg(asText(await runText(model, drawPrompt(question))));
  if (!svg) {
    calls++;
    svg = extractSvg(asText(await runText(model, drawPrompt(question, true))));
  }
  if (!svg) throw new Error(`${item.id}: the model drew no SVG in ${calls} tries`);
  const where = dir ?? join(workDir(), 'pictures');
  mkdirSync(where, { recursive: true });
  const base = resolve(where, name ?? `${slug(item.id)}-${condition}-${slug(model)}-${randomBytes(3).toString('hex')}`);
  writeFileSync(`${base}.svg`, svg);
  await render(svg, `${base}.png`);
  const text = asText(await runImage(model, `${base}.png`, answerPrompt(item)));
  return { text, calls: calls + 1, png: `${base}.png` };
}

export const picture = args => throughPicture('picture', picturePrompt, args);
export const whiteboard = args => throughPicture('whiteboard', whiteboardPrompt, args);

// --- the logged-in claude CLI ------------------------------------------------------------------

// Plain mode, as in the app: no tools and no settings, so CLAUDE.md and hooks never reach the
// model. CODEX_BRIDGE=1 keeps the user's Stop hook from asking Codex what to do when a reply ends
// on a question. Sessions are not saved: a bench makes hundreds of calls. Run from the work
// folder, so no project's CLAUDE.md sits above the working directory.
function claude(model, extra, input) {
  const args = ['-p', '--model', model.replace(/^claude:/, ''), '--tools', '', '--setting-sources', '', '--system-prompt', SYSTEM, '--no-session-persistence', ...extra];
  return capture(process.env.DYSLEXIC_CLAUDE_BIN || 'claude', args, {
    input, env: { ...process.env, CODEX_BRIDGE: '1' }, cwd: workDir(), timeout: 300_000,
  });
}

// `--output-format json` prints one object, stream-json one event per line. Anything that is not
// JSON is dropped, so a failure with no result falls through to what claude said on stderr.
function events(stdout) {
  try { return [JSON.parse(stdout)].flat(); } catch {}
  return stdout.split('\n').flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
}

// Both output modes end in one `result` event, and an error is a result too.
function finish(r) {
  const result = events(r.stdout).findLast(e => e?.type === 'result');
  if (result && !result.is_error && result.subtype === 'success') return result.result;
  throw new Error(String(result?.result || result?.subtype || tail(r.stderr) || `claude exited ${r.code} with no result`));
}

export async function claudeText(model, prompt) {
  return finish(await claude(model, ['--output-format', 'json'], prompt));
}

export async function claudeImage(model, pngPath, prompt) {
  const message = {
    type: 'user',
    message: {
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: readFileSync(pngPath).toString('base64') } },
        { type: 'text', text: prompt },
      ],
    },
  };
  return finish(await claude(model, ['--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose'], `${JSON.stringify(message)}\n`));
}
