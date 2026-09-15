'use strict';
/*
 * Pin / fixed-crop optimizer tests. optimizeSynergy(selection, fill, iters, opts,
 * pins) must keep every pinned crop at its exact anchor while still producing a
 * valid layout and placing the rest of the selection + fill around it.
 */
const test = require('node:test');
const assert = require('node:assert');
const {
  validateLayout, optimizeSynergy, buildGrid, makeOpts, CROP, SYMS,
} = require('../src/garden.js');

// check that a full crop footprint of `sym` sits at anchor (r,c)
function instanceAt(grid, sym, r, c) {
  const [h, w] = CROP[sym].sz;
  if (r + h > 9 || c + w > 9) return false;
  for (let dr = 0; dr < h; dr++) for (let dc = 0; dc < w; dc++) {
    if (grid[r + dr][c + dc] !== sym) return false;
  }
  return true;
}
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

test('optimizeSynergy keeps pinned crops at their exact anchors', () => {
  const sel = { B: 4, S: 4 };
  const pins = [{ sym: 'B', r: 0, c: 0 }, { sym: 'S', r: 0, c: 4 }];
  const [g] = optimizeSynergy(sel, true, 6000, makeOpts({ objective: 'income' }), pins);
  assert.ok(g, 'optimizer returned a layout');
  assert.strictEqual(validateLayout(g).valid, true, 'layout is a valid packing');
  assert.ok(instanceAt(g, 'B', 0, 0), 'pinned blueberry stays at (0,0)');
  assert.ok(instanceAt(g, 'S', 0, 4), 'pinned pepper stays at (0,4)');
  // the pinned instances count toward the selection totals
  assert.strictEqual(countInstances(g, 'B'), 4);
  assert.strictEqual(countInstances(g, 'S'), 4);
});

test('optimizeSynergy respects pins when autofill is off', () => {
  const sel = { F: 3, B: 3 };
  const pins = [{ sym: 'B', r: 2, c: 2 }];
  const [g] = optimizeSynergy(sel, false, 4000, makeOpts(), pins);
  assert.ok(g, 'optimizer returned a layout');
  assert.strictEqual(validateLayout(g).valid, true);
  assert.ok(instanceAt(g, 'B', 2, 2), 'pinned blueberry stays at (2,2)');
  assert.strictEqual(countInstances(g, 'B'), 3);
  assert.strictEqual(countInstances(g, 'F'), 3);
});

test('optimizeSynergy pins a crop even when its symbol is also in the autofill pool', () => {
  // Tomato (T) is a FILL crop; pinning one must keep it and not re-insert extras.
  const sel = { r: 6, T: 1 };
  const pins = [{ sym: 'T', r: 0, c: 0 }];
  const [g] = optimizeSynergy(sel, true, 6000, makeOpts(), pins);
  assert.ok(g);
  assert.strictEqual(validateLayout(g).valid, true);
  assert.ok(instanceAt(g, 'T', 0, 0), 'pinned tomato stays at (0,0)');
  assert.strictEqual(countInstances(g, 'T'), 1, 'no extra tomatoes auto-inserted');
});

test('pinned crops are not moved even across many restarts', () => {
  const sel = { A: 1, B: 2, S: 2 };
  const pins = [{ sym: 'A', r: 6, c: 6 }]; // 3x3 apple in the bottom-right corner
  const [g] = optimizeSynergy(sel, true, 12000, makeOpts(), pins);
  assert.ok(g);
  assert.strictEqual(validateLayout(g).valid, true);
  assert.ok(instanceAt(g, 'A', 6, 6), 'pinned apple stays at (6,6) across restarts');
});

test('buildGrid places pinned crops first and only places the remaining selection', () => {
  const sel = { B: 3, S: 3 };
  const pins = [{ sym: 'B', r: 0, c: 0 }];
  const { grid, user } = buildGrid(sel, pins);
  assert.ok(grid, 'buildGrid returned a grid');
  assert.ok(instanceAt(grid, 'B', 0, 0), 'pinned blueberry placed at (0,0)');
  // two more blueberries + three peppers must be placed; they never overlap the pin
  const seen = new Set();
  let bCount = 0, sCount = 0;
  for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) {
    const sym = grid[r][c];
    if (!sym || seen.has(r * 9 + c)) continue;
    const [h, w] = CROP[sym].sz;
    let complete = true;
    for (let dr = 0; dr < h; dr++) for (let dc = 0; dc < w; dc++) {
      if (grid[r + dr][c + dc] !== sym) complete = false;
      seen.add((r + dr) * 9 + c + dc);
    }
    if (!complete) continue;
    if (sym === 'B') bCount++;
    if (sym === 'S') sCount++;
  }
  assert.strictEqual(bCount, 3, 'three blueberries total (one pinned + two placed)');
  assert.strictEqual(sCount, 3, 'three peppers placed');
  // every pinned cell is marked immutable in the `user` mask
  for (let dr = 0; dr < 2; dr++) for (let dc = 0; dc < 2; dc++) {
    assert.strictEqual(user[(0 + dr) * 9 + 0 + dc], true, 'pinned cell is marked user/immutable');
  }
});

test('buildGrid returns null when a pin cannot fit (overlap or out of bounds)', () => {
  const sel = { B: 1 };
  // overlapping pins at the same anchor
  const g1 = buildGrid(sel, [{ sym: 'B', r: 0, c: 0 }, { sym: 'B', r: 0, c: 0 }]);
  assert.strictEqual(g1, null, 'overlapping pins are rejected');
  // a pin that extends past the plot edge
  const g2 = buildGrid(sel, [{ sym: 'A', r: 7, c: 7 }]);
  assert.strictEqual(g2, null, 'out-of-bounds pin is rejected');
});
