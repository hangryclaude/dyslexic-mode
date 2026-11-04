// How much can one image carry for a model, and what does it cost? Results: bench/results/tiles.md
// node bench/tiles.mjs cost <model>              image token cost by size
// node bench/tiles.mjs density <model> <W> <H>   random codes packed at shrinking font sizes, read back
// node bench/tiles.mjs mosaic <model> <W> <H>    many small path puzzles in one image vs the same as text
// node bench/tiles.mjs hybrid <model> <W> <H>    a duck-rabbit image: small codes in front, big blurred letters behind
// node bench/tiles.mjs layers <model> <W> <H>    1 to 3 lists in one image, told apart by colour and a key
// node bench/tiles.mjs legend <model> <W> <H>    400 sentences as coloured shapes with a key, vs the same as text
// Needs rsvg-convert (brew install librsvg). Every call is a real call on your Claude subscription.
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const WORK = join(dirname(fileURLToPath(import.meta.url)), '.work', 'tiles') + '/';
mkdirSync(WORK, { recursive: true });

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function call(model, content) {
  return new Promise((resolve, reject) => {
    const args = ['-p', '--model', model, '--tools', '', '--setting-sources', '', '--system-prompt', 'You are a careful assistant.',
      '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--no-session-persistence'];
    const t0 = Date.now();
    const child = spawn('claude', args, { env: { ...process.env, CODEX_BRIDGE: '1' }, cwd: WORK });
    let out = '';
    child.stdout.on('data', d => { out += d; });
    child.on('close', () => {
      const ev = out.split('\n').filter(Boolean).map(l => JSON.parse(l)).find(e => e.type === 'result');
      if (!ev) return reject(new Error('no result: ' + out.slice(-300)));
      const u = ev.usage;
      resolve({ input: u.input_tokens + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0), output: u.output_tokens, text: ev.result, ms: Date.now() - t0 });
    });
    child.stdin.end(JSON.stringify({ type: 'user', message: { role: 'user', content } }) + '\n');
  });
}

const png = (svg, name) => {
  writeFileSync(WORK + name + '.svg', svg);
  const r = spawnSync('rsvg-convert', ['-o', WORK + name + '.png', WORK + name + '.svg']);
  if (r.status !== 0) throw new Error('rsvg-convert failed: ' + r.stderr);
  return readFileSync(WORK + name + '.png').toString('base64');
};
const image = data => ({ type: 'image', source: { type: 'base64', media_type: 'image/png', data } });
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

async function cost(model) {
  const base = await call(model, [{ type: 'text', text: 'Reply with ok.' }]);
  const rows = [];
  for (const [w, h] of [[400, 400], [800, 800], [1092, 1092], [1568, 1568], [2000, 2000], [3000, 3000], [4000, 1000]]) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="#fff"/><text x="20" y="60" font-size="40" font-family="Menlo">${w}x${h}</text><circle cx="${w / 2}" cy="${h / 2}" r="${Math.min(w, h) / 4}" fill="none" stroke="#000" stroke-width="4"/></svg>`;
    const r = await call(model, [image(png(svg, `cost-${w}x${h}`)), { type: 'text', text: 'Reply with ok.' }]);
    rows.push({ size: `${w}x${h}`, megapixels: +(w * h / 1e6).toFixed(2), imageTokens: r.input - base.input, formula: Math.round(w * h / 750) });
  }
  console.table(rows);
}

// Codes nobody can guess, so a right answer means the model really read the picture.
function facts(n, seed) {
  const r = rng(seed), L = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  return Array.from({ length: n }, (_, i) => {
    const code = Array.from({ length: 3 }, () => L[Math.floor(r() * L.length)]).join('') + Math.floor(r() * 10);
    return { i: i + 1, line: `${i + 1}. ${code} = ${String(1000 + Math.floor(r() * 9000))}`, num: null };
  }).map(f => ({ ...f, num: f.line.split(' = ')[1] }));
}

function askFor(list, k, seed) {
  const r = rng(seed), picks = new Set();
  while (picks.size < k) picks.add(1 + Math.floor(r() * list.length));
  return [...picks];
}

function scoreRecall(text, list, picks) {
  let right = 0;
  for (const p of picks) {
    const m = text.match(new RegExp(`(?:^|\\n)\\D*\\b${p}\\b\\s*[:=.-]\\s*(\\d{4})`));
    if (m && m[1] === list[p - 1].num) right++;
  }
  return right;
}

async function density(model, W, H) {
  const rows = [];
  for (const font of [16, 12, 10, 8, 6]) {
    const cw = font * 0.61, lh = font * 1.3, colChars = 18;
    const cols = Math.floor((W - 16) / (colChars * cw)), lines = Math.floor((H - 16) / lh);
    const list = facts(cols * lines, font * 7);
    const picks = askFor(list, 12, font);
    let body = '';
    list.forEach((f, j) => {
      const c = Math.floor(j / lines), l = j % lines;
      body += `<text x="${(8 + c * colChars * cw).toFixed(1)}" y="${(8 + (l + 1) * lh - font * 0.25).toFixed(1)}">${esc(f.line)}</text>`;
    });
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="100%" height="100%" fill="#fff"/><g font-family="Menlo" font-size="${font}" fill="#000">${body}</g></svg>`;
    const q = `The ${list.length} numbered lines give a code and a 4-digit number. Give the 4-digit number on lines ${picks.join(', ')}. One per line, as: line: number`;
    const img = await call(model, [image(png(svg, `density-${font}`)), { type: 'text', text: q }]);
    const txt = await call(model, [{ type: 'text', text: list.map(f => f.line).join('\n') + '\n\n' + q }]);
    rows.push({ font, facts: list.length, imgTokensIn: img.input, imgRight: `${scoreRecall(img.text, list, picks)}/12`, textTokensIn: txt.input, textRight: `${scoreRecall(txt.text, list, picks)}/12`, saving: (txt.input / img.input).toFixed(1) + 'x' });
  }
  console.table(rows);
}

