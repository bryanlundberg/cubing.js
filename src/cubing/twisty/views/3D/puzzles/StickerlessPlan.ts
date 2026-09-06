import type { BufferAttribute } from "three/src/core/BufferAttribute.js";
import type { BufferGeometry } from "three/src/core/BufferGeometry.js";
import type { Matrix4 } from "three/src/math/Matrix4.js";
import type { FaceletMeshStickeringMask } from "../../../../puzzles/stickerings/mask";
import {
  bodyMaskColors,
  type FaceletStyle,
  hintMaskStyles,
} from "./CubieStyle";
import type { VertexRange } from "./SolidPieceGeometry";

/**
 * A puzzle's pieces, cut and colored and ready to be handed to `Stickerless3D`.
 *
 * Splitting this out is what lets one renderer drive both an N×N×N cube, whose
 * pieces are rounded cubies that can share their vertices, and puzzles whose
 * pieces are each their own shape. Everything after the geometry — which piece
 * a move sweeps, which color a slot shows, hint facelets, stickering masks — is
 * the same work either way.
 */

export interface FaceletPlan {
  /** Which facelet of its piece this is, in the `KPuzzle`'s numbering. */
  ori: number;
  /** Index into the plan's `faceStyles`. */
  faceStyle: number;
  /**
   * Vertices showing this facelet's own color. Empty for a facelet that shares
   * its square with another one, where only one of them is drawn.
   */
  body: VertexRange[];
  /** Vertices of its hint facelet. */
  hint: VertexRange[];
}

export interface PiecePlan {
  orbit: string;
  ord: number;
  /** Where the piece sits when nothing is turning. */
  home: Matrix4;
  /** Ready to draw: `position`, `normal` and `color`, with groups added. */
  geometry: BufferGeometry;
  /** The geometry's color attribute, with the plastic inside already painted. */
  colors: BufferAttribute;
  facelets: FaceletPlan[];
}

export interface PuzzlePlan {
  faceStyles: FaceletStyle[];
  pieces: PiecePlan[];
  /** Uniform scale bringing the puzzle to the size the camera expects. */
  scale: number;
}

/** How far a hint facelet floats beyond the surface. Matches `PG3D`. */
export const HINT_FACELET_ELEVATION = 0.5;
/** Width of a hint facelet, as a fraction of a facelet. Matches `Cube3D`. */
export const HINT_FACELET_SCALE = 0.85;

/** Material slots every piece's geometry uses, in order. */
export const BODY_MATERIAL_INDEX = 0;
export const HINT_MATERIAL_INDEX = 1;

export const faceletMeshStickeringMasks: FaceletMeshStickeringMask[] = [
  "regular",
  "dim",
  "oriented",
  "experimentalOriented2",
  "ignored",
  "invisible",
  "mystery",
];

/** The color a facelet's body shows for a given face and stickering mask. */
function bodyColor(
  style: FaceletStyle,
  mask: FaceletMeshStickeringMask,
): number {
  switch (mask) {
    case "regular":
      return style.color;
    case "dim":
      return style.dimColor;
    // A solid piece of plastic can't have a hole punched in it, so an invisible
    // facelet falls back to the internal plastic color.
    case "invisible":
      return bodyMaskColors.internal;
    default:
      return bodyMaskColors[mask];
  }
}

/** The same for its hint facelet, which also carries an opacity. */
function hintColor(
  style: FaceletStyle,
  mask: FaceletMeshStickeringMask,
): { color: number; opacity: number } {
  switch (mask) {
    case "regular":
      return { color: style.hintColor, opacity: 0.5 * style.hintOpacityScale };
    case "dim":
      return {
        color: style.hintDimColor,
        opacity: 0.5 * style.hintOpacityScale,
      };
    case "invisible":
      return { color: 0, opacity: 0 };
    default:
      return hintMaskStyles[mask];
  }
}

/**
 * How a facelet looks: four bytes of body color and four of hint color, ready
 * to be copied into a piece's vertex colors.
 *
 * Keyed by face and mask rather than by facelet, so that the common case of
 * many facelets sharing a look also shares one lookup — and so that a slot can
 * tell whether it is already showing the right thing by comparing keys.
 */
export function faceletAppearanceKey(
  faceStyle: number,
  mask: FaceletMeshStickeringMask,
  hintMask: FaceletMeshStickeringMask,
): number {
  return (
    (faceStyle * faceletMeshStickeringMasks.length +
      faceletMeshStickeringMasks.indexOf(mask)) *
      faceletMeshStickeringMasks.length +
    faceletMeshStickeringMasks.indexOf(hintMask)
  );
}

export function faceletAppearance(
  cache: Map<number, Uint8Array>,
  styles: FaceletStyle[],
  faceStyle: number,
  mask: FaceletMeshStickeringMask,
  hintMask: FaceletMeshStickeringMask,
): Uint8Array {
  const key = faceletAppearanceKey(faceStyle, mask, hintMask);
  const cached = cache.get(key);
  if (cached) {
    return cached;
  }
  const style = styles[faceStyle];
  const body = bodyColor(style, mask);
  const hint = hintColor(style, hintMask);
  // Colors go in as their raw sRGB bytes: the renderer writes linear values
  // straight out (see `RendererPool`), which is the round trip the materials in
  // `CubieStyle` make with `convertLinearToSRGB`.
  const appearance = new Uint8Array([
    (body >> 16) & 0xff,
    (body >> 8) & 0xff,
    body & 0xff,
    0xff,
    (hint.color >> 16) & 0xff,
    (hint.color >> 8) & 0xff,
    hint.color & 0xff,
    Math.round(hint.opacity * 0xff),
  ]);
  cache.set(key, appearance);
  return appearance;
}

/** Paints vertex ranges with one half of an appearance. */
export function writeColor(
  colors: BufferAttribute,
  ranges: VertexRange[],
  appearance: Uint8Array,
  offset: number = 0,
): void {
  const array = colors.array as Uint8Array;
  const red = appearance[offset];
  const green = appearance[offset + 1];
  const blue = appearance[offset + 2];
  const alpha = appearance[offset + 3];
  for (const range of ranges) {
    for (
      let vertex = range.start;
      vertex < range.start + range.count;
      vertex++
    ) {
      array[4 * vertex] = red;
      array[4 * vertex + 1] = green;
      array[4 * vertex + 2] = blue;
      array[4 * vertex + 3] = alpha;
    }
  }
}

/** The plastic inside the puzzle, which never changes color. */
export function paintInternal(
  colors: BufferAttribute,
  ranges: VertexRange[],
): void {
  const internal = bodyMaskColors.internal;
  writeColor(
    colors,
    ranges,
    new Uint8Array([
      (internal >> 16) & 0xff,
      (internal >> 8) & 0xff,
      internal & 0xff,
      0xff,
    ]),
  );
}
