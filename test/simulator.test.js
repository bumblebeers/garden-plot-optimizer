'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { simulate, analyze, makeOpts, normalizeBuffOrder, scoreTotal, CROP, optimizeSynergy } = require('../src/garden.js');

function emptyGrid() { return Array.from({ length: 9 }, () => Array(9).fill(null)); }
function place(grid, sym, r, c) {
  const [h, w] = CROP[sym].sz;
  for (let dr = 0; dr < h; dr++) for (let dc = 0; dc < w; dc++) grid[r + dr][c + dc] = sym;
}
const NO_FERT = { fert: { H: false, Q: false, W: false, N: false } };
const approx = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `expected ${a} ~= ${b}`);

test('empty plot yields zero', () => {
  const s = simulate(emptyGrid(), makeOpts(), 30);
  assert.strictEqual(s.valid, true);
  assert.strictEqual(s.analytic.incomePerDay, 0);
  assert.strictEqual(s.forward.totalUnits, 0);
});

test('single crop, no fertilizer: carrot', () => {
  // Carrot: yld 2, harv 1, cycle 3, pv 34, seed 15.
  // No buffs -> starChance 0.1, expectedValue = 34*1.05 = 35.7.
  // base star 0.25 -> expectedValue 34*1.125 = 38.25 ; gross = 2*38.25/3 = 25.5 ;
  // net = 25.5 - seed(7/3=2.33) = 23.17
  const g = emptyGrid(); g[0][0] = 'r';
  const s = simulate(g, makeOpts(NO_FERT), 6);
  assert.strictEqual(s.valid, true);
  approx(s.analytic.yieldsPerDay.r, 2 / 3);
  approx(s.analytic.incomePerDay, 23.17, 0.01);
  // forward over 6 days = 2 harvests (day 3, 6)
  assert.strictEqual(s.perCrop[0].harvests, 2);
  approx(s.forward.incomePerDay, 23.17, 0.5);
});

test('single crop, default fertilizer: carrot gets QualityUp', () => {
  // default objective is income -> buffOrder Q first; no Q neighbours -> fb=Q
  // -> starChance 0.5, expectedValue 34*1.25=42.5 ; Q -> starChance 0.75 ->
  // expectedValue 34*1.375 = 46.75 ; gross = 2*46.75/3 = 31.17 ;
  // net = 31.17 - seed(7/3=2.33) - fert(2) = 26.83
  const g = emptyGrid(); g[0][0] = 'r';
  const s = simulate(g, makeOpts(), 6);
  approx(s.analytic.incomePerDay, 26.83, 0.01);
  assert.strictEqual(s.analytic.fertBy.Q, 1); // one tile of QualityUp
});

test('all one crop, no fertilizer: 81 carrots', () => {
  const g = Array.from({ length: 9 }, () => Array(9).fill('r'));
  const s = simulate(g, makeOpts(NO_FERT), 30);
  // same-type rule: a carrot's Weed Block does not affect other carrots,
  // so no carrot receives the N buff even though every neighbour is a carrot
  assert.strictEqual(s.analytic.buffCoverage.N, 0);
  // net per carrot = 2*38.25/3 - 7/3 = 23.17 ; x81 = 1876.5
  approx(s.analytic.incomePerDay, 81 * 23.17, 0.5);
  approx(s.analytic.fert, 0); // no fertilizer used
});

test('all one crop, default fertilizer: 81 carrots get QualityUp', () => {
  const g = Array.from({ length: 9 }, () => Array(9).fill('r'));
  const s = simulate(g, makeOpts(), 30);
  // net per carrot = 2*46.75/3 - 7/3 - 2 = 26.83 ; x81 = 2173.5
  approx(s.analytic.incomePerDay, 81 * 26.83, 0.5);
  approx(s.analytic.fertBy.Q, 81);
});

test('same-type rule: crops do not buff themselves or same-species neighbours', () => {
  // Wiki: "crops only affect other crop types... the Water Retain buff of a
  // Tomato does not affect itself nor other nearby tomatoes."
  // 2x2 block of 4 tomatoes: no tomato receives W from another tomato.
  const g = Array.from({ length: 9 }, () => Array(9).fill(null));
  g[0][0] = g[0][1] = g[1][0] = g[1][1] = 'T';
  const s = simulate(g, makeOpts(NO_FERT), 30);
  assert.strictEqual(s.analytic.buffCoverage.W, 0, 'tomatoes must not buff each other');
});

