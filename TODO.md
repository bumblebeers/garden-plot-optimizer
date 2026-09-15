# TODO

Backlog for the Palia Garden Optimizer. Items here are not in the current scope
and have not been started unless marked.

## Shareable / importable layout codes

Aisen's Palia Garden Planner (the tool the official wiki links) lets users share a
full garden layout as a compact URL (`?layout=...`), which is a big part of how the
community exchanges and compares layouts.

### DONE — export to Aisen

A **Copy Aisen link** button encodes the current layout into Aisen's Palia Garden
Planner **v0.5** save code and copies a
`https://palia-garden-planner.vercel.app/?layout=<code>` URL. Opening the link
loads the exact layout (crops + per-crop fertilizer) in Aisen's planner.

- `encodeAisen(grid, opts)` in `src/garden.js` serializes a 9×9 layout into the
  Aisen v0.5 format (`0.5_D-9x9_CR-<plot><code>-...[_<settings>]`), mapping our
  crop symbols and fertilizer buffs onto Aisen's codes and splitting the grid into
  nine 3×3 plots. `settings` carries `L<level>` and `Nss` (star-seed off).
- Round-trip tests in `test/export.test.js` decode the output with a faithful
  replica of Aisen's own `expandPlotCode`/plot loader, and verify it against
  Aisen's `parseSave`/`validateNewPlotFormat` path (crop/fert codes, 9 tiles per
  plot, in-bounds).
- The button lives in `index.html`; the link is copied to the clipboard (with a
  `execCommand`/`prompt` fallback for `file://`).

### DONE — import from Aisen

An **Import** field accepts an Aisen save link or code (`?layout=<code>`) and
loads the layout into the grid and the crop-selection menu, including a
*partially finished* plot.

- `decodeAisen(code)` in `src/garden.js` parses an Aisen v0.5 save code back into
  our 9×9 grid + level / star-seed settings. It is the inverse of `encodeAisen`
  and the mirror of Aisen's own `expandPlotCode` + `GardenGridBasic.placeCrop`.
  Aisen's per-tile fertilizer is parsed but not carried into the app — the grid
  stores only crop symbols and re-derives the assignment in `analyzeLayout` on
  the next Optimize.
- Handles Aisen's **trimmed** dimensions (`D-WxH` smaller than 9×9, from
  `trimGarden`) and partially filled plots (empty tiles stay empty). A
  partially finished plot is accepted through `validateLayout` as the gate.
- Round-trip and hand-written-code tests in `test/import.test.js`.

### DONE — pin crops

A **Pin mode** toggle (and a 📌 button in a tile's detail card) locks a crop at
its exact position; the optimizer keeps pinned crops fixed and fills /
hill-climbs the rest of the plot around them.

- `optimizeSynergy(selection, fill, iters, opts, pins?)` and `buildGrid(selection,
  pins?)` take an optional `pins` array of `{ sym, r, c }` anchors. Pinned crops
  are placed first, marked immutable in the `user` mask, and never moved.
- Tests in `test/pin.test.js` verify pinned crops stay at their anchors, that a
  pinned crop's symbol is excluded from the autofill pools, and that
  overlapping / out-of-bounds pins are rejected.

### NOT started

- **Our own codec** — a versioned `v1_<...>` format (rather than Aisen's), so
  links that stay inside our tool don't depend on Aisen's undocumented format.
- **Community examples** — "Load community example" for reference layouts (Aisen's
  example, paliaguide's "Apple Gold Farm").

### Notes / decisions

- Our type checker (`validateLayout`) is the natural gate on any import — reuse it.
- Aisen's codec is custom and undocumented; being compatible with it is needed for
  both the *export* direction (done) and the *import* direction (done); our own
  import codec is not required for links that stay inside our tool.

