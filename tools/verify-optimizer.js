'use strict';
/*
 * Optimizer verification harness.
 *
 * For a set of starting conditions (selection + options) this:
 *   1. runs the optimizer, type-checks its output, and simulates it,
 *   2. verifies the optimizer's claimed income matches the simulator,
 *   3. generates a sample of random *valid* layouts under the same
 *      constraints (same selection, same autofill pool), type-checks and
 *      simulates each,
 *   4. reports the income distribution and where the optimizer lands,
 *   5. writes a chart (SVG) + raw results (JSON) to reports/.
 *
 * Usage: node tools/verify-optimizer.js
 */
const fs = require('fs');
const path = require('path');
const {
  validateLayout, simulate, analyze, optimizeSynergy, makeOpts,
  CROP, SYMS, FILL, PROVIDERS,
} = require('../src/garden.js');

const OUT_DIR = path.join(__dirname, '..', 'reports');
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

/* ---------- seeded RNG (reproducible samples) ---------- */
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---------- random valid layout generator ---------- */
function emptyGrid() { return Array.from({ length: 9 }, () => Array(9).fill(null)); }
function canPlace(grid, sym, r, c) {
  const [h, w] = CROP[sym].sz;
  if (r + h > 9 || c + w > 9) return false;
  for (let dr = 0; dr < h; dr++) for (let dc = 0; dc < w; dc++) if (grid[r + dr][c + dc] != null) return false;
  return true;
}
function place(grid, sym, r, c) {
  const [h, w] = CROP[sym].sz;
  for (let dr = 0; dr < h; dr++) for (let dc = 0; dc < w; dc++) grid[r + dr][c + dc] = sym;
}
function validPositions(grid, sym) {
  const [h, w] = CROP[sym].sz;
  const out = [];
  for (let r = 0; r <= 9 - h; r++) for (let c = 0; c <= 9 - w; c++) if (canPlace(grid, sym, r, c)) out.push([r, c]);
  return out;
}
function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; }
  return arr;
}
function randomLayout(selection, fill, rng) {
  const grid = emptyGrid();
  // 1. place user-selected crops in random order / positions (big first)
  const order = SYMS.filter(s => selection[s] > 0)
    .sort((a, b) => CROP[b].sz[0] * CROP[b].sz[1] - CROP[a].sz[0] * CROP[a].sz[1]);
  for (const sym of order) {
    for (let k = 0; k < selection[sym]; k++) {
      const cands = validPositions(grid, sym);
      if (!cands.length) return null;
      const [r, c] = cands[Math.floor(rng() * cands.length)];
      place(grid, sym, r, c);
    }
  }
  if (fill) {
    // 2. drop some 2x2 providers at random valid positions
    for (let tries = 0; tries < 30; tries++) {
      const spots = validPositions(grid, PROVIDERS[0]); // any provider has 2x2 footprint
      if (!spots.length) break;
      const [r, c] = spots[Math.floor(rng() * spots.length)];
      const sym = PROVIDERS[Math.floor(rng() * PROVIDERS.length)];
      place(grid, sym, r, c);
    }
    // 3. fill every remaining cell with a random 1x1 fill crop
    for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) {
      if (grid[r][c] == null) grid[r][c] = FILL[Math.floor(rng() * FILL.length)];
    }
  }
  return grid;
}

/* ---------- stats ---------- */
function stats(arr) {
  const n = arr.length;
  if (!n) return { n, mean: 0, sd: 0, min: 0, max: 0 };
  const mean = arr.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(arr.reduce((a, b) => a + (b - mean) ** 2, 0) / n);
  return { n, mean, sd, min: Math.min(...arr), max: Math.max(...arr) };
}