// Small path puzzles: a dot walks a 4x4 grid along drawn arrows. Where does it end?
function puzzle(seed) {
  const r = rng(seed);
  let x = Math.floor(r() * 4), y = Math.floor(r() * 4);
  const start = [x, y], path = [[x, y]], moves = [];
  const D = { up: [0, 1], down: [0, -1], left: [-1, 0], right: [1, 0] };
  while (moves.length < 5) {
    const d = Object.keys(D)[Math.floor(r() * 4)];
    const nx = x + D[d][0], ny = y + D[d][1];
    if (nx < 0 || ny < 0 || nx > 3 || ny > 3) continue;
    x = nx; y = ny; moves.push(d); path.push([x, y]);
  }
  return { start, moves, path, end: `${x + 1},${y + 1}` };
}

function tileSvg(p, ox, oy, s, label) {
  const c = s / 5, at = ([gx, gy]) => [ox + c * 0.5 + c * gx + c / 2, oy + c * 0.6 + c * (3 - gy) + c / 2];
  let g = `<rect x="${ox}" y="${oy}" width="${s}" height="${s}" fill="#fff" stroke="#999"/>`;
  g += `<text x="${ox + 4}" y="${oy + c * 0.45}" font-size="${c * 0.4}" font-family="Helvetica" font-weight="bold">${label}</text>`;
  for (let i = 0; i <= 4; i++) {
    g += `<line x1="${ox + c * 0.5 + c * i}" y1="${oy + c * 0.6}" x2="${ox + c * 0.5 + c * i}" y2="${oy + c * 0.6 + c * 4}" stroke="#ccc"/>`;
    g += `<line x1="${ox + c * 0.5}" y1="${oy + c * 0.6 + c * i}" x2="${ox + c * 0.5 + c * 4}" y2="${oy + c * 0.6 + c * i}" stroke="#ccc"/>`;
  }
  for (let i = 1; i < p.path.length; i++) {
    const [x1, y1] = at(p.path[i - 1]), [x2, y2] = at(p.path[i]);
    g += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#1a4fd6" stroke-width="${Math.max(2, c * 0.12)}" marker-end="url(#a)"/>`;
  }
  const [sx, sy] = at(p.start);
  g += `<circle cx="${sx}" cy="${sy}" r="${c * 0.18}" fill="#1a9e4a"/>`;
  return g;
}

function puzzleText(p, label) {
  return `${label}: start at column ${p.start[0] + 1}, row ${p.start[1] + 1} (row 1 is the bottom). Moves: ${p.moves.join(', ')}.`;
}

