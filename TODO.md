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

### NOT started

- **Import an Aisen code back into the editor** — read `?layout=...` on load and
  decode Aisen's v0.5 code into our grid (through `validateLayout` as the gate),
  so Aisen share links round-trip into our tool.
- **Our own codec** — a versioned `v1_<...>` format (rather than Aisen's), so
  links that stay inside our tool don't depend on Aisen's undocumented format.
- **Community examples** — "Load community example" for reference layouts (Aisen's
  example, paliaguide's "Apple Gold Farm").

### Notes / decisions

- Our type checker (`validateLayout`) is the natural gate on any import — reuse it.
- Aisen's codec is custom and undocumented; being compatible with it is now only
  needed for the *export* direction (done), not for our own import codec.

