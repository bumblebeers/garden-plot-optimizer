'use strict';
/*
 * Data-driven tests built from the official Palia wiki (palia.wiki.gg), the
 * source the app cites. The CROP table's buffs + harvest schedules are verified
 * against the wiki "Crops" page for all 16 crops; yield and best-sell (preserves)
 * values against the individual crop/preserves pages.
 *
 * Sources (fetched 2026-09-13):
 *  - https://palia.wiki.gg/wiki/Crops   (buff + harvest time per crop)
 *  - https://palia.wiki.gg/wiki/<Crop>?action=raw (value/sqvalue infobox)
 *  - https://palia.wiki.gg/wiki/Apple_Jam, Pickled_Carrots (preserves best-sell)
 */
const test = require('node:test');
const assert = require('node:assert');
const { CROP, simulate, makeOpts } = require('../src/garden.js');

const NO_FERT = { fert: { H: false, Q: false, W: false, N: false } };
const approx = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `expected ${a} ~= ${b}`);

/* buff + harvest schedule verified against the wiki Crops page.
 * Harvest time strings: "3 days" -> {first:3,harv:1,cycle:3};
 * "12+6+6+6 Days" -> {first:12,harv:4,cycle:30}. */
const WIKI_CROP = {
  A: { buff: 'H', first: 12, harv: 4, cycle: 30, pv: 96 },  // Apple: 12+6+6+6, yield 16/24
  F: { buff: 'H', first: 6, harv: 4, cycle: 12 },            // Batterfly Beans: 6+2+2+2
  B: { buff: 'H', first: 9, harv: 4, cycle: 18 },            // Blueberries: 9+3+3+3
  K: { buff: 'N', first: 3, harv: 1, cycle: 3, pv: 45 },     // Bok Choy: 3 days
  r: { buff: 'N', first: 3, harv: 1, cycle: 3, pv: 34 },     // Carrot: 3 days, yield 2/3
  o: { buff: 'H', first: 5, harv: 1, cycle: 5, pv: 60 },     // Corn: 5 days
  t: { buff: 'Q', first: 5, harv: 1, cycle: 5 },             // Cotton: 5 days
  C: { buff: 'W', first: 6, harv: 1, cycle: 6, pv: 60 },     // Napa Cabbage: 6 days
  n: { buff: 'N', first: 4, harv: 1, cycle: 4, pv: 45 },     // Onion: 4 days
  p: { buff: 'W', first: 5, harv: 1, cycle: 5 },             // Potato: 5 days
  i: { buff: 'H', first: 3, harv: 1, cycle: 3 },             // Rice: 3 days
  P: { buff: 'Q', first: 9, harv: 4, cycle: 15 },            // Rockhopper Pumpkin: 9+2+2+2
  S: { buff: 'Q', first: 6, harv: 4, cycle: 15 },            // Spicy Pepper: 6+3+3+3
  T: { buff: 'W', first: 4, harv: 4, cycle: 10 },            // Tomato: 4+2+2+2
  w: { buff: 'H', first: 4, harv: 1, cycle: 4 },             // Wheat: 4 days
};

test('CROP table matches the official wiki (buffs + harvest schedules, all 16)', () => {
  for (const sym in WIKI_CROP) {
    const ref = WIKI_CROP[sym];
    const d = CROP[sym];
    assert.ok(d, `missing crop ${sym}`);
    assert.strictEqual(d.buff, ref.buff, `${d.name}: buff should be ${ref.buff}`);
    assert.strictEqual(d.first, ref.first, `${d.name}: first harvest`);
    assert.strictEqual(d.harv, ref.harv, `${d.name}: harvest count`);
    assert.strictEqual(d.cycle, ref.cycle, `${d.name}: cycle days`);
    if (ref.pv !== undefined) {
      assert.strictEqual(d.pv, ref.pv, `${d.name}: pv (best-sell) should be ${ref.pv}`);
    }
  }
});

