/*
 * garden.js — shared garden logic for the Palia Garden Optimizer.
 *
 * This is the single source of truth for the garden model. It is inlined into
 * the browser app (index.html — a self-contained single file, kept in sync by
 * test/app.test.js) and require'd by Node tests. The yield model, the
 * placement/optimizer algorithm, the layout type checker, and the forward
 * simulator all live here so tests exercise exactly what the app computes.
 *
 * UMD: in a browser it sets global `Garden`; in Node it exports.
 */
(function (root, factory) {
  // In Node (no `self`), export via module.exports so `require()` works.
  // In a browser, ALWAYS set `root.Garden` — even if a global `module` object
  // exists (some mobile webviews/PWAs inject one), which would otherwise make
  // the check above take the module.exports branch and never expose `Garden`.
  if (typeof module === 'object' && module.exports && typeof self === 'undefined') {
    module.exports = factory();
  } else {
    root.Garden = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---------- crop data ----------
   * sz    footprint [rows, cols]
   * buff  the buff this crop PROVIDES (H/Q/W/N/None)
   * need  number of same-buff neighbours required to RECEIVE that buff
   * first days until first harvest
   * cycle total days of one planting (first + re-harvests)
   * harv  number of harvests per planting
   * yld   base yield per harvest
   * yldB  harvest-boosted yield per harvest (x1.5)
   * pv    per-unit sell value
   */
  const CROP = {
    A: { name: 'Apple', sz: [3, 3], buff: 'H', need: 3, first: 12, cycle: 30, harv: 4, yld: 16, yldB: 24, pv: 96, seed: 700, seedStar: 1050, color: '#c9543f', icon: 'A' },
    F: { name: 'Batterfly Beans', sz: [2, 2], buff: 'H', need: 2, first: 6, cycle: 12, harv: 4, yld: 6, yldB: 9, pv: 41, seed: 90, seedStar: 135, color: '#8a5ab8', icon: 'F' },
    B: { name: 'Blueberry', sz: [2, 2], buff: 'H', need: 2, first: 9, cycle: 18, harv: 4, yld: 6, yldB: 9, pv: 59, seed: 112, seedStar: 168, color: '#4c6fb8', icon: 'B' },
    K: { name: 'Bok Choy', sz: [1, 1], buff: 'N', need: 1, first: 3, cycle: 3, harv: 1, yld: 2, yldB: 3, pv: 45, seed: 15, seedStar: 22, color: '#3f8f7a', icon: 'K' },
    r: { name: 'Carrot', sz: [1, 1], buff: 'N', need: 1, first: 3, cycle: 3, harv: 1, yld: 2, yldB: 3, pv: 34, seed: 7, seedStar: 10, color: '#c9802e', icon: 'r' },
    o: { name: 'Corn', sz: [1, 1], buff: 'H', need: 1, first: 5, cycle: 5, harv: 1, yld: 2, yldB: 3, pv: 60, seed: 15, seedStar: 22, color: '#c9a83a', icon: 'o' },
    t: { name: 'Cotton', sz: [1, 1], buff: 'Q', need: 1, first: 5, cycle: 5, harv: 1, yld: 2, yldB: 3, pv: 48, seed: 20, seedStar: 30, color: '#b8b8c0', icon: 't' },
    C: { name: 'Napa Cabbage', sz: [1, 1], buff: 'W', need: 1, first: 6, cycle: 6, harv: 1, yld: 2, yldB: 3, pv: 60, seed: 10, seedStar: 15, color: '#4f8f4f', icon: 'C' },
    n: { name: 'Onion', sz: [1, 1], buff: 'N', need: 1, first: 4, cycle: 4, harv: 1, yld: 2, yldB: 3, pv: 45, seed: 10, seedStar: 15, color: '#b07ac8', icon: 'n' },
    p: { name: 'Potato', sz: [1, 1], buff: 'W', need: 1, first: 5, cycle: 5, harv: 1, yld: 2, yldB: 3, pv: 68, seed: 20, seedStar: 30, color: '#b08a5a', icon: 'p' },
    i: { name: 'Rice', sz: [1, 1], buff: 'H', need: 1, first: 3, cycle: 3, harv: 1, yld: 2, yldB: 3, pv: 27, seed: 11, seedStar: 16, color: '#d8d8d8', icon: 'i' },
    P: { name: 'Rockhopper Pumpkin', sz: [2, 2], buff: 'Q', need: 2, first: 9, cycle: 15, harv: 4, yld: 2, yldB: 3, pv: 101, seed: 25, seedStar: 37, color: '#c97f2e', icon: 'P' },
    S: { name: 'Spicy Pepper', sz: [2, 2], buff: 'Q', need: 2, first: 6, cycle: 15, harv: 4, yld: 6, yldB: 9, pv: 48, seed: 85, seedStar: 127, color: '#b23a2a', icon: 'S' },
    T: { name: 'Tomato', sz: [1, 1], buff: 'W', need: 1, first: 4, cycle: 10, harv: 4, yld: 2, yldB: 3, pv: 34, seed: 40, seedStar: 60, color: '#b83333', icon: 'T' },
    w: { name: 'Wheat', sz: [1, 1], buff: 'H', need: 1, first: 4, cycle: 4, harv: 1, yld: 2, yldB: 3, pv: 33, seed: 12, seedStar: 18, color: '#d0b040', icon: 'w' },
  };
  const SYMS = ['A', 'F', 'B', 'K', 'r', 'o', 't', 'C', 'n', 'p', 'i', 'P', 'S', 'T', 'w'];
  const FILL = ['o', 'T', 'C', 'r', 'n', 'K', 't', 'i', 'w', 'p'];   // 1x1 crops available to autofill
  const PROVIDERS = ['F', 'B', 'P', 'S'];                                  // 2x2 crops autofill can insert
  const FERTBUFFS = ['H', 'Q', 'W', 'N'];
  // sell price of each fertilizer class (palia.wiki.gg): HarvestBoost 5, QualityUp 2,
  // HydratePro 1, WeedBlock 1. Full benefit consumes 1 fertilizer per day per tile.
  const FERT_PRICE = { H: 5, Q: 2, W: 1, N: 1 };
  const GROUPS = ['H', 'Q', 'W', 'N', 'None'];
  // buff weights are a small bonus so net income dominates the objective; Harvest
  // and Quality already boost income directly (via yield/star chance), so these
  // reward the convenience buffs (Water Retain / Weed Block) and break ties.
  const RANK_W = [3, 2, 1, 1];

  const DEFAULT_OPT = {
    fert: { H: true, Q: true, W: true, N: true },  // opt-in per fertilizer class
    preferBig: false,                              // prefer 2x2 crops over 1x1
    objective: 'income',                           // 'income' (net gold/day) | 'yield' (items/day)
    cropMix: true,                                 // apply the user's crop-mix proportions; false => optimizer decides
    buffOrder: ['Q', 'H', 'W', 'N'],               // priority order of buffs (income: fully user-configurable; yield: H is locked top)
    share: {},                                     // sym -> share within its buff group
    level: 0,                                      // Gardening level (star chance scales +2%/level)
    starSeeds: false,                              // use star-quality seeds (+25% base star chance)
  };
  // Tie-breaker scale per objective. For 'income' the primary is net gold/day
  // (hundreds), so the buff/pref terms keep their raw weight. For 'yield' the
  // primary is items/day (tens), so the same raw weights would dominate the
  // search — scale them down to stay a small tie-breaker that never overrides a
  // real difference in items/day.
  const TIEBREAK = { income: 1, yield: 0.02 };
  const PREFSCALE = { income: 0.1, yield: 0.002 };
  /* Community star-chance model (Aisen's Palia Garden Planner, cited by the wiki):
   * base = 0.25 + (starSeeds ? 0.25 : 0) + level*0.02 ; Quality Boost adds +0.5, capped at 1.0.
   * The author labels this "NOT the actual in-game formula — based off player observations". */
  function starChanceOf(opts, hasQ) {
    const level = opts.level != null ? opts.level : DEFAULT_OPT.level;
    const starSeeds = opts.starSeeds != null ? opts.starSeeds : DEFAULT_OPT.starSeeds;
    const base = 0.25 + (starSeeds ? 0.25 : 0) + level * 0.02;
    return hasQ ? Math.min(1, base + 0.5) : base;
  }

  /* ---------- buff / share helpers ---------- */
  function groupSyms(b) { return SYMS.filter(s => s !== 'A' && CROP[s].buff === b); } // A (3x3 apple) is user-only
  function initShares(opts) {
    for (const b of GROUPS) {
      const syms = groupSyms(b);
      if (!syms.length) continue;
      const eq = 1 / syms.length;
      for (const s of syms) if (opts.share[s] === undefined) opts.share[s] = eq;
    }
  }
  /* Harvest Boost is the only buff that raises yield/items directly, so under the
   * yield objective it is locked to the top-ranked buff spot (the user may only
   * reorder Q/W/N below it). Under the income objective the order is fully
   * user-configurable. */
  function normalizeBuffOrder(order, objective) {
    const src = order || DEFAULT_OPT.buffOrder;
    if (objective === 'yield') {
      const rest = src.filter(b => b !== 'H');
      return ['H'].concat(rest);
    }
    return src.slice();
  }
  /* The buff order the model actually applies, given the objective (pins H top
   * for yield, keeps the user's order for income). */
  function effectiveBuffOrder(opts) {
    return normalizeBuffOrder(opts.buffOrder, opts.objective);
  }
  /* Convenience: fresh default options with shares initialised, plus overrides. */
  function makeOpts(overrides) {
    const o = JSON.parse(JSON.stringify(DEFAULT_OPT));
    Object.assign(o, overrides || {});
    o.buffOrder = normalizeBuffOrder(o.buffOrder, o.objective);
    initShares(o);
    return o;
  }
  function shareOf(sym, opts) {
    const b = CROP[sym].buff;
    const syms = groupSyms(b);
    const tot = syms.reduce((a, s) => a + (opts.share[s] || 0), 0);
    return tot > 0 ? (opts.share[sym] || 0) / tot : 1 / syms.length;
  }
  function cropBias(sym, opts) { return 100 * shareOf(sym, opts); }  // higher share => favoured in autofill

  function buffWeights(opts) {
    const w = { H: 0, Q: 0, W: 0, N: 0 };
    effectiveBuffOrder(opts).forEach((b, i) => { w[b] = RANK_W[i] || 2; });
    return w;
  }

  /* ---------- instance identification (lenient, matches app display) ----------
   * Scans the grid top-left; a crop whose footprint block is complete becomes a
   * full instance, otherwise it is treated as a 1x1 fragment. This is how the
   * app *displays* a grid; the strict type checker below rejects the fragments
   * a valid layout should never contain. */
  function buildInstances(grid) {
    const insts = [];
    const seen = new Set();
    for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) {
      if (grid[r][c] == null || seen.has(r * 9 + c)) continue;
      const sym = grid[r][c], h = CROP[sym].sz[0], w = CROP[sym].sz[1];
      let ok = true;
      const cells = [];
      for (let dr = 0; dr < h; dr++) for (let dc = 0; dc < w; dc++) {
        const rr = r + dr, cc = c + dc;
        if (rr >= 9 || cc >= 9 || grid[rr][cc] !== sym) ok = false;
        cells.push(rr * 9 + cc);
      }
      if (ok) { insts.push({ sym, anchor: [r, c], cells }); cells.forEach(k => seen.add(k)); }
      else { insts.push({ sym, anchor: [r, c], cells: [r * 9 + c] }); seen.add(r * 9 + c); }
    }
    return insts;
  }

  /* ---------- canonical analysis (single source of truth for yield) ---------- */
  function analyzeLayout(grid, opts) {
    const insts = buildInstances(grid);
    const cellmap = new Map();
    insts.forEach((it, idx) => it.cells.forEach(k => cellmap.set(k, idx)));
    let income = 0, Hc = 0, Qc = 0, Wc = 0, Nc = 0, pref = 0, yieldTotal = 0;
    let grossTotal = 0, seedTotal = 0;
    const fertBy = { H: 0, Q: 0, W: 0, N: 0 };
    const cellinfo = {}, yields = {};
    for (let idx = 0; idx < insts.length; idx++) {
      const it = insts[idx], d = CROP[it.sym];
      const cnt = { H: 0, Q: 0, W: 0, N: 0 };
      const sup = { H: {}, Q: {}, W: {}, N: {} };
      const cs = new Set(it.cells);
      for (const k of it.cells) {
        const r = Math.floor(k / 9), c = k % 9;
        for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nr = r + dr, nc = c + dc;
          if (nr >= 0 && nr < 9 && nc >= 0 && nc < 9 && cellmap.has(nr * 9 + nc) && cellmap.get(nr * 9 + nc) !== idx) {
            const nsym = insts[cellmap.get(nr * 9 + nc)].sym;
            if (nsym === it.sym) continue; // a crop's buff affects only OTHER crop types
            const b = CROP[nsym].buff;
            if (b !== 'None') { cnt[b]++; sup[b][nsym] = (sup[b][nsym] || 0) + 1; }
          }
        }
      }
      const got = { H: cnt.H >= d.need, Q: cnt.Q >= d.need, W: cnt.W >= d.need, N: cnt.N >= d.need };
      if (got.H) Hc++; if (got.Q) Qc++; if (got.W) Wc++; if (got.N) Nc++;
      let fb = 'None';
      for (const b of effectiveBuffOrder(opts)) if (FERTBUFFS.includes(b) && !got[b] && opts.fert[b]) { fb = b; break; }
      const hasH = got.H || fb === 'H', hasQ = got.Q || fb === 'Q';
      const units = (hasH ? d.yldB : d.yld);
      // star quality is probabilistic; Quality Boost raises the chance, not to 100%
      const starChance = starChanceOf(opts, hasQ);
      const expectedValue = d.pv * (1 + starChance * 0.5); // pv*(1-s) + pv*1.5*s
      const yd = units * d.harv / d.cycle;                 // units/day
      yieldTotal += yd;
      const gross = units * d.harv * expectedValue / d.cycle;   // gross gold/day
      const tiles = d.sz[0] * d.sz[1];
      // seed cost = the seed's gold SELL value (opportunity cost), star seed if
      // starSeeds is enabled; matches the community (Aisen) convention.
      const useStar = opts.starSeeds != null ? opts.starSeeds : DEFAULT_OPT.starSeeds;
      const seedVal = useStar && d.seedStar != null ? d.seedStar : (d.seed || 0);
      const seedCost = seedVal / d.cycle;                           // seed gold/day
      // full benefit consumes 1 fertilizer per day per tile
      const fertCost = FERTBUFFS.includes(fb) ? tiles * FERT_PRICE[fb] : 0;
      const income_p = gross - seedCost - fertCost;             // net gold/day
      income += income_p;
      grossTotal += gross; seedTotal += seedCost;
      pref += cropBias(it.sym, opts);
      yields[it.sym] = (yields[it.sym] || 0) + yd;
      if (FERTBUFFS.includes(fb)) fertBy[fb] += tiles;
      for (const k of it.cells) {
        const r = Math.floor(k / 9), c = k % 9;
        cellinfo[r * 9 + c] = { sym: it.sym, got, fert: fb, tiles, income: income_p, yield: yd };
      }
      it.got = got; it.fert = fb; it.yd = yd; it.tiles = tiles; it.sup = sup; it.cnt = cnt;
    }
    const fert = fertBy.H + fertBy.Q + fertBy.W + fertBy.N;
    const fertCost = fertBy.H * FERT_PRICE.H + fertBy.Q * FERT_PRICE.Q + fertBy.W * FERT_PRICE.W + fertBy.N * FERT_PRICE.N;
    return { income, yield: yieldTotal, gross: grossTotal, seedCost: seedTotal, fertCost, fert, fertBy, H: Hc, Q: Qc, W: Wc, N: Nc, yields, instances: insts, cellinfo, pref };
  }

  function scoreFull(grid, opts) {
    const a = analyzeLayout(grid, opts);
    return { income: a.income, yield: a.yield, H: a.H, Q: a.Q, W: a.W, N: a.N, pref: a.pref };
  }
  function scoreTotal(grid, opts) {
    const s = scoreFull(grid, opts);
    const w = buffWeights(opts);
    const objective = opts.objective === 'yield' ? 'yield' : 'income';
    const primary = objective === 'yield' ? s.yield : s.income;
    // the crop-mix bias is applied only when the user wants it; otherwise the
    // optimizer is free to pick the crop mix purely on the objective
    const prefTerm = opts.cropMix === false ? 0 : PREFSCALE[objective] * s.pref;
    const buffTerm = TIEBREAK[objective] * (w.H * s.H + w.Q * s.Q + w.W * s.W + w.N * s.N);
    return primary + buffTerm + prefTerm;
  }

  /* ---------- layout type checker ---------- */
  /* Verifies a 9x9 grid is a valid packing of complete crop footprints:
   * no cell superimposed, every crop instance a full rectangle of its size,
   * nothing spilling past the plot edge, only known symbols, no stray cells
   * that look like a partial crop. */
  function validateLayout(grid) {
    const errors = [];
    if (!Array.isArray(grid) || grid.length !== 9) {
      return { valid: false, errors: ['grid must be a 9x9 array'] };
    }
    for (let r = 0; r < 9; r++) {
      if (!Array.isArray(grid[r]) || grid[r].length !== 9) {
        errors.push(`row ${r} must have 9 cells`);
      }
    }
    if (errors.length) return { valid: false, errors };
    const seen = new Set();
    for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) {
      const sym = grid[r][c];
      if (sym == null) continue;
      if (seen.has(r * 9 + c)) continue;
      if (!CROP[sym]) {
        errors.push(`unknown crop symbol '${sym}' at (${r},${c})`);
        seen.add(r * 9 + c);
        continue;
      }
      const d = CROP[sym], h = d.sz[0], w = d.sz[1];
      let incomplete = false;
      if (r + h > 9 || c + w > 9) {
        errors.push(`${d.name} at (${r},${c}) extends beyond the plot edge`);
        incomplete = true;
      }
      const block = [];
      for (let dr = 0; dr < h; dr++) for (let dc = 0; dc < w; dc++) {
        const rr = r + dr, cc = c + dc;
        if (rr < 9 && cc < 9 && grid[rr][cc] === sym) block.push(rr * 9 + cc);
      }
      if (block.length !== h * w) {
        errors.push(`${d.name} at (${r},${c}) is an incomplete or superimposed instance (${block.length}/${h * w} cells)`);
        // mark the same-symbol cells of this footprint so we never reprocess a
        // fragment as the start of another instance
        block.forEach(k => seen.add(k));
        seen.add(r * 9 + c);
        continue;
      }
      // a complete block must not overlap any cell already claimed by an earlier
      // instance (a superimposition). Check before adding to `seen`.
      if (block.some(k => seen.has(k))) {
        errors.push(`${d.name} at (${r},${c}) overlaps another crop`);
      }
      block.forEach(k => seen.add(k));
      seen.add(r * 9 + c);
    }
    return { valid: errors.length === 0, errors };
  }

  /* ---------- placement / optimizer (ported from the app, opts-parameterised) ---------- */
  function canPlace(grid, sym, r, c) {
    const h = CROP[sym].sz[0], w = CROP[sym].sz[1];
    if (r + h > 9 || c + w > 9) return false;
    for (let dr = 0; dr < h; dr++) for (let dc = 0; dc < w; dc++) if (grid[r + dr][c + dc] != null) return false;
    return true;
  }
  function localBuff(grid, sym, cells) {
    const cnt = { H: 0, Q: 0, W: 0, N: 0 };
    const cs = new Set(cells);
    for (const k of cells) {
      const r = Math.floor(k / 9), c = k % 9;
      for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nr = r + dr, nc = c + dc;
        if (nr >= 0 && nr < 9 && nc >= 0 && nc < 9 && grid[nr][nc] != null && grid[nr][nc] !== sym && !cs.has(nr * 9 + nc)) {
          const b = CROP[grid[nr][nc]].buff;
          if (b !== 'None') cnt[b]++;
        }
      }
    }
    const need = CROP[sym].need;
    return Object.values(cnt).filter(x => x >= need).length;
  }
  function buildGrid(selection) {
    const grid = Array.from({ length: 9 }, () => Array(9).fill(null));
    const user = Array(81).fill(false);
    const order = SYMS.filter(s => selection[s] > 0).sort((a, b) => CROP[b].sz[0] * CROP[b].sz[1] - CROP[a].sz[0] * CROP[a].sz[1]);
    for (const sym of order) {
      for (let k = 0; k < selection[sym]; k++) {
        const h = CROP[sym].sz[0], w = CROP[sym].sz[1];
        const cands = [];
        for (let r = 0; r <= 9 - h; r++) for (let c = 0; c <= 9 - w; c++) if (canPlace(grid, sym, r, c)) {
          const cells = [];
          for (let dr = 0; dr < h; dr++) for (let dc = 0; dc < w; dc++) cells.push((r + dr) * 9 + c + dc);
          cands.push([r, c, localBuff(grid, sym, cells)]);
        }
        if (!cands.length) return null;
        const mx = Math.max(...cands.map(x => x[2]));
        const top = cands.filter(x => x[2] === mx);
        const p = top[Math.floor(Math.random() * top.length)];
        for (let dr = 0; dr < h; dr++) for (let dc = 0; dc < w; dc++) { grid[p[0] + dr][p[1] + dc] = sym; user[(p[0] + dr) * 9 + p[1] + dc] = true; }
      }
    }
    return { grid, user };
  }
  function cropOverlapsUser(sym, r, c, user) {
    const h = CROP[sym].sz[0], w = CROP[sym].sz[1];
    for (let dr = 0; dr < h; dr++) for (let dc = 0; dc < w; dc++) if (user[(r + dr) * 9 + c + dc]) return true;
    return false;
  }
  function fillInitial(grid, f1, f2) {
    grid = grid.map(r => r.slice());
    for (const sym of f2) {
      const h = CROP[sym].sz[0], w = CROP[sym].sz[1];
      for (;;) {
        let best = null, bs = -1;
        for (let r = 0; r <= 9 - h; r++) for (let c = 0; c <= 9 - w; c++) if (canPlace(grid, sym, r, c)) {
          const cells = [];
          for (let dr = 0; dr < h; dr++) for (let dc = 0; dc < w; dc++) cells.push((r + dr) * 9 + c + dc);
          const sc = localBuff(grid, sym, cells);
          if (sc > bs) { bs = sc; best = [r, c]; }
        }
        if (!best) break;
        for (let dr = 0; dr < h; dr++) for (let dc = 0; dc < w; dc++) grid[best[0] + dr][best[1] + dc] = sym;
      }
    }
    const order = f1;
    let i = 0;
    for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) if (grid[r][c] == null) { grid[r][c] = order[i % order.length]; i++; }
    return grid;
  }
  function getAnchors(grid) {
    const a = [], cov = new Set();
    for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) {
      if (cov.has(r * 9 + c) || grid[r][c] == null) continue;
      const sym = grid[r][c], h = CROP[sym].sz[0], w = CROP[sym].sz[1];
      if (h === 1 && w === 1) continue;
      if (r > 0 && grid[r - 1][c] === sym) continue;
      if (c > 0 && grid[r][c - 1] === sym) continue;
      a.push([sym, r, c]);
      for (let dr = 0; dr < h; dr++) for (let dc = 0; dc < w; dc++) cov.add((r + dr) * 9 + c + dc);
    }
    return a;
  }
  function hillfill(grid, user, iters, f1, f2, opts) {
    grid = grid.map(r => r.slice());
    let cur = scoreTotal(grid, opts), best = cur, bg = grid.map(r => r.slice());
    for (let it = 0; it < iters; it++) {
      const g2 = grid.map(r => r.slice());
      const move = Math.random();
      if (move < 0.4) {
        const cells = [];
        for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) if (f1.includes(g2[r][c]) && !user[r * 9 + c]) cells.push([r, c]);
        if (!cells.length) continue;
        const [r, c] = cells[Math.floor(Math.random() * cells.length)];
        const cs = g2[r][c];
        if (Math.random() < 0.5) {
          const ns = f1[Math.floor(Math.random() * f1.length)];
          if (ns === cs) continue;
          g2[r][c] = ns;
        } else {
          const [r2, c2] = cells[Math.floor(Math.random() * cells.length)];
          if (r2 === r && c2 === c) continue;
          const t = g2[r][c]; g2[r][c] = g2[r2][c2]; g2[r2][c2] = t;
        }
      } else if (move < 0.85) {
        const spots = [];
        for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++)
          if (f1.includes(g2[r][c]) && f1.includes(g2[r + 1][c]) && f1.includes(g2[r][c + 1]) && f1.includes(g2[r + 1][c + 1])
            && !user[r * 9 + c] && !user[(r + 1) * 9 + c] && !user[r * 9 + c + 1] && !user[(r + 1) * 9 + c + 1]) spots.push([r, c]);
        if (!spots.length || !f2.length) continue;
        const [r, c] = spots[Math.floor(Math.random() * spots.length)];
        const sym = f2[Math.floor(Math.random() * f2.length)];
        for (let dr = 0; dr < 2; dr++) for (let dc = 0; dc < 2; dc++) g2[r + dr][c + dc] = sym;
      } else {
        const anchors = getAnchors(g2).filter(a => f2.includes(a[0]) && !cropOverlapsUser(a[0], a[1], a[2], user));
        if (!anchors.length) continue;
        const [sym, r, c] = anchors[Math.floor(Math.random() * anchors.length)];
        for (let dr = 0; dr < 2; dr++) for (let dc = 0; dc < 2; dc++) g2[r + dr][c + dc] = f1[Math.floor(Math.random() * f1.length)];
      }
      const sc = scoreTotal(g2, opts);
      if (sc > cur || Math.random() < 0.001) { grid = g2; cur = sc; if (sc > best) { best = sc; bg = g2.map(r => r.slice()); } }
    }
    return [bg, best];
  }
  function optimizeSynergy(selection, fill, iters, opts) {
    const sel = new Set(SYMS.filter(s => selection[s] > 0));
    let f1 = FILL.filter(s => !sel.has(s)); if (!f1.length) f1 = FILL.slice();
    let f2 = PROVIDERS.filter(s => !sel.has(s)); if (!f2.length) f2 = PROVIDERS.slice();
    if (opts.preferBig) {
      const bigBuffs = new Set(f2.map(s => CROP[s].buff));
      const reduced = f1.filter(s => !bigBuffs.has(CROP[s].buff));
      if (reduced.length) f1 = reduced;
    }
    const restarts = fill ? 10 : 1;
    let bestg = null, bestsc = -1;
    for (let k = 0; k < restarts; k++) {
      const r = buildGrid(selection);
      if (!r) return [null, 0];
      let g = r.grid;
      const user = r.user;
      if (fill) {
        g = fillInitial(g, f1, f2);
        const [bg, b] = hillfill(g, user, Math.max(1500, Math.floor(iters / restarts)), f1, f2, opts);
        if (bg && b > bestsc) { bestsc = b; bestg = bg; }
      } else {
        const s = scoreTotal(g, opts);
        if (s > bestsc) { bestsc = s; bestg = g; }
      }
    }
    return [bestg, bestsc];
  }

  /* ---------- harvest schedule (forward simulation) ---------- */
  /* Returns the set of day-offsets (within one planting cycle, 1-based) on
   * which a harvest occurs. For harv==1 that is just `first` (= cycle). */
  function harvestSchedule(d) {
    const s = new Set();
    if (d.harv <= 1) { s.add(d.first); return s; }
    const re = (d.cycle - d.first) / (d.harv - 1);
    for (let j = 0; j < d.harv; j++) s.add(d.first + j * re);
    return s;
  }
  function cycleText(d) {
    if (d.harv <= 1) return `ready ${d.first}d · single harvest`;
    const re = (d.cycle - d.first) / (d.harv - 1);
    return `ready ${d.first}d, +${d.harv - 1}× every ${re}d (${d.cycle}d total)`;
  }

  /* ---------- simulator ----------
   * Takes a valid layout (a 9x9 grid) and runs it forward over `horizon` days.
   * Returns the analytic steady-state yield (what the app/optimizer claims)
   * alongside a day-by-day forward simulation that accumulates actual harvests,
   * so the two can be cross-checked. */
  function simulate(grid, opts, horizon) {
    const v = validateLayout(grid);
    if (!v.valid) return { valid: false, errors: v.errors };
    const a = analyzeLayout(grid, opts);
    const total = { units: 0, income: 0 };
    const perCrop = [];
    const perCropTotals = {};
    for (const it of a.instances) {
      const d = CROP[it.sym];
      const hasH = it.got.H || it.fert === 'H';
      const hasQ = it.got.Q || it.fert === 'Q';
      const units = (hasH ? d.yldB : d.yld);
      const starChance = starChanceOf(opts, hasQ);
      const expectedValue = d.pv * (1 + starChance * 0.5);
      const perHarvest = units * expectedValue;
      const sched = harvestSchedule(d);
      let count = 0;
      for (let day = 1; day <= horizon; day++) {
        const off = ((day - 1) % d.cycle) + 1;
        if (sched.has(off)) count++;
      }
      const plantings = Math.ceil(horizon / d.cycle);
      const useStar = opts.starSeeds != null ? opts.starSeeds : DEFAULT_OPT.starSeeds;
      const seedVal = useStar && d.seedStar != null ? d.seedStar : (d.seed || 0);
      const seedCost = plantings * seedVal;
      const fertCost = (it.fert !== 'None') ? it.cells.length * FERT_PRICE[it.fert] * horizon : 0;
      const instUnits = count * units;
      const instIncome = count * perHarvest - seedCost - fertCost;
      total.units += instUnits;
      total.income += instIncome;
      perCrop.push({ sym: it.sym, cells: it.cells, harvests: count, units: instUnits, income: instIncome });
      if (!perCropTotals[it.sym]) perCropTotals[it.sym] = { units: 0, income: 0 };
      perCropTotals[it.sym].units += instUnits;
      perCropTotals[it.sym].income += instIncome;
    }
    const yieldsPerDay = {};
    for (const s in perCropTotals) yieldsPerDay[s] = perCropTotals[s].units / horizon;
    return {
      valid: true,
      horizon,
      analytic: {
        incomePerDay: a.income,
        yieldsPerDay: a.yields,
        buffCoverage: { H: a.H, Q: a.Q, W: a.W, N: a.N },
        fert: a.fert,
        fertBy: a.fertBy,
      },
      forward: {
        totalUnits: total.units,
        totalIncome: total.income,
        incomePerDay: total.income / horizon,
        yieldsPerDay,
      },
      perCrop,
    };
  }

  return {
    CROP, SYMS, FILL, PROVIDERS, FERTBUFFS, GROUPS, RANK_W, DEFAULT_OPT,
    groupSyms, initShares, shareOf, cropBias, buffWeights, makeOpts, normalizeBuffOrder, starChanceOf,
    buildInstances, analyzeLayout, scoreFull, scoreTotal,
    analyze: analyzeLayout,
    validateLayout,
    canPlace, localBuff, buildGrid, cropOverlapsUser, fillInitial,
    getAnchors, hillfill, optimizeSynergy,
    harvestSchedule, cycleText, simulate,
  };
});
