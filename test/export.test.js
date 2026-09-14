'use strict';
/*
 * Aisen export codec tests. encodeAisen() turns a 9x9 layout into Aisen's Palia
 * Garden Planner v0.5 save code, which the planner accepts via ?layout=<code>.
 * These tests pin the format, verify the crop/fertiliser mapping, and round-trip
 * the code through a faithful replica of Aisen's own decoder (expandPlotCode +
 * plot-by-plot crop placement) so a generated link loads the same layout there.
 */
const test = require('node:test');
const assert = require('node:assert');
const {
  CROP, validateLayout, analyzeLayout, makeOpts, optimizeSynergy, encodeAisen,
  AISEN_CROP, AISEN_FERT,
} = require('../src/garden.js');

// ---- Aisen's own decoding primitives (from saveHandlerGardenBasic.ts) --------
// expandPlotCode: run-length-decode a plot's compressed tile string.
function expandAisen(code) {
  const tokens = code.match(/[A-Z][a-z]*(?:\.[A-Z][a-z]*)?\d*/g) || [];
  return tokens.flatMap(token => {
    const m = token.match(/^([A-Z][a-z]*(?:\.[A-Z][a-z]*)?)(\d*)$/);
    const base = m[1], count = m[2] ? parseInt(m[2], 10) : 1;
    return Array(Math.min(count, 1000)).fill(base);
  });
}
// Reconstruct a 9x9 grid + fertiliser grid from an Aisen v0.5 code.
function decodeAisen(code) {
  const parts = code.split('_');
  assert.equal(parts[0], '0.5', `version must be 0.5 (got ${parts[0]})`);
  const dim = parts[1], cropInfo = parts[2];
  assert.equal(dim, 'D-9x9', `dimension must be D-9x9 (got ${dim})`);
  const plots = cropInfo.split('-');
  assert.equal(plots[0], 'CR', 'crop section must start with CR');
  const grid = Array.from({ length: 9 }, () => Array(9).fill(null));
  const fertGrid = Array.from({ length: 9 }, () => Array(9).fill(null));
  const rev = Object.fromEntries(Object.entries(AISEN_CROP).map(([s, c]) => [c, s]));
  for (const p of plots.slice(1)) {
    const m = p.match(/^(\d+)x(\d+)(.*)$/);
    const px = +m[1], py = +m[2];
    const tiles = expandAisen(m[3]);
    assert.equal(tiles.length, 9, `plot ${px}x${py} must decode to 9 tiles`);
    for (let i = 0; i < 9; i++) {
      const r = py + Math.floor(i / 3), c = px + (i % 3);
      const tm = tiles[i].match(/^([A-Z][a-z]*)(?:\.([A-Z][a-z]*))?$/);
      const cropCode = tm[1], fertCode = tm[2] || null;
      if (cropCode !== 'N') {
        const sym = rev[cropCode];
        assert.ok(sym, `unknown Aisen crop code '${cropCode}'`);
        const [h, w] = CROP[sym].sz;
        for (let dr = 0; dr < h; dr++) for (let dc = 0; dc < w; dc++) {
          const rr = r + dr, cc = c + dc;
          if (rr < 9 && cc < 9) grid[rr][cc] = sym;
        }
        fertGrid[r][c] = fertCode;
      }
    }
  }
  return { grid, fertGrid };
}

// Build a valid grid directly (a 3x3 apple at 0,0 + 1x1 tomato fill).
function appleTomatoGrid() {
  const grid = Array.from({ length: 9 }, () => Array(9).fill('T'));
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) grid[r][c] = 'A';
  return grid;
}
function gridEquals(a, b) {
  for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) if (a[r][c] !== b[r][c]) return false;
  return true;
}

