'use strict';
/*
 * Aisen import codec tests. decodeAisen() turns an Aisen v0.5 save code (the
 * `?layout=` value from palia-tools, https://palia-garden-planner.vercel.app)
 * back into our 9x9 grid. These tests pin the decode against hand-crafted codes,
 * verify the crop mapping and settings parsing, and round-trip a code through
 * encodeAisen so a share link imported back yields the same layout.
 */
const test = require('node:test');
const assert = require('node:assert');
const {
  validateLayout, decodeAisen, encodeAisen, makeOpts, optimizeSynergy,
  CROP, AISEN_CROP,
} = require('../src/garden.js');

function emptyGrid() {
  return Array.from({ length: 9 }, () => Array(9).fill(null));
}
function place(grid, sym, r, c) {
  const [h, w] = CROP[sym].sz;
  for (let dr = 0; dr < h; dr++) for (let dc = 0; dc < w; dc++) grid[r + dr][c + dc] = sym;
}
function gridEquals(a, b) {
  for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) if (a[r][c] !== b[r][c]) return false;
  return true;
}

// A hand-written v0.5 code: apple 3x3 at (0,0), blueberry 2x2 at (3,0),
// tomato 1x1 at (6,0), everything else empty. Crop codes per AISEN_CROP.
// Plot 0x0: 'A' at tile 0 + 'N'x8  -> 'AN8'
// Plot 3x0: 'B' at tile 0 + 'N'x8  -> 'BN8'
// Plot 6x0: 'T' at tile 0 + 'N'x8  -> 'TN8'
// Plots (0,3),(3,3),(6,3),(0,6),(3,6),(6,6): all empty -> 'N9'
const PARTIAL_CODE =
  '0.5_D-9x9_CR-0x0AN8-3x0BN8-6x0TN8-0x3N9-3x3N9-6x3N9-0x6N9-3x6N9-6x6N9';

test('decodeAisen decodes a partial plot with empty tiles', () => {
  const { grid } = decodeAisen(PARTIAL_CODE);
  const expected = emptyGrid();
  place(expected, 'A', 0, 0);
  place(expected, 'B', 0, 3);
  place(expected, 'T', 0, 6);
  assert.ok(gridEquals(grid, expected), 'decoded grid matches the hand-written layout');
  // partial plot leaves the rest empty, and it is a valid (if sparse) layout
  assert.strictEqual(validateLayout(grid).valid, true);
});

test('decodeAisen accepts a v-prefixed version (Aisen writes 0.5; links may carry v)', () => {
  const { grid } = decodeAisen(PARTIAL_CODE.replace(/^0\.5/, 'v0.5'));
  assert.strictEqual(grid[0][0], 'A');
  assert.strictEqual(grid[0][6], 'T');
});

test('decodeAisen parses settings: level and star seeds', () => {
  const code = PARTIAL_CODE + '_L7Nss';
  const { level, starSeeds } = decodeAisen(code);
  assert.strictEqual(level, 7);
  assert.strictEqual(starSeeds, false);
  // Aisen defaults star seeds ON; absence of Nss => star seeds used
  const d2 = decodeAisen(PARTIAL_CODE + '_L3');
  assert.strictEqual(d2.level, 3);
  assert.strictEqual(d2.starSeeds, true);
});

test('decodeAisen decodes a crop with a fertilizer suffix (fert is not returned)', () => {
  // a tomato at (0,6) with HydratePro (Aisen 'Y'); the crop decodes, fert is not
  // carried into the app (it re-derives the assignment on Optimize).
  const code = PARTIAL_CODE.replace('6x0TN8', '6x0T.YN8');
  const { grid } = decodeAisen(code);
  assert.strictEqual(grid[0][6], 'T');
  // the codec returns only the layout + settings
  assert.deepStrictEqual(Object.keys(decodeAisen(code)).sort(), ['grid', 'level', 'starSeeds']);
});