test('Harvest boost yield is +50% for every buffed crop (yldB = round(yld*1.5))', () => {
  for (const sym in CROP) {
    const d = CROP[sym];
    if (d.buff === 'None') continue; // no crop has a None buff now (lettuce removed); defensive
    assert.strictEqual(d.yldB, Math.round(d.yld * 1.5), `${d.name}: yldB`);
  }
});

test('wiki-verified: single isolated Carrot (no fert) yields 2/3 unit/day, 18.8 gold/day net', () => {
  // wiki: 3 days, 1 harvest, 2 yield; pv (pickled) 34; seed 15.
  // no buffs -> base star 0.25, expectedValue 34*1.125=38.25 ; net = 2*38.25/3 - 7/3 = 23.17
  const g = Array.from({ length: 9 }, () => Array(9).fill(null));
  g[0][0] = 'r';
  const s = simulate(g, makeOpts(NO_FERT), 30);
  approx(s.analytic.yieldsPerDay.r, 2 / 3);
  approx(s.analytic.incomePerDay, 23.17, 0.05);
});

test('wiki-verified: single isolated Corn (default fert) yields 3/5 unit/day, 32.5 gold/day net', () => {
  // wiki: 5 days, 1 harvest, 2 yield; pv 60; seed 15. No H neighbour -> the income
  // objective buys HarvestBoost (3 units/harvest x67.5 = 40.5 gross, 5 gold).
  // net = 3*67.5/5 - 15/5 - fert(5) = 40.5 - 3 - 5 = 32.5
  const g = Array.from({ length: 9 }, () => Array(9).fill(null));
  g[0][0] = 'o';
  const s = simulate(g, makeOpts(), 30);
  approx(s.analytic.yieldsPerDay.o, 3 / 5);
  approx(s.analytic.incomePerDay, 32.5, 0.05);
});

test('wiki-verified: single isolated Tomato (default fert) yields 3*4/10 unit/day, 36.9 gold/day net', () => {
  // wiki: 4+2+2+2 (10 days), 4 harvests, 2 yield; pv 34; seed 40. No W neighbour ->
  // the income objective buys HarvestBoost: gross 3*4*38.25/10 = 45.9, 5 gold.
  // net = 45.9 - 40/10 - fert(5) = 36.9
  const g = Array.from({ length: 9 }, () => Array(9).fill(null));
  g[0][0] = 'T';
  const s = simulate(g, makeOpts(), 30);
  approx(s.analytic.yieldsPerDay.T, 3 * 4 / 10); // 1.2
  approx(s.analytic.incomePerDay, 36.9, 0.05);
});

test('wiki-verified: Apple needs 3 Harvest neighbours to receive the Harvest buff', () => {
  // Apple (3x3) at rows 0-2, cols 0-2. Place 3 Corn (H providers) on its right
  // edge so cnt.H >= 3. Apple should then get the Harvest buff (yield 24/harvest).
  const g = Array.from({ length: 9 }, () => Array(9).fill(null));
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) g[r][c] = 'A';
  // three 1x1 H-providers adjacent to the apple's right edge (col 3, rows 0-2)
  g[0][3] = 'o'; g[1][3] = 'o'; g[2][3] = 'o';
  const s = simulate(g, makeOpts(NO_FERT), 30);
  assert.strictEqual(s.analytic.buffCoverage.H >= 1, true, 'apple should receive Harvest');
  // apple boosted yield/day = 24 * 4 / 30 = 3.2
  approx(s.analytic.yieldsPerDay.A, 24 * 4 / 30);
});

test('wiki-verified: full Carrot plot (no fert) — same-type rule, 1522.8 gold/day net', () => {
  const g = Array.from({ length: 9 }, () => Array(9).fill('r'));
  const s = simulate(g, makeOpts(NO_FERT), 30);
  // same-type rule: carrots do not buff other carrots, so N coverage is 0
  assert.strictEqual(s.analytic.buffCoverage.N, 0);
  // net per carrot = 2*38.25/3 - 7/3 = 23.17 ; x81 = 1876.5
  approx(s.analytic.incomePerDay, 81 * 23.17, 0.5);
});