test('different species providing the same buff DO buff each other (tomato + potato)', () => {
  const g = Array.from({ length: 9 }, () => Array(9).fill(null));
  g[0][0] = 'T'; g[0][1] = 'p'; // tomato and potato are both W, different species
  const s = simulate(g, makeOpts(NO_FERT), 30);
  assert.strictEqual(s.analytic.buffCoverage.W, 2, 'both should get W (different species)');
});

test('star chance follows the community model (25% base, +25% star seeds, +2%/level, +50% quality boost)', () => {
  const { starChanceOf, makeOpts } = require('../src/garden.js');
  const mk = (over) => makeOpts(over);
  // level 0, no star seeds: base 25%, with Q 75%
  approx(starChanceOf(mk(), false), 0.25);
  approx(starChanceOf(mk(), true), 0.75);
  // level 0, star seeds: base 50%, with Q capped at 100%
  approx(starChanceOf(mk({ starSeeds: true }), false), 0.50);
  approx(starChanceOf(mk({ starSeeds: true }), true), 1.00);
  // level 25, star seeds, quality boost -> capped at 100%
  approx(starChanceOf(mk({ level: 25, starSeeds: true }), true), 1.00);
  // level 25, no star seeds, no boost: 0.25 + 0.5 = 0.75
  approx(starChanceOf(mk({ level: 25 }), false), 0.75);
});

test('star seeds raise the star chance but cost the star seed sell value', () => {
  const g = emptyGrid(); g[0][0] = 'r';
  const noStar = simulate(g, makeOpts(NO_FERT), 30);          // seed 7, base 0.25
  const withStar = simulate(g, makeOpts({ ...NO_FERT, starSeeds: true }), 30); // seedStar 10, base 0.50
  // base star 0.25 -> net 23.17 ; star seeds -> base 0.50, net higher despite cost
  approx(noStar.analytic.incomePerDay, 23.17, 0.05);
  approx(withStar.analytic.incomePerDay, 2 * (34 * 1.25) / 3 - 10 / 3, 0.05); // 25
  assert.ok(withStar.analytic.incomePerDay > noStar.analytic.incomePerDay);
});

test('Harvest buff from a neighbour boosts yield (carrot + corn, no fert)', () => {
  // Carrot: units=yldB=3 -> income/day = 3*34/3 = 34 ; yield/day = 1.0
  // Corn:   corn provides H but needs 1 H neighbour; carrot provides N so corn
  //         only gets N -> units=yld=2, val=60 -> income/day = 2*60/5 = 24
  const g = emptyGrid();
  g[0][0] = 'r'; g[0][1] = 'o';
  const s = simulate(g, makeOpts(NO_FERT), 30);
  assert.strictEqual(s.analytic.buffCoverage.H, 1); // carrot got H
  approx(s.analytic.yieldsPerDay.r, 3 / 3); // 1.0 units/day (boosted)
  // carrot: 3*38.25/3 - 7/3 = 35.92 ; corn: 2*67.5/5 - 15/5 = 24 ; total 59.92
  approx(s.analytic.incomePerDay, 59.92, 0.1);
});

test('multi-harvest crop harvest schedule (apple, 2 cycles)', () => {
  // Apple: harv 4, first 12, cycle 30, re 6 -> harvests at 12,18,24,30
  const g = emptyGrid(); place(g, 'A', 0, 0);
  const s = simulate(g, makeOpts(), 60);
  assert.strictEqual(s.perCrop[0].harvests, 8); // 2 cycles * 4
  // default objective income -> isolated apple gets Q fert (starChance 0.5, expectedValue 96*1.25=120)
  // Q -> starChance 0.75 -> expectedValue 96*1.375 = 132 ; gross = 16*4*132/30 = 281.6 ;
  // net = 281.6 - seed(700/30=23.33) - fert(9*2 = 18) = 240.27
  approx(s.analytic.incomePerDay, 240.27, 0.1);
  approx(s.forward.incomePerDay, s.analytic.incomePerDay, 5);
});

test('forward simulation converges to the analytic model on a mixed layout', () => {
  const g = emptyGrid();
  place(g, 'B', 0, 0); place(g, 'B', 0, 2); // two blueberries
  g[4][4] = 'r'; g[4][5] = 'o'; g[5][4] = 'K'; // some 1x1s
  const opts = makeOpts();
  const s = simulate(g, opts, 100000);
  // forward converges to analytic as O(1/H); at H=1e5 the startup transient is
  // ~0.004% of income, so a 0.5/day tolerance is tight but leaves room for the
  // integer-day quantization.
  approx(s.forward.incomePerDay, s.analytic.incomePerDay, 0.5);
  approx(s.forward.yieldsPerDay.r, s.analytic.yieldsPerDay.r, 1e-3);
});