test('decodeAisen throws on an overlapping crop code (start tile inside a footprint)', () => {
  // A 3x3 apple at (0,0) fills the whole plot; a crop code on a later tile sits
  // inside its footprint (a superimposition), which must throw, not silently skip.
  const code = '0.5_D-9x9_CR-' +
    ['0x0ATN7', '3x0N9', '6x0N9', '0x3N9', '3x3N9', '6x3N9', '0x6N9', '3x6N9', '6x6N9'].join('-');
  assert.throws(() => decodeAisen(code), /Overlapping crops at 0,1/);
});

test('decodeAisen handles a crop whose footprint spans plot boundaries', () => {
  // a 2x2 blueberry at (2,2) crosses the 3x3 plot grid (plots 0x0/3x0/0x3/3x3).
  // Build it via encodeAisen to avoid hand-writing nine plot codes.
  const grid = emptyGrid();
  place(grid, 'B', 2, 2);
  const encoded = encodeAisen(grid, makeOpts());
  const { grid: back } = decodeAisen(encoded);
  assert.ok(gridEquals(grid, back), 'cross-plot 2x2 crop survives the round-trip');
  assert.strictEqual(back[2][2], 'B');
  assert.strictEqual(back[3][3], 'B');
});

test('decodeAisen round-trips an optimizer-generated layout (crops + settings)', () => {
  const sel = { B: 4, S: 4 };
  const [g] = optimizeSynergy(sel, true, 6000, makeOpts({ objective: 'income', level: 8, starSeeds: true }));
  assert.ok(g, 'optimizer produced a layout');
  const code = encodeAisen(g, makeOpts({ objective: 'income', level: 8, starSeeds: true }));
  const { grid: back, level, starSeeds } = decodeAisen(code);
  assert.ok(gridEquals(g, back), 'optimizer layout survives the Aisen round-trip');
  assert.strictEqual(level, 8);
  assert.strictEqual(starSeeds, true);
});

test('decodeAisen rejects an unsupported version', () => {
  assert.throws(() => decodeAisen('0.4_D-9x9_CR-0x0AN8'), /Unsupported Aisen save version '0\.4'/);
  assert.throws(() => decodeAisen('9.9_D-9x9_CR-0x0AN8'), /Unsupported Aisen save version '9\.9'/);
  assert.throws(() => decodeAisen('_D-9x9_CR-0x0AN8'), /Unsupported Aisen save version/);
});

test('decodeAisen accepts a trimmed/partial dimension (fewer than 9 plots)', () => {
  // Aisen trims empty edge plots (trimGarden), so a partial garden can be D-3x3
  // with a single plot at the origin, or D-9x3 with just the top row of plots.
  const single = decodeAisen('0.5_D-3x3_CR-0x0AN8');
  const expected = emptyGrid();
  place(expected, 'A', 0, 0);
  assert.ok(gridEquals(single.grid, expected), 'D-3x3 partial garden decodes into the 9x9 grid');
  assert.strictEqual(validateLayout(single.grid).valid, true);
});

test('decodeAisen rejects a malformed or out-of-bounds code', () => {
  assert.throws(() => decodeAisen('0.5_D-9x9_CR-0x0A'), /must decode to 9 tiles/);
  assert.throws(() => decodeAisen('0.5_D-9x9_CR-0x0AN8-9x9N9'), /out of bounds/);
  assert.throws(() => decodeAisen('0.5_D-abc_CR-0x0AN8'), /Invalid Aisen dimension 'D-abc'/);
});

test('decodeAisen rejects an unknown crop code', () => {
  // 'Xx' is not a known Aisen crop code; N8 pads the plot to 9 tiles
  const code = '0.5_D-9x9_CR-' +
    ['0x0XxN8', '3x0N9', '6x0N9', '0x3N9', '3x3N9', '6x3N9', '0x6N9', '3x6N9', '6x6N9'].join('-');
  assert.throws(() => decodeAisen(code), /Unknown Aisen crop code 'Xx'/);
});