async function mosaic(model, W, H) {
  const rows = [];
  for (const n of [1, 4, 9, 16, 25]) {
    const side = Math.sqrt(n), s = Math.floor(Math.min(W, H) / side);
    const ps = Array.from({ length: n }, (_, i) => puzzle(100 * n + i));
    let body = '';
    ps.forEach((p, i) => { body += tileSvg(p, (i % side) * s, Math.floor(i / side) * s, s, `T${i + 1}`); });
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${side * s}" height="${side * s}"><defs><marker id="a" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 z" fill="#1a4fd6"/></marker></defs><rect width="100%" height="100%" fill="#fff"/>${body}</svg>`;
    const fmt = 'For each tile, give the square where the path ends, as: T<number>: column,row. Columns count from the left, rows from the bottom, both from 1. One tile per line.';
    const img = await call(model, [image(png(svg, `mosaic-${n}`)), { type: 'text', text: `Each tile shows a 4x4 grid. A green dot is the start, and blue arrows show the moves. ${fmt}` }]);
    const txt = await call(model, [{ type: 'text', text: ps.map((p, i) => puzzleText(p, `T${i + 1}`)).join('\n') + `\n\nEach line is a walk on a 4x4 grid. ${fmt}` }]);
    const right = t => ps.filter((p, i) => new RegExp(`T${i + 1}\\s*:\\s*${p.end.replace(',', '\\s*,\\s*')}\\b`).test(t)).length;
    rows.push({ puzzles: n, imgTokensIn: img.input, imgRight: `${right(img.text)}/${n}`, imgPerPuzzle: Math.round(img.input / n), textTokensIn: txt.input, textRight: `${right(txt.text)}/${n}`, textPerPuzzle: Math.round(txt.input / n) });
  }
  console.table(rows);
}

// Two pictures in one, like the duck-rabbit: sharp small codes in front, huge blurred letters
// behind. The blur keeps the back layer in the coarse detail the small text barely uses.
async function hybrid(model, W, H) {
  const font = 16, cw = font * 0.61, lh = font * 1.3, colChars = 18;
  const cols = Math.floor((W - 16) / (colChars * cw)), lines = Math.floor((H - 16) / lh);
  const list = facts(cols * lines, font * 7);
  const picks = askFor(list, 12, font);
  const r = rng(99), L = 'ABCDEFGHJKLMNPRSTUVWXYZ';
  const word = Array.from({ length: 6 }, () => L[Math.floor(r() * L.length)]).join('');
  let front = '';
  list.forEach((f, j) => {
    const c = Math.floor(j / lines), l = j % lines;
    front += `<text x="${(8 + c * colChars * cw).toFixed(1)}" y="${(8 + (l + 1) * lh - font * 0.25).toFixed(1)}">${esc(f.line)}</text>`;
  });
  const back = [word.slice(0, 3), word.slice(3)].map((s, i) => `<text x="${W / 2}" y="${H * (0.42 + i * 0.4)}" text-anchor="middle">${s}</text>`).join('');
  const rows = [];
  for (const shade of ['#e6e6e6', '#cccccc', '#aaaaaa']) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><defs><filter id="b"><feGaussianBlur stdDeviation="7"/></filter></defs><rect width="100%" height="100%" fill="#fff"/><g font-family="Helvetica" font-weight="bold" font-size="${Math.round(H * 0.36)}" fill="${shade}" filter="url(#b)">${back}</g><g font-family="Menlo" font-size="${font}" fill="#000">${front}</g></svg>`;
    const q = `This picture has two layers. 1) Small text: ${list.length} numbered lines, each a code and a 4-digit number. Give the 4-digit number on lines ${picks.join(', ')}, one per line, as: line: number. 2) Behind the small text, huge pale blurred letters are hidden. On the last line write: HIDDEN: <the letters, in reading order>`;
    const res = await call(model, [image(png(svg, `hybrid-${shade.slice(1)}`)), { type: 'text', text: q }]);
    const hidden = (res.text.match(/HIDDEN:\s*([A-Z ]+)/i) || [])[1]?.replace(/\s/g, '').toUpperCase() ?? '';
    rows.push({ backLayer: shade, codesRight: `${scoreRecall(res.text, list, picks)}/12`, hiddenWord: word, modelSaw: hidden, hiddenRight: hidden === word, tokensIn: res.input });
  }
  console.table(rows);
}