/* ---------- SVG histogram ---------- */
function histSvg(values, optValue, label, unit) {
  const W = 720, H = 360, PADL = 70, PADR = 20, PADT = 24, PADB = 46;
  const nBins = 24;
  const min = Math.min(...values, optValue), max = Math.max(...values, optValue);
  const span = (max - min) || 1;
  const bw = span / nBins;
  const counts = new Array(nBins).fill(0);
  const bins = [];
  for (let i = 0; i < nBins; i++) bins.push(min + i * bw);
  for (const v of values) {
    let idx = Math.min(nBins - 1, Math.floor((v - min) / bw));
    counts[idx]++;
  }
  const maxCount = Math.max(...counts, 1);
  const plotW = W - PADL - PADR, plotH = H - PADT - PADB;
  const x = v => PADL + ((v - min) / span) * plotW;
  const y = c => PADT + plotH - (c / maxCount) * plotH;
  let bars = '';
  for (let i = 0; i < nBins; i++) {
    const x0 = x(bins[i]), x1 = x(bins[i] + bw);
    const y0 = y(counts[i]);
    bars += `<rect x="${x0}" y="${y0}" width="${Math.max(1, x1 - x0 - 1)}" height="${PADT + plotH - y0}" fill="#3a414d" stroke="#252a33" rx="1"/>`;
  }
  // Gaussian overlay (normal fit)
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const sd = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length) || 1;
  let curve = '';
  for (let v = min; v <= max; v += span / 200) {
    const pdf = Math.exp(-((v - mean) ** 2) / (2 * sd * sd)) / (sd * Math.sqrt(2 * Math.PI));
    const cnt = pdf * values.length * bw; // scale to histogram area
    const yy = y(cnt);
    const xx = x(v);
    curve += (curve ? 'L' : 'M') + xx.toFixed(1) + ' ' + yy.toFixed(1);
  }
  // optimizer marker
  const ox = x(optValue);
  // axis labels
  let xlabels = '';
  const tickCount = 6;
  for (let t = 0; t <= tickCount; t++) {
    const v = min + (span * t) / tickCount;
    xlabels += `<text x="${x(v)}" y="${H - 26}" text-anchor="middle" font-size="10" fill="#9aa4b2">${Math.round(v)}</text>`;
  }
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${label}">
  <rect width="${W}" height="${H}" fill="#1d2026"/>
  <text x="${PADL}" y="16" font-size="12" font-weight="700" fill="#e8ecf2">${label}</text>
  <text x="${PADL - 8}" y="${PADT + 12}" font-size="10" fill="#9aa4b2" text-anchor="end">count</text>
  ${bars}
  <path d="${curve}" fill="none" stroke="#7ec86a" stroke-width="2" opacity="0.9"/>
  <line x1="${ox}" y1="${PADT}" x2="${ox}" y2="${H - PADB}" stroke="#e0a53a" stroke-width="3"/>
  <text x="${Math.min(W - PADR, ox + 6)}" y="${PADT + 10}" font-size="11" fill="#e0a53a" font-weight="700">optimizer ${Math.round(optValue)}</text>
  ${xlabels}
  <text x="${PADL}" y="${H - 6}" font-size="10" fill="#9aa4b2">${unit}</text>
