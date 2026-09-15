'use strict';
/*
 * Full-app integration tests: drive the optimizer, then push its output through
 * the type checker and the simulator, asserting the pieces agree. These are the
 * "does the whole app hold together" tests.
 */
const test = require('node:test');
const assert = require('node:assert');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const {
  validateLayout, simulate, analyze, optimizeSynergy, makeOpts,
  CROP, SYMS, FILL, PROVIDERS,
} = require('../src/garden.js');

const approx = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `expected ${a} ~= ${b}`);

// count how many tiles a crop selection occupies
function selectionTiles(sel) {
  return Object.entries(sel).reduce((t, [s, n]) => t + n * CROP[s].sz[0] * CROP[s].sz[1], 0);
}
// collect every crop symbol actually present in a grid
function gridSymbols(grid) {
  const m = new Map();
  for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) {
    if (grid[r][c] != null) m.set(grid[r][c], (m.get(grid[r][c]) || 0) + 1);
  }
  return m;
}
// count distinct instances of a crop in a grid (a 2x2 crop == one instance of 4 cells)
function countInstances(grid, sym) {
  const seen = new Set(); let n = 0;
  for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) {
    if (grid[r][c] !== sym || seen.has(r * 9 + c)) continue;
    const [h, w] = CROP[sym].sz;
    for (let dr = 0; dr < h; dr++) for (let dc = 0; dc < w; dc++) seen.add((r + dr) * 9 + c + dc);
    n++;
  }
  return n;
}

test('optimizer produces a layout that passes the type checker (various selections)', () => {
  const cases = [
    { r: 5 },
    { r: 5, K: 3 },
    { A: 1 },
    { F: 2, B: 2 },
    { A: 1, F: 3, P: 2, r: 10 },
    { P: 4, S: 4 },
  ];
  const opts = makeOpts();
  for (const sel of cases) {
    const [g] = optimizeSynergy(sel, true, 4000, opts);
    assert.ok(g, `optimizer returned a layout for ${JSON.stringify(sel)}`);
    const v = validateLayout(g);
    assert.strictEqual(v.valid, true, `layout for ${JSON.stringify(sel)} invalid: ${JSON.stringify(v.errors)}`);
  }
});

test('optimizer without autofill still yields a valid layout', () => {
  const opts = makeOpts();
  const [g] = optimizeSynergy({ F: 3, B: 3 }, false, 4000, opts);
  assert.ok(g);
  assert.strictEqual(validateLayout(g).valid, true);
  // without fill, the grid should contain exactly the selected crops
  const syms = gridSymbols(g);
  for (const s in { F: 0, B: 0 }) if (!syms.has(s)) { /* crops may be packed; assert present */ }
  assert.strictEqual(countInstances(g, 'F'), 3);
  assert.strictEqual(countInstances(g, 'B'), 3);
});

test('optimizer respects the selection (all selected crops present)', () => {
  const opts = makeOpts();
  const sel = { A: 1, F: 2, P: 1 };
  const [g] = optimizeSynergy(sel, true, 4000, opts);
  assert.ok(g);
  assert.strictEqual(countInstances(g, 'A'), 1);
  assert.strictEqual(countInstances(g, 'F'), 2);
  assert.strictEqual(countInstances(g, 'P'), 1);
  assert.strictEqual(validateLayout(g).valid, true);
});

test('optimizer returns null when the selection cannot fit the plot', () => {
  const opts = makeOpts();
  // 4 apples = 4*9 = 36 tiles, fits; but 10 apples = 90 tiles > 81 -> can't fit
  const [g] = optimizeSynergy({ A: 10 }, true, 2000, opts);
  assert.strictEqual(g, null);
});

