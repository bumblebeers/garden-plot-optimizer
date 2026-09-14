'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { validateLayout, CROP } = require('../src/garden.js');

// helper: build an empty 9x9 grid
function emptyGrid() {
  return Array.from({ length: 9 }, () => Array(9).fill(null));
}
// place a crop footprint at (r,c) with a symbol
function place(grid, sym, r, c) {
  const [h, w] = CROP[sym].sz;
  for (let dr = 0; dr < h; dr++) for (let dc = 0; dc < w; dc++) grid[r + dr][c + dc] = sym;
}
function expectInvalid(v, msg) {
  assert.strictEqual(v.valid, false, `expected invalid: ${msg}`);
  assert.ok(v.errors.length > 0, `expected at least one error: ${msg}`);
}
function expectValid(v, msg) {
  assert.strictEqual(v.valid, true, `expected valid: ${msg} — errors: ${JSON.stringify(v.errors)}`);
  assert.strictEqual(v.errors.length, 0, `expected no errors: ${msg}`);
}

test('empty plot is valid', () => {
  expectValid(validateLayout(emptyGrid()), 'empty');
});

test('grid must be 9x9', () => {
  expectInvalid(validateLayout([]), 'not an array of rows');
  expectInvalid(validateLayout(Array.from({ length: 8 }, () => Array(9).fill(null))), '8 rows');
  const g = emptyGrid(); g[0] = Array(8).fill(null);
  expectInvalid(validateLayout(g), 'row with 8 cells');
});

test('a single 1x1 crop is valid', () => {
  const g = emptyGrid(); g[0][0] = 'r';
  expectValid(validateLayout(g), 'one carrot');
});

test('a single 2x2 crop fully placed is valid', () => {
  const g = emptyGrid(); place(g, 'B', 0, 0);
  expectValid(validateLayout(g), 'one blueberry');
});

test('a single 3x3 crop fully placed is valid', () => {
  const g = emptyGrid(); place(g, 'A', 0, 0);
  expectValid(validateLayout(g), 'one apple');
});

test('a partial 2x2 crop (one cell empty) is invalid', () => {
  const g = emptyGrid();
  place(g, 'B', 0, 0);
  g[1][1] = null; // break the block
  expectInvalid(validateLayout(g), 'blueberry missing a cell');
});

test('a partial 2x2 crop (one cell a different crop) is invalid', () => {
  const g = emptyGrid();
  place(g, 'B', 0, 0);
  g[1][1] = 'r'; // intruder
  expectInvalid(validateLayout(g), 'blueberry with a carrot in it');
});

test('a 2x2 crop that extends past the plot edge is invalid', () => {
  const g = emptyGrid();
  // a 2x2 whose anchor is at row 8 (rows 8-9) — row 9 doesn't exist; set only
  // the in-bounds cells so the validator sees an out-of-bounds / incomplete block
  g[8][0] = 'B'; g[8][1] = 'B';
  expectInvalid(validateLayout(g), 'blueberry at row 8');
});

test('a 3x3 crop at the bottom/right edge is invalid', () => {
  const g = emptyGrid();
  // anchor at (7,7): the 3x3 needs rows 7-9 / cols 7-9; only rows 7-8 / cols 7-8 exist
  g[7][7] = 'A'; g[7][8] = 'A'; g[8][7] = 'A'; g[8][8] = 'A';
  expectInvalid(validateLayout(g), 'apple at row 7 col 7');
});

test('an unknown crop symbol is invalid', () => {
  const g = emptyGrid(); g[0][0] = 'Z';
  expectInvalid(validateLayout(g), 'unknown symbol Z');
});

test('two separate 1x1 crops of the same symbol are valid', () => {
  const g = emptyGrid(); g[0][0] = 'r'; g[0][1] = 'r';
  expectValid(validateLayout(g), 'two carrots side by side');
});

test('two adjacent 2x2 crops of the same symbol (4x2 block) are valid', () => {
  const g = emptyGrid();
  place(g, 'B', 0, 0); place(g, 'B', 0, 2);
  expectValid(validateLayout(g), 'two blueberries side by side');
});

test('a superimposed 2x2 crop (cells claimed twice) is invalid', () => {
  const g = emptyGrid();
  // Two 2x2 blueberry crops overlapping: place at (0,0) and (1,1).
  // This leaves the shared cell (1,1) the same symbol, but the first block is
  // complete while the second block's cells are partly claimed.
  place(g, 'B', 0, 0);
  place(g, 'B', 1, 1);
  expectInvalid(validateLayout(g), 'overlapping blueberries');
});

test('a detached stray cell next to a 2x2 crop is invalid', () => {
  const g = emptyGrid();
  place(g, 'B', 0, 0);
  g[0][2] = 'B'; // a lone blueberry cell not forming a 2x2
  expectInvalid(validateLayout(g), 'stray blueberry cell');
});

test('a 1x1 crop left isolated (single tile) is valid', () => {
  const g = emptyGrid(); g[4][4] = 't';
  expectValid(validateLayout(g), 'one cotton in the middle');
});