test('simulator rejects an invalid layout', () => {
  const g = emptyGrid(); place(g, 'B', 0, 0); g[1][1] = null; // partial 2x2
  const s = simulate(g, makeOpts(), 30);
  assert.strictEqual(s.valid, false);
  assert.ok(s.errors.length > 0);
});

test('optimizer claimed yield matches the simulator (same model)', () => {
  const opts = makeOpts();
  const [g] = optimizeSynergy({ r: 5, F: 1 }, true, 3000, opts);
  assert.ok(g);
  const claimed = analyze(g, opts).income;
  const sim = simulate(g, opts, 3000);
  approx(sim.analytic.incomePerDay, claimed, 1e-6);
  // and the forward simulation agrees over a long horizon
  approx(sim.forward.incomePerDay, claimed, 0.5);
});

/* ---------- objective / crop-mix / buff-order features ---------- */

test('Harvest Boost is locked to the top spot only under the yield objective', () => {
  // income: the user's buff order is kept as-is (H is fully configurable)
  assert.deepStrictEqual(makeOpts({ buffOrder: ['Q', 'W', 'N', 'H'] }).buffOrder, ['Q', 'W', 'N', 'H']);
  // yield: H is pinned to the top; Q/W/N keep their relative order
  assert.deepStrictEqual(makeOpts({ objective: 'yield', buffOrder: ['Q', 'W', 'N', 'H'] }).buffOrder, ['H', 'Q', 'W', 'N']);
  assert.deepStrictEqual(makeOpts({ objective: 'yield', buffOrder: ['N', 'Q', 'W', 'H'] }).buffOrder, ['H', 'N', 'Q', 'W']);
  // the default objective is income, so the default order is Q-first
  assert.strictEqual(makeOpts().buffOrder[0], 'Q');
  assert.strictEqual(makeOpts({ objective: 'yield' }).buffOrder[0], 'H');
  assert.strictEqual(normalizeBuffOrder(['W', 'H', 'N', 'Q'], 'yield')[0], 'H');
  assert.strictEqual(normalizeBuffOrder(['W', 'H', 'N', 'Q'], 'income')[0], 'W');
});

test('yield objective makes items/day the dominant term', () => {
  // For the same layout, the yield objective's score is the items/day total,
  // not the net gold/day. Build a layout and check the primary term.
  const g = emptyGrid();
  for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) g[r][c] = 'r'; // 81 carrots
  const oy = makeOpts({ objective: 'yield', cropMix: false, fert: { H: false, Q: false, W: false, N: false } });
  const a = analyze(g, oy);
  // no buffs received (same-type rule) and cropMix off -> scoreTotal(yield) is exactly a.yield
  approx(scoreTotal(g, oy), a.yield, 1e-9);
  // and it is not the income figure
  assert.ok(Math.abs(scoreTotal(g, oy) - a.income) > 1);
});

test('cropMix=false drops the crop-mix bias from the score', () => {
  const g = emptyGrid();
  for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) g[r][c] = 'r';
  const on = makeOpts({ objective: 'income', cropMix: true, fert: { H: false, Q: false, W: false, N: false } });
  const off = makeOpts({ objective: 'income', cropMix: false, fert: { H: false, Q: false, W: false, N: false } });
  const a = analyze(g, on);
  // the difference between on/off is exactly the 0.1*pref tie-breaker
  approx(scoreTotal(g, on) - scoreTotal(g, off), 0.1 * a.pref, 1e-9);
});

test('yield objective produces more items/day than income objective on the same selection', () => {
  // The two objectives pull the optimizer in different directions: income favours
  // high-value crops, yield favours high-count crops. So the yield-optimized layout
  // must beat the income-optimized one on items/day for the same selection.
  const sel = { r: 6, K: 4, T: 6, o: 4 };
  const incomeOpts = makeOpts({ objective: 'income' });
  const yieldOpts = makeOpts({ objective: 'yield' });
  const [gi] = optimizeSynergy(sel, true, 12000, incomeOpts);
  const [gy] = optimizeSynergy(sel, true, 12000, yieldOpts);
  assert.ok(gi && gy);
  const yi = analyze(gi, incomeOpts).yield;
  const yy = analyze(gy, yieldOpts).yield;
  assert.ok(yy > yi, `expected yield layout (${yy.toFixed(2)}) to beat income layout (${yi.toFixed(2)}) items/day`);
});