// seeded PRNG, so a run that depends on placement luck is still deterministic
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('a placement attempt that fails does not abort the run (feasible selection)', () => {
  // A tight 12-crop mix that exactly fills the plot, taken from a layout the type
  // checker accepts (so it is packable). Buff-seeking placement dead-ends on every
  // attempt here; aborting on the first failure is what used to make the app tell
  // the user to remove crops. The retries (and their placement fallbacks) place it.
  const sel = { p: 2, A: 3, t: 1, B: 2, F: 5, T: 2, w: 2, P: 3, r: 1, i: 1, S: 1, K: 1 };
  const realRandom = Math.random;
  Math.random = mulberry32(1);
  try {
    const [g, score] = optimizeSynergy(sel, true, 1500, makeOpts());
    assert.ok(g, 'a selection that fits must not report "couldn\'t fit"');
    assert.strictEqual(validateLayout(g).valid, true, 'the retried layout is a valid packing');
    assert.ok(score > 0, 'the retried layout is scored');
  } finally {
    Math.random = realRandom;
  }
});

test('optimizer claimed income equals the simulator analytic income', () => {
  const opts = makeOpts();
  const sel = { r: 6, F: 1 };
  const [g] = optimizeSynergy(sel, true, 4000, opts);
  assert.ok(g);
  const claimed = analyze(g, opts).income;
  const sim = simulate(g, opts, 3000);
  approx(sim.analytic.incomePerDay, claimed, 1e-6);
});

test('optimizer fills the plot to exactly 81 tiles when autofill is on', () => {
  const opts = makeOpts();
  const [g] = optimizeSynergy({ r: 5 }, true, 4000, opts);
  assert.ok(g);
  let tiles = 0;
  for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) if (g[r][c] != null) tiles++;
  assert.strictEqual(tiles, 81, 'autofill should leave no empty cells');
});

test('autofill only uses allowed fill/provide crops (no user-only Apple inserted)', () => {
  const opts = makeOpts();
  const [g] = optimizeSynergy({ r: 5 }, true, 4000, opts);
  assert.ok(g);
  const syms = gridSymbols(g);
  // Apple (A) is user-only and should never be auto-inserted
  assert.strictEqual(syms.has('A'), false, 'autofill must not insert an Apple');
  // every auto-inserted crop must be in the fill pool or the provider pool
  const allowed = new Set([...FILL, ...PROVIDERS]);
  for (const s of syms.keys()) {
    if (s !== 'r') assert.ok(allowed.has(s), `autofill used unexpected crop ${s}`);
  }
});

test('UMD exposes Garden on the browser global even when a module global exists', () => {
  // Some mobile webviews / PWAs / frameworks inject a global `module` object.
  // The UMD must still set `Garden` on the browser global (self) rather than
  // silently taking the module.exports branch and never exposing it — which
  // left the crop selection and buff-ordering areas blank in the browser.
  const src = fs.readFileSync(path.join(__dirname, '../src/garden.js'), 'utf8');
  const ctx = { self: {}, module: { exports: {} } };
  vm.runInNewContext(src, ctx);
  assert.ok(ctx.self.Garden, 'browser global must receive Garden');
  assert.strictEqual(ctx.self.Garden.SYMS.length, 15);
  assert.strictEqual(ctx.module.exports.CROP, undefined, 'module.exports must not swallow the browser global');
});

test('index.html keeps its inlined garden.js in sync with src/garden.js', () => {
  // index.html is a single self-contained file (the app is downloaded as one
  // HTML file and opened standalone in Chrome, with no src/ folder beside it),
  // so the garden.js logic is inlined into it. A change to src/garden.js must be
  // mirrored here, or the two copies drift and the app silently runs stale logic.
  const index = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  const garden = fs.readFileSync(path.join(__dirname, '../src/garden.js'), 'utf8');
  const start = '<!-- BEGIN inlined garden.js -- keep in sync with src/garden.js -->\n<script>\n';
  const end = '\n</script>\n<!-- END inlined garden.js -->';
  const i = index.indexOf(start);
  const j = index.indexOf(end, i);
  assert.ok(i !== -1 && j !== -1, 'inlined garden.js block markers not found in index.html');
  const inlined = index.slice(i + start.length, j);
  assert.strictEqual(inlined, garden, 'inlined garden.js in index.html diverged from src/garden.js — regenerate it');
});
