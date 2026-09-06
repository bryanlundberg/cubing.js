<img src="cubing.js.png" alt="cubing.js" width="512">

# `cubing.js` lightweight fork

A **lightweight fork of [`cubing.js`](https://github.com/cubing/cubing.js)**: fewer puzzles, smaller lazily-loaded chunks, and some extra visualization features.

The API surface, the module layout and the build system are unchanged from upstream, so this is a drop-in replacement for `cubing` as long as you only use the puzzles listed below.

- Upstream project: <https://github.com/cubing/cubing.js>
- Upstream documentation: <https://js.cubing.net/cubing/>

## Install

```bash
npm install @rednaxela101/cubing
```

<details>
<summary>Other package managers</summary>

```bash
pnpm add @rednaxela101/cubing
```

```bash
yarn add @rednaxela101/cubing
```

```bash
bun add @rednaxela101/cubing
```

</details>

Imports keep the upstream module layout, so only the package name changes:

```js
import { TwistyPlayer } from "@rednaxela101/cubing/twisty";
import { randomScrambleForEvent } from "@rednaxela101/cubing/scramble";
```

## Supported puzzles

`3x3x3`, `2x2x2`, `4x4x4`, `5x5x5`, `6x6x6`, `7x7x7`, `square1`, `pyraminx`, `megaminx`, `clock`, `skewb`, `fto`.

Every WCA event is supported (`222`, `333`, `444`, `555`, `666`, `777`, `333bf`, `333fm`, `333oh`, `333mbf`, `444bf`, `555bf`, `clock`, `minx`, `pyram`, `skewb`, `sq1`), plus `fto`.

## What this fork adds

- **Stickerless 3D models.** Every 3D puzzle is drawn as solid pieces of colored plastic, lit. Upstream draws flat stickers on a black body.
  - New 3×3×3 pieces: beveled cubies with flat facelets and rounded outlines.
  - 2×2×2 and 4×4×4 through 7×7×7 use the same pieces, cut to size.
  - Square-1, Skewb, Megaminx, Pyraminx and FTO are solid pieces too, with a thin groove between them and a hairline bevel. Their pieces are cut from the puzzle's own faces and turning axes.
  - No puzzle this fork ships is drawn with upstream's `PG3D` any more. It stays as the fallback for anything the piece geometry can't be recovered for.
- **Square-1 in 3D.** New `Square1_3D` visualization strategy, the default for `puzzle="square1"`. Upstream renders Square-1 flat.
- **Square-1 2D last-layer diagrams.** `visualization="experimental-2D-LL"` on `square1`, with `OLL` and `PLL` stickerings.
- **Piece separators in the 2D renderer.** Outlines between two halves of a piece hide and reappear as pieces join and split, for Square-1.
- **5×5×5 2D last-layer diagrams.** `visualization="experimental-2D-LL"` on `5x5x5`.
- **Megaminx 2D last-layer diagrams.** `visualization="experimental-2D-LL"` on `megaminx`. Upstream has no last-layer view for Megaminx.
- **Four more Megaminx last-layer stickerings.** `OLL-EO` (last-layer center and edges), `OLL-CO` (last-layer center and corners), `PLL-EO` (side stickers of the last-layer edges), `PLL-CP` (side stickers of the last-layer corners).
- **Megaminx `PLL` read off the side stickers.** The last-layer face is blanked out. Upstream dims it to a near-white grey.
- **A face-color border for 2D last-layer diagrams.** A ring outside the puzzle outline, colored with the face each side belongs to. Controlled by `experimental-face-color-border` / `experimentalFaceColorBorder` (`auto` by default, `none` to hide). Drawn by the Megaminx last-layer SVG; any 2D SVG can opt in.
- **Palette-agnostic dimming in the 2D renderer.** Colors outside upstream's per-face table are darkened programmatically instead of dimming to `undefined`, which painted the facelet black.
- **`L2E` stickering.** Last two edges, for `4x4x4`, `5x5x5` and `6x6x6`, under the Reduction group.

## Rendering performance (caching)

Several per-frame code paths in `cubing/twisty` were doing work that could be skipped. Measured on Chromium as the cost of one `onPositionChange(…)` call with a move in progress (minimum of 7 rounds of 3000 calls), 2026-08-27, before the stickerless renderers landed. The renderer column is what each side ran at the time.

| Puzzle | Renderer | Upstream | This fork | Change |
| --- | --- | --- | --- | --- |
| 3×3×3 | `Cube3D` | 11.17 µs | **3.87 µs** | -65% |
| 7×7×7 | `PG3D` | 4.13 µs | **2.27 µs** | -45% |
| 5×5×5 | `PG3D` | 2.63 µs | **2.00 µs** | -24% |
| Megaminx | `PG3D` | 2.80 µs | **2.20 µs** | -21% |
| FTO | `PG3D` | 1.93 µs | **1.70 µs** | -12% |
| 2×2×2 | `PG3D` | 1.40 µs | **1.27 µs** | -9% |

A 3×3×3 player drops from roughly 0.67 ms to 0.23 ms of main-thread time per second of animation.

## Size improvements

A snapshot, not a live claim: each entry point bundled with `esbuild` (minified, ESM, `three` external), measured 2026-08-26 against upstream `3efce156`. Expect drift as the fork moves.

| Entry point | Upstream | This fork | Change |
| --- | --- | --- | --- |
| `cubing/puzzles` | 397 kB · 75 kB gzip | **322 kB · 62 kB gzip** | -19% · -17% gzip |
| `cubing/twisty` | 554 kB · 122 kB gzip | **479 kB · 109 kB gzip** | -14% · -11% gzip |
| `cubing/search` | 1251 kB · 351 kB gzip | **1152 kB · 329 kB gzip** | -8% · -6% gzip |
| `cubing/scramble` | 1249 kB · 350 kB gzip | **1151 kB · 329 kB gzip** | -8% · -6% gzip |

### Re-chunking

Upstream bundles several puzzles into one lazily-loaded chunk, so displaying a 2×2×2 in 2D also downloads the Clock and Square-1 artwork. This fork splits those chunks one-per-puzzle.

### Everything is lazily loaded

Per scenario, gzipped, `three.js` excluded:

| Scenario | Download |
| --- | --- |
| `cubing/scramble` imported, nothing generated yet | 41 kB |
| First 3×3×3 or 4×4×4 scramble | 66 kB |
| Any other event (pulls the WASM scramble engine) | 376 kB |
| `cubing/twisty` initial load | 86 kB |
| `cubing/twisty` with 3D and every puzzle | 162 kB + `three.js` |
