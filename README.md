# Palia Garden Optimizer

A single-page web app that determines an optimal Palia garden layout for feeding
livestock, making recipes, and generating income.

## What it does

Open `index.html` in a browser — no server or build step. It is a single
self-contained file (the garden model is inlined), so you can download just the
one HTML file and open it standalone. Pick crops from the
palette (all **15** plantable Palia crops), set your preferences, then **Optimize** to
generate a 9×9 layout that maximises either **net income** or **crops per day**
(items) — your pick in Preferences — with buff synergy emerging from the search.

**Selection.** A single list shows all 15 plantable crops; each row has a + / − / ✕ to set
the count and shows its footprint (e.g. `3×3 · 9 tiles`). A space bar tracks the
81-tile plot and crops that won't fit have their + disabled. Big crops render as
single spanning blocks with *Merge big crops*. The autofill fills the rest from
the 14 autofill crops.

**Preferences** (set before optimizing):

- **Fertilizer, opt-in per class** — HarvestBoost / QualityUp / HydratePro /
  WeedBlock. Only the enabled classes are assumed; the layout adapts accordingly.
- **Optimise for** — **Net income /day** or **Crops per day (items)**. The income
  objective maximises net gold/day (the default); the yield objective maximises
  the total number of harvested items per day, ignoring seed/fertilizer cost.
- **Prefer 2×2 crops** — fewer, larger plants for less upkeep (some income cost).
- **Buff priority** — under **Crops per day**, **Harvest Boost is locked to the
  top spot** (it is the only buff that raises yield/items directly) and you
  reorder Quality, Water-retain and Weed-block below it; under **Net income** the
  order is fully user-configurable. Rank the low-maintenance buffs first for an
  easy garden.
- **Crop mix** — tick to use the per-buff crop-mix donuts below; untick to let the
  optimizer pick the crop mix purely on the objective.
- **Autofill crop mix per buff** — a donut per buff group; drag the dividers to
  set which crops (of that buff) the autofill prefers.

**Views.** The plot is always merged — a 3×3 apple tree renders as one block, not
nine cells. **Click any tile** for its detail card: yield and growth/production
cycle, the buffs it receives *and which neighbouring crops supply them* (with a
partial flag when it's short of the required count), what it provides, the
fertilizer on that spot, and one-click swaps for interchangeable crops (same buff
and footprint) with their yield comparison. A stats area shows income, **total
produced per day** (whole-plot items/day), per-class fertilizer use, buff
coverage, and **Yield per day** broken down per crop.

**Share to Aisen.** A **Copy Aisen link** button encodes the current layout into
Aisen's Palia Garden Planner v0.5 save code and copies a
`https://palia-garden-planner.vercel.app/?layout=<code>` URL. Opening the link
loads the exact layout (crops + per-crop fertilizer assignment) in Aisen's
planner, so an optimized garden can be shared into the community's standard tool.

## Architecture & verification

The game logic lives in `src/garden.js` — the single source of truth (UMD: sets
the browser global `Garden` and is `require`d by Node). It is inlined into
`index.html`, which is a self-contained single file, and a test in
`test/app.test.js` asserts the inlined copy stays in sync with `src/garden.js`.
The tests exercise exactly what the app computes:

- **`validateLayout(grid)`** — a type checker: verifies a 9×9 layout is a valid
  packing (no superimposed/partial crops, nothing past the plot edge, only known
  crops).
- **`simulate(grid, opts, horizon)`** — runs a validated layout forward and
  returns both the analytic steady-state yield and a day-by-day simulation that
  accumulates actual harvests, so the two can be cross-checked.
- **`optimizeSynergy(...)`** — the placement/optimizer, parameterised by options.
- **`encodeAisen(grid, opts)`** — serializes a 9×9 layout into Aisen's Palia
  Garden Planner v0.5 save code (crops + per-crop fertilizer), for the **Copy
  Aisen link** button. A round-trip test in `test/export.test.js` decodes the
  output with a faithful replica of Aisen's own `expandPlotCode`/plot loader.
- `CROP` / `SYMS` / etc. — crop data and the yield model (a single source of
  truth for both app and tests).

The buff model enforces the game's **same-type rule** (from the official wiki):
*a crop's buff affects only adjacent crops of OTHER crop types.* A field of one
crop species does not buff itself — a block of tomatoes gives no Water Retain to
its own tomatoes, only to a different species beside it.

Income is shown as **net /day** = gross harvest value − **seed cost** −
**fertilizer cost**, with a transparent breakdown in the UI. Star quality is
**probabilistic**, modelled on the community formula (Aisen's Palia Garden
Planner, cited by the wiki): base = **25% + 25% (star seeds) + 2% × Gardening
level**, and **Quality Boost adds a flat +50%**, capped at 100%. This is the
community's best estimate — the official wiki only states produce "has a chance
to be Quality" and publishes no numeric chance. Gardening level and star seeds
are set in Preferences. Seed cost is the seed's **gold sell value** (the
opportunity cost of planting it, matching the community convention — Aisen's
planner values seeds at their sell value, not the purchase price), using the
star seed value when "use star seeds" is on; non-gold seeds (apple, blueberry,
rockhopper pumpkin, batterfly beans) have real gold sell values and are no longer
treated as free. Fertilizer costs use each class's sell price (HarvestBoost 5,
QualityUp 2, HydratePro 1, WeedBlock 1) and assume full benefit = 1 fertilizer
consumed per day per tile, per the wiki.