// Several lists in one image, told apart by colour, with a key at the top. Each extra layer sits
// in the gaps between the lines of the others, so more layers means tighter, overlapping lines.
async function layers(model, W, H) {
  const font = 16, cw = font * 0.61, lh = font * 1.3, colChars = 18, top = 44;
  const cols = Math.floor((W - 16) / (colChars * cw)), lines = Math.floor((H - top - 16) / lh);
  const INK = [['red', '#d00000', 'A'], ['blue', '#0038e0', 'B'], ['green', '#007a00', 'C']];
  const rows = [];
  for (const n of [1, 2, 3]) {
    const layers = INK.slice(0, n).map(([word, hex, name], k) => ({ word, hex, name, list: facts(cols * lines, 300 + k), picks: askFor(facts(cols * lines, 300 + k), Math.round(12 / n), 50 + k) }));
    let body = '';
    layers.forEach((ly, k) => {
      ly.list.forEach((f, j) => {
        const c = Math.floor(j / lines), l = j % lines;
        body += `<text x="${(8 + c * colChars * cw).toFixed(1)}" y="${(top + 8 + (l + 1) * lh - font * 0.25 + k * lh / n).toFixed(1)}" fill="${ly.hex}">${esc(f.line)}</text>`;
      });
    });
    const key = layers.map((ly, k) => `<text x="${8 + k * 300}" y="30" fill="${ly.hex}" font-weight="bold">${ly.word} = list ${ly.name}</text>`).join('');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="100%" height="100%" fill="#fff"/><g font-family="Menlo" font-size="${font}">${key}${body}</g></svg>`;
    const asks = layers.flatMap(ly => ly.picks.map(p => `${ly.name}${p}`));
    const q = `KEY: the key at the top says which colour is which list. Each list has numbered lines with a code and a 4-digit number. Give the 4-digit number for each of these (list letter + line number): ${asks.join(', ')}. One per line, as: A17: 1234`;
    const res = await call(model, [image(png(svg, `layers-${n}`)), { type: 'text', text: q }]);
    let right = 0;
    for (const ly of layers) for (const p of ly.picks) {
      const m = res.text.match(new RegExp(`${ly.name}\\s*${p}\\s*[:=.-]\\s*(\\d{4})`));
      if (m && m[1] === ly.list[p - 1].num) right++;
    }
    rows.push({ layers: n, codesInImage: n * cols * lines, right: `${right}/${asks.length}`, tokensIn: res.input, tokensPerCode: +(res.input / (n * cols * lines)).toFixed(1) });
  }
  console.table(rows);
}

const PHRASES = ['meet at the north gate at noon', 'bring the blue notebook to class', 'call grandma after dinner tonight', 'the train leaves at half past six',
  'water the plants on the balcony', 'return the library book by friday', 'buy milk eggs and bread today', 'the password is on the yellow card',
  'finish chapter four before the test', 'the key is under the red mat', 'send the photos to the group chat', 'practice guitar for twenty minutes',
  'the meeting moved to room twelve', 'charge the laptop before you leave', 'feed the cat at seven in the morning', 'pack a raincoat for the school trip'];

// A map legend: 16 coloured shapes, each standing for a whole sentence, in a 20 x 20 grid.
async function legend(model, W, H) {
  const G = 20, SH = ['circle', 'square', 'triangle', 'diamond'], CO = [['red', '#d62828'], ['blue', '#1d4ed8'], ['green', '#15803d'], ['orange', '#e07a00']];
  const icon = (k, cx, cy, s) => {
    const [, hex] = CO[k % 4], shape = SH[Math.floor(k / 4)], h = s / 2;
    if (shape === 'circle') return `<circle cx="${cx}" cy="${cy}" r="${h}" fill="${hex}"/>`;
    if (shape === 'square') return `<rect x="${cx - h}" y="${cy - h}" width="${s}" height="${s}" fill="${hex}"/>`;
    if (shape === 'triangle') return `<path d="M${cx},${cy - h} L${cx + h},${cy + h} L${cx - h},${cy + h} z" fill="${hex}"/>`;
    return `<path d="M${cx},${cy - h} L${cx + h},${cy} L${cx},${cy + h} L${cx - h},${cy} z" fill="${hex}"/>`;
  };
  const r = rng(77);
  const grid = Array.from({ length: G * G }, () => Math.floor(r() * 16));
  const picks = askFor(grid, 12, 9).map(i => i - 1);
  let keySvg = '';
  PHRASES.forEach((p, k) => {
    const x = 10 + (k % 2) * 540, y = 18 + Math.floor(k / 2) * 24;
    keySvg += icon(k, x + 9, y, 16) + `<text x="${x + 24}" y="${y + 5}" font-size="14" font-family="Helvetica">${k + 1}. ${p}</text>`;
  });
  const gy0 = 220, cell = Math.floor((Math.min(W, H) - gy0 - 30) / G), gx0 = 40;
  let gridSvg = '';
  for (let i = 0; i < G; i++) {
    gridSvg += `<text x="${gx0 + i * cell + cell / 2}" y="${gy0 - 6}" font-size="12" text-anchor="middle" font-family="Helvetica">${i + 1}</text>`;
    gridSvg += `<text x="${gx0 - 8}" y="${gy0 + i * cell + cell / 2 + 4}" font-size="12" text-anchor="end" font-family="Helvetica">${i + 1}</text>`;
  }
  grid.forEach((k, j) => {
    const row = Math.floor(j / G), col = j % G;
    gridSvg += `<rect x="${gx0 + col * cell}" y="${gy0 + row * cell}" width="${cell}" height="${cell}" fill="none" stroke="#ddd"/>` + icon(k, gx0 + col * cell + cell / 2, gy0 + row * cell + cell / 2, cell * 0.6);
  });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="100%" height="100%" fill="#fff"/>${keySvg}${gridSvg}</svg>`;
  const cells = picks.map(j => `row ${Math.floor(j / G) + 1} col ${(j % G) + 1}`);
  const fmt = `For each of these cells, give the key number (1-16) of the sentence it stands for: ${cells.join('; ')}. One per line, as: row 3 col 7: 12`;
  const keyText = PHRASES.map((p, k) => `${k + 1}. ${p}`).join('\n');
  const conds = [
    ['image: shapes + key', [image(png(svg, 'legend')), { type: 'text', text: `The key at the top maps 16 coloured shapes to 16 sentences. The grid below has rows and columns numbered from 1. ${fmt}` }]],
    ['text: numbers + key', [{ type: 'text', text: `KEY:\n${keyText}\n\nGRID (20 rows, 20 columns, each number is a key number):\n${Array.from({ length: G }, (_, row) => grid.slice(row * G, row * G + G).map(k => k + 1).join(' ')).join('\n')}\n\n${fmt}` }]],
    ['text: full sentences', [{ type: 'text', text: `KEY:\n${keyText}\n\nGRID, one cell per line:\n${grid.map((k, j) => `row ${Math.floor(j / G) + 1} col ${(j % G) + 1}: ${PHRASES[k]}`).join('\n')}\n\n${fmt}` }]],
  ];
  const rows = [];
  for (const [name, content] of conds) {
    const res = await call(model, content);
    let right = 0;
    picks.forEach(j => {
      const m = res.text.match(new RegExp(`row\\s*${Math.floor(j / G) + 1}\\s*,?\\s*col\\s*${(j % G) + 1}\\s*[:=-]\\s*(\\d+)`, 'i'));
      if (m && Number(m[1]) === grid[j] + 1) right++;
    });
    rows.push({ version: name, sentencesHeld: G * G, right: `${right}/12`, tokensIn: res.input });
  }
  console.table(rows);
}

const [cmd, model = 'haiku', W = '1092', H = '1092'] = process.argv.slice(2);
if (cmd === 'layers') await layers(model, +W, +H);
else if (cmd === 'legend') await legend(model, +W, +H);
else if (cmd === 'hybrid') await hybrid(model, +W, +H);
else if (cmd === 'cost') await cost(model);
else if (cmd === 'density') await density(model, +W, +H);
else if (cmd === 'mosaic') await mosaic(model, +W, +H);
else console.log('usage: node tiles.mjs cost|density|mosaic <model> [W H]');
