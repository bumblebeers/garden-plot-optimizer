# TODO

Backlog for the Palia Garden Optimizer. Items here are not in the current scope
and have not been started unless marked.

## Shareable / importable layout codes

Aisen's Palia Garden Planner (the tool the official wiki links) lets users share a
full garden layout as a compact URL (e.g. `?layout=v0.2_DIM-111-111-111_CROPS-...`),
which is a big part of how the community exchanges and compares layouts. Our tool
has no equivalent, which makes it harder to drop into the existing community flow.

**Goal:** a user can export the current plot to a shareable code and import
someone else's code back into the editor.

### Sketch

- **Serialize** — encode a 9×9 grid to a compact string. Aisen uses a
  `v0.2_DIM-<dims>_CROPS-<rows>` format; we can define our own (e.g. a
  `v1_<81-char symbol string>_FERT-<81-char fert string>`), but a versioned,
  human-comparable format is the requirement.
- **Deserialize** — parse the code back into a grid. On import, run it through
  `validateLayout` (the type checker) so a bad/edited code is rejected with a
  clear error rather than silently mis-rendered.
- **URL param** — read `?layout=...` on load so a shared link opens the exact
  layout (like Aisen's).
- **UI** — "Copy layout code" / "Paste layout code" buttons; maybe a "Load
  community example" for reference layouts (Aisen's example, paliaguide's
  "Apple Gold Farm").
- **Fertilizer + options** — the code must also capture per-tile fertilizer
  (or the fertilizer-assignment is recomputed from the layout by our model) and
  the options (buff order, star chance, fert toggles) so a shared link reproduces
  the same result.

### Notes / decisions to make

- Our type checker (`validateLayout`) is the natural gate on import — reuse it.
- Aisen's codec is custom and undocumented; we do not need to be compatible with
  it, but being *close in spirit* (versioned, compact, shareable via URL) is what
  makes our tool intelligible to the community.
- This is intentionally deferred to a later session.