test('encodeAisen produces a versioned, parseable v0.5 code', () => {
  const grid = appleTomatoGrid();
  const code = encodeAisen(grid, makeOpts({ level: 5, starSeeds: false }));
  assert.match(code, /^0\.5_D-9x9_CR-/);
  // 9 plots, each `<x>x<y><compressed>`; 3 rows x 3 cols of plots
  const plotCount = code.split('CR-')[1].split('-').length;
  assert.equal(plotCount, 9, 'a 9x9 garden has nine 3x3 plots');
  // settings: L5 + Nss (star seeds off) appended
  assert.ok(code.endsWith('_L5Nss'), 'settings reflect level and star-seed choice');
});

test('crop symbols map to the correct Aisen crop codes', () => {
  const grid = appleTomatoGrid();
  const code = encodeAisen(grid, makeOpts());
  // the apple is the start tile of plot 0x0 -> 'A'; tomatoes are 1x1 -> 'T'
  assert.ok(code.includes('0x0A'), 'apple start tile encodes as A');
  assert.ok(code.includes('T.Q') || code.includes('T.H') || code.includes('T.N') || code.includes('T.W') || code.includes('T.Y'),
    'tomato tiles encode as T with a fertiliser suffix');
  // every known crop symbol maps to a distinct Aisen code
  const codes = new Set(Object.values(AISEN_CROP));
  assert.equal(codes.size, 15, 'all 15 crops map to unique Aisen codes');
  assert.equal(AISEN_CROP.A, 'A');       // Apple
  assert.equal(AISEN_CROP.F, 'Bt');      // Batterfly Beans
  assert.equal(AISEN_CROP.K, 'Bk');      // Bok Choy
  assert.equal(AISEN_CROP.o, 'Cr');      // Corn
  assert.equal(AISEN_CROP.t, 'Co');      // Cotton
  assert.equal(AISEN_CROP.C, 'Cb');      // Napa Cabbage
  assert.equal(AISEN_CROP.P, 'Pm');      // Rockhopper Pumpkin
  assert.equal(AISEN_CROP.w, 'W');       // Wheat
});

test('fertiliser buffs map to Aisen fertiliser codes', () => {
  // our W (Water Retain / HydratePro) -> Aisen Y; our N (Weed Block) -> Aisen W
  assert.equal(AISEN_FERT.H, 'H');
  assert.equal(AISEN_FERT.Q, 'Q');
  assert.equal(AISEN_FERT.W, 'Y');
  assert.equal(AISEN_FERT.N, 'W');
});

test('encodeAisen round-trips through Aisen decode (crops + fertiliser)', () => {
  const grid = appleTomatoGrid();
  const opts = makeOpts({ level: 3, starSeeds: true });
  const code = encodeAisen(grid, opts);
  const { grid: back, fertGrid } = decodeAisen(code);
  assert.ok(gridEquals(grid, back), 'decoded crops match the original grid');

  // each crop instance's fertiliser (from analyzeLayout) appears on its start tile
  const info = analyzeLayout(grid, opts);
  for (const it of info.instances) {
    const [r, c] = it.anchor;
    const expected = it.fert && it.fert !== 'None' ? AISEN_FERT[it.fert] : null;
    assert.equal(fertGrid[r][c], expected, `fertiliser on ${it.sym}@${r},${c}`);
  }
});

test('encodeAisen round-trips an optimizer-generated layout', () => {
  // a real optimizer output (autofill on) is the actual export target
  const sel = { B: 4, S: 4 };                 // 2x2 blueberries + spicy peppers
  const [grid, score] = optimizeSynergy(sel, true, 8000, makeOpts({ objective: 'income' }));
  assert.ok(grid, 'optimizer produced a layout');
  const v = validateLayout(grid);
  assert.ok(v.valid, 'optimizer layout is valid');
  const code = encodeAisen(grid, makeOpts({ objective: 'income' }));
  const { grid: back } = decodeAisen(code);
  assert.ok(gridEquals(grid, back), 'optimizer layout survives the Aisen round-trip');
});

test('encodeAisen rejects an invalid layout', () => {
  const grid = appleTomatoGrid();
  grid[0][1] = 'T'; // breaks the 3x3 apple footprint
  assert.throws(() => encodeAisen(grid, makeOpts()), /Cannot export to Aisen/);
});