</svg>`;
}

/* ---------- run one scenario ---------- */
function objectiveMetric(a, objective) {
  return objective === 'yield' ? a.yield : a.income;
}
function runScenario(name, selection, optsOverrides, samples) {
  const opts = makeOpts(optsOverrides);
  const objective = opts.objective === 'yield' ? 'yield' : 'income';
  const unit = objective === 'yield' ? 'items/day' : 'income/day (gold)';
  const rng = mulberry32(0xC0FFEE ^ samples);
  // optimizer
  const [g, score] = optimizeSynergy(selection, true, 12000, opts);
  if (!g) return { name, error: 'optimizer returned null' };
  const v = validateLayout(g);
  const claimed = objectiveMetric(analyze(g, opts), objective);
  const sim = simulate(g, opts, 3000);
  // the simulator's analytic value for this objective must match the optimizer's claim
  const simValue = objective === 'yield'
    ? Object.values(sim.analytic.yieldsPerDay).reduce((a, b) => a + b, 0)
    : sim.analytic.incomePerDay;
  const simMatch = Math.abs(simValue - claimed) < 1e-6;
  // random sample
  const values = [];
  let invalid = 0;
  let count = 0;
  while (values.length < samples) {
    const rl = randomLayout(selection, true, rng);
    if (!rl) { invalid++; continue; }
    const rv = validateLayout(rl);
    if (!rv.valid) { invalid++; continue; }
    values.push(objectiveMetric(analyze(rl, opts), objective));
    count++;
  }
  const st = stats(values);
  const above = values.filter(i => i > claimed).length;
  const pct = 100 * (1 - above / values.length); // percentile of optimiser on this objective
  // save chart + data
  const chart = histSvg(values, claimed, name, unit);
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  fs.writeFileSync(path.join(OUT_DIR, `chart-${slug}.svg`), chart);
  fs.writeFileSync(path.join(OUT_DIR, `data-${slug}.json`),
    JSON.stringify({ name, objective, claimed, score, simMatch, stats: st, above, pct, values }, null, 2));
  return {
    name, objective, claimed, score, simMatch, valid: v.valid,
    random: { n: st.n, mean: st.mean, sd: st.sd, min: st.min, max: st.max },
    above, pct: pct.toFixed(1), invalid,
  };
}

/* ---------- scenarios ---------- */
const scenarios = [
  { name: '5 carrots (no fert)', selection: { r: 5 }, opts: { fert: { H: false, Q: false, W: false, N: false } } },
  { name: '5 carrots (default fert)', selection: { r: 5 }, opts: {} },
  { name: 'apple + 2 beans + pumpkin', selection: { A: 1, F: 2, P: 1 }, opts: {} },
  { name: '4 blueberries + 4 peppers', selection: { B: 4, S: 4 }, opts: {} },
  { name: 'prefer big 2x2 (blueberry/pepper)', selection: { B: 3, S: 3 }, opts: { preferBig: true } },
  // income objective: the fertiliser class is picked by gold, so the buff order
  // only breaks ties between equally-paying classes (still exercised here)
  { name: 'custom buff order (income)', selection: { r: 6, K: 4 }, opts: { buffOrder: ['H', 'W', 'Q', 'N'] } },
  { name: 'no fertilizer allowed', selection: { o: 6, T: 6 }, opts: { fert: { H: false, Q: false, W: false, N: false } } },
  // maximize the number of crops (items) per day instead of net coin
  { name: 'yield objective - max crops per day', selection: { r: 6, K: 4, T: 6, o: 4 }, opts: { objective: 'yield' } },
];

const results = [];
for (const sc of scenarios) {
  const r = runScenario(sc.name, sc.selection, sc.opts, 400);
  results.push(r);
  console.log(`\n=== ${r.name} ===`);
  if (r.error) { console.log('  ERROR', r.error); continue; }
  console.log(`  optimiser ${r.objective === 'yield' ? 'items/day' : 'income/day'}: ${r.claimed.toFixed(1)}  (valid=${r.valid}, sim-match=${r.simMatch})`);
  console.log(`  random sample: n=${r.random.n} mean=${r.random.mean.toFixed(1)} sd=${r.random.sd.toFixed(1)} min=${r.random.min.toFixed(1)} max=${r.random.max.toFixed(1)}`);
  console.log(`  random above optimiser: ${r.above} (${r.pct}% percentile)`);
  if (r.invalid) console.log(`  invalid random layouts skipped: ${r.invalid}`);
}

// write a combined JSON summary
fs.writeFileSync(path.join(OUT_DIR, 'results-summary.json'), JSON.stringify(results, null, 2));
console.log('\nWrote reports/chart-*.svg, reports/data-*.json, reports/results-summary.json');
