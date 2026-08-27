<img src="cubing.js.png" alt="cubing.js" width="512">

# `cubing.js` lightweight fork

A **lightweight fork of [`cubing.js`](https://github.com/cubing/cubing.js)**: fewer puzzles, smaller lazily-loaded chunks, and some extra visualization features.

The API surface, the module layout and the build system are unchanged from upstream, so this is a drop-in replacement for `cubing` as long as you only use the puzzles listed below.

- Upstream project: <https://github.com/cubing/cubing.js>
- Upstream documentation: <https://js.cubing.net/cubing/>

## Supported puzzles

| Puzzle | ID | 3D | 2D net | 2D last layer | Scrambles |
| --- | --- | :-: | :-: | :-: | --- |
| 3×3×3 Cube | `3x3x3` | ✅ | ✅ | ✅ | random-state |
| 2×2×2 Cube | `2x2x2` | ✅ | ✅ | ✅ | random-state |
| 4×4×4 Cube | `4x4x4` | ✅ | ❌ | ✅ | random-state |
| 5×5×5 Cube | `5x5x5` | ✅ | ❌ | ✅ | random-moves |
| 6×6×6 Cube | `6x6x6` | ✅ | ❌ | ❌ | random-moves |
| 7×7×7 Cube | `7x7x7` | ✅ | ❌ | ❌ | random-moves |
| Square-1 | `square1` | ✅ | ✅ | ✅ | random-state |
| Pyraminx | `pyraminx` | ✅ | ✅ | ❌ | random-state |
| Megaminx | `megaminx` | ✅ | ❌ | ✅ | random-moves |
| Clock | `clock` | ❌ | ✅ | ❌ | random-state |
| Skewb | `skewb` | ✅ | ❌ | ❌ | random-state |
| Face-Turning Octahedron | `fto` | ✅ | ✅ | ❌ | random-state |

Every WCA event is supported (`222`, `333`, `444`, `555`, `666`, `777`, `333bf`, `333fm`, `333oh`, `333mbf`, `444bf`, `555bf`, `clock`, `minx`, `pyram`, `skewb`, `sq1`), plus `fto`.

## Breaking changes vs. upstream

### Removed puzzles

These puzzles are gone from `puzzles`, from `PuzzleID`, and from the `<twisty-player puzzle="…">` attribute. Requesting one throws instead of rendering.

| Removed | Upstream ID |
| --- | --- |
| Kilominx | `kilominx` |
| Master Tetraminx | `master_tetraminx` |
| Gigaminx | `gigaminx` |
| Redi Cube | `redi_cube` |
| Baby FTO | `baby_fto` |
| Melinda's 2×2×2×2 | `melindas2x2x2x2` |
| Tri-Quad | `tri_quad` |
| Loopover | `loopover` |
| 40×40×40 Cube | `40x40x40` |

### Removed events

`randomScrambleForEvent(…)` no longer accepts the Twizzle-only events that belonged to the removed puzzles: `kilominx`, `master_tetraminx`, `redi_cube`, `baby_fto`, `loopover`. Every WCA event plus `fto` still works.

### Other removals

- The vendored solvers for the removed puzzles (`kilosolver.js`, `master_tetraminx-solver.js`, `redi_cube.js`) are deleted.
- The `stress-tests/40x40x40` demo page is deleted, along with its 379 kB solution file.
- Dynamic chunk entry points were renamed (see [Re-chunking](#re-chunking)). This only matters if you were importing internal `puzzles-dynamic-*` paths directly, which is not part of the public API.

`cubing/puzzle-geometry` is deliberately **not** trimmed: its puzzle catalogue is public API and only costs a few kB of strings.

## What this fork adds

- **Square-1 in 3D.** New `Square1_3D` visualization strategy, now the default for `puzzle="square1"`. Upstream always rendered Square-1 flat.
- **Square-1 2D last-layer diagrams.** `visualization="experimental-2D-LL"` on `square1`, with `OLL` and `PLL` stickerings.
- **Better 2D Square-1 rendering.** Piece separator support in the SVG renderer: outlines between two halves of a piece hide and reappear as pieces join and split.
- **5×5×5 2D last-layer diagrams.** `visualization="experimental-2D-LL"` on `5x5x5`, with a cached SVG built from reusable `<use>` elements.
- **`L2E` stickering.** Last two edges, for `4x4x4`, `5x5x5` and `6x6x6`, under the Reduction group.

## Size improvements

A snapshot, not a live claim: each entry point bundled with `esbuild` (minified, ESM, `three` external), measured 2026-08-26 against upstream `3efce156`. Expect drift as the fork moves.

| Entry point | Upstream | This fork | Change |
| --- | --- | --- | --- |
| `cubing/puzzles` | 397 kB · 75 kB gzip | **322 kB · 62 kB gzip** | -19% · -17% gzip |
| `cubing/twisty` | 554 kB · 122 kB gzip | **479 kB · 109 kB gzip** | -14% · -11% gzip |
| `cubing/search` | 1251 kB · 351 kB gzip | **1152 kB · 329 kB gzip** | -8% · -6% gzip |
| `cubing/scramble` | 1249 kB · 350 kB gzip | **1151 kB · 329 kB gzip** | -8% · -6% gzip |

### Re-chunking

Upstream bundles several puzzles into a single lazily-loaded chunk. Displaying a 2×2×2 in 2D therefore also downloads the Clock and Square-1 artwork. This fork splits those chunks one-per-puzzle, following the per-puzzle convention the cube chunks already used.

| Upstream chunk | This fork |
| --- | --- |
| `puzzles-dynamic-side-events` (123 kB)<br>2×2×2 + Clock + Pyraminx + Square-1 | `puzzles-dynamic-2x2x2` 7 kB<br>`puzzles-dynamic-clock` 48 kB<br>`puzzles-dynamic-pyraminx` 5 kB<br>`puzzles-dynamic-square1` 62 kB |
| `puzzles-dynamic-unofficial` (44 kB)<br>FTO + Baby FTO + Kilominx + Loopover + Redi Cube | `puzzles-dynamic-fto` 11 kB |
| `search-dynamic-sgs-side-events` (33 kB)<br>2×2×2 + Megaminx + Pyraminx + Skewb | `search-dynamic-sgs-2x2x2` 1 kB<br>`search-dynamic-sgs-megaminx` 28 kB<br>`search-dynamic-sgs-pyraminx` 1 kB<br>`search-dynamic-sgs-skewb` 2 kB |

### What a browser actually downloads

Everything is lazily loaded, so the numbers that matter are per-scenario, not per-package. Gzipped, `three.js` excluded:

| Scenario | Download |
| --- | --- |
| `cubing/scramble` imported, nothing generated yet | 41 kB |
| First 3×3×3 or 4×4×4 scramble | 66 kB |
| Any other event (pulls the WASM scramble engine) | 376 kB |
| `cubing/twisty` initial load | 86 kB |
| `cubing/twisty` with 3D and every puzzle | 162 kB + `three.js` |

### Known remaining weight

Two items dominate what is left, and neither is about the puzzle list:

- **The WASM scramble engine, 209 kB gzip.** It is base64-inlined into a `.js` file, which inflates the binary by 33% and compresses worse than the binary would. Shipping it as a real `.wasm` asset would bring it to 152 kB gzip. Upstream disabled that path on purpose until bundler support settled, so re-enabling it is a packaging decision rather than a code one.
- **`three.js`, 134 kB gzip.** Only downloaded when the player renders in 3D. Setting `visualization="2D"` avoids it entirely. The `three` imports inside `cubing/twisty` are all `import type`, so there is nothing left to tree-shake there.