The **optimizer maximises net income by default**, with a toggle to instead
maximise **crops per day** (total harvested items/day). The buff priority order is
fully user-configurable under the income objective; under the yield objective
Harvest Boost is locked to the top-ranked buff spot (it is the only buff that
raises yield/items directly) and the user reorders Quality / Water-retain /
Weed-block below it. Under the income objective, Harvest Boost and Quality Boost
boost value directly, so they emerge from the search; Water Retain / Weed Block
coverage (convenience, not gold) and the crop-mix preference are kept as a small
tie-breaker. Under the yield objective the primary term is items/day (Harvest
Boost emerges because it ×1.5's the count), with the convenience buffs and crop-mix
kept as a much smaller tie-breaker. When the **crop mix** toggle is off, the
crop-mix bias is dropped entirely and the optimizer picks the mix purely on the
objective. This is why our income figure is directly comparable to the
community's profit-based numbers (Aisen's planner and the r/Palia cost-and-earnings
charts), rather than a gross upper bound.

The stats read like the community tools (Aisen's Palia Garden Planner,
paliaguide): buffs are shown by name (**Harvest Boost / Quality Boost / Water
Retain / Weed Block**) and buff coverage as **% of the plot**.

The crop data is verified against the official Palia wiki (palia.wiki.gg) — buffs,
harvest schedules, yields, and best-sell (preserves) values — and encoded as
data-driven test cases in `test/data.test.js`. The simulator has been
cross-checked against the community's own layouts: it reproduces Aisen's example
layout and shows paliaguide's "Apple Gold Farm" yields ~3,490/day (not its
claimed ~9,500), because tomato/potato provide Water Retain, not the Harvest/Quality
the apple needs — which the optimizer then corrects by surrounding the apple with
Harvest providers.

```sh
npm test                # 55 tests: type checker, simulator, data, full app, Aisen export
npm run verify          # optimizer vs random-valid-layouts harness -> reports/
```

`tools/verify-optimizer.js` runs the optimizer under several starting
conditions (including a `yield` objective scenario), type-checks and simulates
its output, then samples hundreds of random but valid layouts under the same
constraints, compares the objective metric (income/day or items/day), and writes
charts + raw data to `reports/`.

## Notes

- Income is **net** (gross harvest value − seed cost − fertilizer cost), using
  best-sell (preserves) values, harvest boost → +50% yield, and the community
  star-chance model (Quality Boost → +50% star chance, capped at 100%).
- Under the **crops per day** objective, seed/fertilizer cost and star quality
  don't affect the score — only Harvest Boost raises the item count — so the
  optimizer favours high-count, fast-recycling crops (tomato, bok choy, carrot,
  rice) over high-value ones (apple, potato, corn).
- Layout generation is a heuristic (randomised placement + hill-climb restarts),
  so re-running *Optimize* may yield a different but equally good arrangement.
- Crop data from the official Palia wiki (palia.wiki.gg); the star-chance model is
  the community estimate from Aisen's Palia Garden Planner (the wiki publishes no
  numeric star chance).

## Origin

Started as a one-off question about the optimal Palia garden layout and grew into
a working tool.
