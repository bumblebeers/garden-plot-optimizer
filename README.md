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
  Under **Net income** only HarvestBoost and QualityUp can ever pay for
  themselves, so HydratePro / WeedBlock are never bought there (they cost gold
  and change neither yield nor star chance).
- **Optimise for** — **Net income /day** or **Crops per day (items)**. The income
  objective maximises net gold/day (the default); the yield objective maximises
  the total number of harvested items per day, ignoring seed/fertilizer cost.
- **Prefer 2×2 crops** — fewer, larger plants for less upkeep (some income cost).
- **Buff priority** — ranks the buffs. Under **Net income** each crop's
  fertiliser is chosen by what pays most (HarvestBoost for essentially every
  crop), so this order only breaks exact ties; under **Crops per day**,
  **Harvest Boost is locked to the top spot** (it is the only buff that raises
  yield/items directly) and the rest of the order picks which convenience buff
  the layout buys where the item count cannot tell them apart. Rank the
  low-maintenance buffs first for an easy garden.
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

**Import from Aisen.** An **Import** field accepts an Aisen save link or code
(`https://palia-garden-planner.vercel.app/?layout=<code>`) and loads the layout
into both the grid and the crop-selection menu — including a *partially finished*
plot (empty tiles stay empty; Aisen's trimmed `D-WxH` dimensions are handled).
The imported gardening level and star-seed setting are applied to Preferences
when the code carries them. **Fertilizer is not restored** — the grid stores only
crop symbols, and the per-crop assignment is re-derived in `analyzeLayout` on the
next Optimize. A code with settings but no `Nss` (no-star-seeds) flips the
star-seed toggle ON (Aisen's default), faithful to the shared layout; a code with
no settings leaves the recipient's Preferences untouched.

**Pin crops.** A **Pin mode** toggle (or the 📌 button in a tile's detail card)
locks a crop at its exact position. When you then hit **Optimize**, pinned crops
never move — the optimizer fills and hill-climbs the rest of the plot around them.
Unpin crops (individually or all) and regenerate to let the freed crops move to a
more optimal spot while the still-pinned ones keep their locations.

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
- **`optimizeSynergy(selection, fill, iters, opts, pins?)`** — the
  placement/optimizer, parameterised by options; an optional `pins` array of
  `{ sym, r, c }` anchors keeps those crops fixed at their exact positions while
  the rest of the plot is optimized around them. Placement is a randomised
  greedy placer, so it retries until it has its full quota of packings to
  hill-climb (a failed attempt costs ~0.1 ms) — a feasible selection is reported
  unfittable only after the retries, and a final first-fit fallback, all fail.
- **`encodeAisen(grid, opts)`** — serializes a 9×9 layout into Aisen's Palia
  Garden Planner v0.5 save code (crops + per-crop fertilizer), for the **Copy
  Aisen link** button. A round-trip test in `test/export.test.js` decodes the
  output with a faithful replica of Aisen's own `expandPlotCode`/plot loader.
- **`decodeAisen(code)`** — the inverse codec, for the **Import** field: parses
  an Aisen v0.5 save code (including a partial / trimmed `D-WxH` plot) back into
  our 9×9 grid and the level / star-seed settings. The per-tile fertilizer Aisen
  carries is parsed but not returned (the app re-derives it in `analyzeLayout`).
  Tests in `test/import.test.js` pin it against hand-written codes and
  round-trips.
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
maximise **crops per day** (total harvested items/day). Each crop's fertiliser is
chosen by the objective, not by a fixed rule: under the income objective the model
buys the class that pays most for that crop — what the buff adds to the harvest
value against its price per tile per day — which is HarvestBoost for essentially
every crop and leaves Water Retain / Weed Block unbought, since they add no gold.
Under the yield objective only Harvest Boost changes the item count, so the buff
priority order decides which convenience buff the layout buys where the count
cannot; Harvest Boost is locked to the top-ranked spot there (it is the only buff
that raises yield/items directly) and the user reorders Quality / Water-retain /
Weed-block below it. The income score is the net income figure itself plus, when
the **crop mix** toggle is on, the crop-mix bias; with the toggle off the optimizer
ranks by net income alone. The yield score is items/day plus a much smaller ranked
coverage tie-break (the convenience buffs, which items/day is blind to). This is
why our income figure is directly comparable to the community's profit-based
numbers (Aisen's planner and the r/Palia cost-and-earnings charts), rather than a
gross upper bound.

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
npm test                # 71 tests: type checker, simulator, data, full app, Aisen export/import, pins
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
