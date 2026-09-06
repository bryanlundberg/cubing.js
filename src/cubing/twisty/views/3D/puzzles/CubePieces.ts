import { BufferAttribute } from "three/src/core/BufferAttribute.js";
import { BufferGeometry } from "three/src/core/BufferGeometry.js";
import { Matrix4 } from "three/src/math/Matrix4.js";
import { Vector3 } from "three/src/math/Vector3.js";
import type { StickerDat } from "../../../../puzzle-geometry";
import { beveledCubieGeometry } from "./BeveledCubieGeometry";
import {
  cubeFaceStyles,
  cubieBodyDimensions,
  cubieBodyHalfExtent,
} from "./CubieStyle";
import type { VertexRange } from "./SolidPieceGeometry";
import {
  BODY_MATERIAL_INDEX,
  type FaceletPlan,
  HINT_FACELET_ELEVATION,
  HINT_FACELET_SCALE,
  HINT_MATERIAL_INDEX,
  type PiecePlan,
  type PuzzlePlan,
  paintInternal,
} from "./StickerlessPlan";

/**
 * The pieces of an N×N×N cube, cut the way `Cube3D` cuts the 3×3×3's.
 *
 * `Cube3D` knows the 3×3×3 by heart: it has a hand-written table of the 26
 * pieces and where their stickers go. There is no such table for the 4×4×4 and
 * up, so this reads the puzzle back out of the `StickerDat` that
 * `PuzzleGeometry` already produces for `PG3D` — which is a plain grid of
 * squares once the puzzle is a cube — and rebuilds the pieces from it.
 */

const PG_SCALE = 0.5; // Matches `PG3D`, so that the camera framing carries over.

const FACE_COUNT = 6;

/** One cell of the puzzle: which faces of it point out, and where it sits. */
interface CubieLayout {
  orbit: string;
  ord: number;
  center: Vector3;
  /** Indices into `cubeFaceStyles`, ascending. */
  outwardFaces: number[];
  stickers: { faceIdx: number; ori: number; isDup: boolean }[];
}

interface CubeLayout {
  layers: number;
  /** Half-width of the puzzle, in the `StickerDat`'s coordinates. */
  halfExtent: number;
  cubies: CubieLayout[];
}

function faceIdxForNormal(x: number, y: number, z: number): number {
  for (let faceIdx = 0; faceIdx < FACE_COUNT; faceIdx++) {
    const { vector } = cubeFaceStyles[faceIdx];
    if (vector.x * x + vector.y * y + vector.z * z > 0.5) {
      return faceIdx;
    }
  }
  return -1;
}

/**
 * Reads an N×N×N cube back out of a `StickerDat`, or returns `null` for any
 * puzzle that is not one.
 *
 * The test is deliberately strict — every sticker has to be a square of exactly
 * one cell, flat against an axis-aligned face, sitting on the grid — because
 * passing something else through would produce a plausible-looking but wrong
 * puzzle rather than an error.
 */
export function cubeLayout(stickerDat: StickerDat): CubeLayout | null {
  const { stickers } = stickerDat;
  if (stickerDat.faces.length !== FACE_COUNT || stickers.length === 0) {
    return null;
  }
  // A piece whose orientation the puzzle tracks but whose facelets are all one
  // square — a face center of an odd cube — comes with one sticker per
  // orientation, stacked in the same place and all but one marked as a
  // duplicate. Only the real ones tile the puzzle.
  let faceletCount = 0;
  let halfExtent = 0;
  for (const sticker of stickers) {
    if (sticker.coords.length !== 12) {
      return null;
    }
    if (!sticker.isDup) {
      faceletCount++;
    }
    for (const coord of sticker.coords) {
      halfExtent = Math.max(halfExtent, Math.abs(coord));
    }
  }
  const layers = Math.round(Math.sqrt(faceletCount / FACE_COUNT));
  if (FACE_COUNT * layers * layers !== faceletCount || layers < 2) {
    return null;
  }
  const slotWidth = (2 * halfExtent) / layers;
  const epsilon = slotWidth / 1000;

  // A facelet takes its color from the face it started on rather than from the
  // `StickerDat`, so that every cube in the app is painted from the one scheme
  // in `CubieStyle`. That substitution is only honest for a puzzle whose faces
  // are each a single solid color, so check that before claiming this one.
  const faceColors: (string | undefined)[] = new Array(FACE_COUNT);

  const cubiesByPiece = new Map<string, CubieLayout>();
  const cubies: CubieLayout[] = [];
  const centroid = [0, 0, 0];
  for (const sticker of stickers) {
    const { coords } = sticker;
    for (let axis = 0; axis < 3; axis++) {
      centroid[axis] =
        (coords[axis] +
          coords[axis + 3] +
          coords[axis + 6] +
          coords[axis + 9]) /
        4;
    }
    // The axis the sticker faces is the only one that can reach the outside of
    // the puzzle; the other two stay within the outermost slot's center.
    let normalAxis = 0;
    for (let axis = 1; axis < 3; axis++) {
      if (Math.abs(centroid[axis]) > Math.abs(centroid[normalAxis])) {
        normalAxis = axis;
      }
    }
    const outward = Math.sign(centroid[normalAxis]);
    const center = new Vector3();
    for (let axis = 0; axis < 3; axis++) {
      let expected: number;
      if (axis === normalAxis) {
        expected = outward * halfExtent;
        center.setComponent(axis, outward * (halfExtent - slotWidth / 2));
      } else {
        // Snap to the nearest slot center, then check we were already there.
        const slot = Math.round(
          (centroid[axis] + halfExtent) / slotWidth - 0.5,
        );
        if (slot < 0 || slot >= layers) {
          return null;
        }
        expected = -halfExtent + (slot + 0.5) * slotWidth;
        center.setComponent(axis, expected);
      }
      if (Math.abs(centroid[axis] - expected) > epsilon) {
        return null;
      }
      // A square of exactly one slot: two corners on either side of the center
      // along each in-plane axis, and all four flat against the face.
      const halfSpan = axis === normalAxis ? 0 : slotWidth / 2;
      for (let vertex = 0; vertex < 4; vertex++) {
        const offset = Math.abs(coords[3 * vertex + axis] - expected);
        if (Math.abs(offset - halfSpan) > epsilon) {
          return null;
        }
      }
    }
    const faceIdx = faceIdxForNormal(
      normalAxis === 0 ? outward : 0,
      normalAxis === 1 ? outward : 0,
      normalAxis === 2 ? outward : 0,
    );
    if (faceIdx === -1) {
      return null;
    }
    faceColors[faceIdx] ??= sticker.color;
    if (faceColors[faceIdx] !== sticker.color) {
      return null;
    }

    const pieceKey = `${sticker.orbit}/${sticker.ord}`;
    let cubie = cubiesByPiece.get(pieceKey);
    if (!cubie) {
      cubie = {
        orbit: sticker.orbit,
        ord: sticker.ord,
        center,
        outwardFaces: [],
        stickers: [],
      };
      cubiesByPiece.set(pieceKey, cubie);
      cubies.push(cubie);
    } else if (cubie.center.distanceTo(center) > epsilon) {
      // Two stickers of one piece that don't sit on the same cell: not a cube
      // whose pieces are single cells.
      return null;
    }
    if (!cubie.outwardFaces.includes(faceIdx)) {
      cubie.outwardFaces.push(faceIdx);
      cubie.outwardFaces.sort((a, b) => a - b);
    }
    cubie.stickers.push({ faceIdx, ori: sticker.ori, isDup: !!sticker.isDup });
  }
  if (new Set(faceColors).size !== FACE_COUNT) {
    return null;
  }
  return { layers, halfExtent, cubies };
}

/**
 * The geometry of one shape of piece: a beveled body with a color per face,
 * plus a hint facelet floating off each face that points out of the puzzle.
 *
 * Every piece with the same faces pointing out is the same shape, so a whole
 * puzzle only ever needs the 26 of these that a cube has room for, and they can
 * share their vertices — each cubie's mesh carries nothing of its own but the
 * colors.
 */
interface CubieShape {
  position: BufferAttribute;
  normal: BufferAttribute;
  index: BufferAttribute;
  vertexCount: number;
  bodyIndexCount: number;
  hintIndexCount: number;
  /** Vertex range of each face of the body, indexed like `cubeFaceStyles`. */
  faceVertexRanges: VertexRange[];
  /** Vertex range of the hint facelet of each outward face. */
  hintVertexRanges: Map<number, VertexRange>;
}

function newCubieShape(outwardFaces: number[], slotWidth: number): CubieShape {
  const scale = cubieBodyDimensions.pieceScale * slotWidth;
  const body = beveledCubieGeometry(
    cubeFaceStyles.map((style) => style.vector),
    outwardFaces,
    cubieBodyDimensions.halfWidth * scale,
    cubieBodyDimensions.outerAxisRadius * scale,
    cubieBodyDimensions.innerEdgeRadius * scale,
    cubieBodyDimensions.innerCornerRadius * scale,
    cubieBodyDimensions.cornerSharpness,
    cubieBodyDimensions.roundingSegments,
  );
  const bodyPositions = body.getAttribute("position").array as Float32Array;
  const bodyNormals = body.getAttribute("normal").array as Float32Array;
  const bodyIndices = Array.from(body.getIndex()!.array);

  const faceVertexRanges: VertexRange[] = [];
  for (const group of body.groups) {
    let start = Number.POSITIVE_INFINITY;
    let end = 0;
    for (let i = group.start; i < group.start + group.count; i++) {
      start = Math.min(start, bodyIndices[i]);
      end = Math.max(end, bodyIndices[i] + 1);
    }
    faceVertexRanges[group.materialIndex!] = { start, count: end - start };
  }

  const positions: number[] = Array.from(bodyPositions);
  const normals: number[] = Array.from(bodyNormals);
  const indices: number[] = bodyIndices.slice();
  const hintVertexRanges = new Map<number, VertexRange>();

  const hintHalfWidth = (HINT_FACELET_SCALE * slotWidth) / 2;
  const hintDistance = slotWidth / 2 + HINT_FACELET_ELEVATION;
  const u = new Vector3();
  const v = new Vector3();
  const corner = new Vector3();
  for (const faceIdx of outwardFaces) {
    const normal = cubeFaceStyles[faceIdx].vector;
    // The same perpendicular pair `beveledCubieGeometry` picks, so that the
    // quad below winds counter-clockwise as seen from outside the puzzle.
    u.set(normal.y, normal.z, normal.x);
    v.crossVectors(normal, u);
    const start = positions.length / 3;
    for (const [su, sv] of [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ]) {
      corner
        .copy(normal)
        .multiplyScalar(hintDistance)
        .addScaledVector(u, su * hintHalfWidth)
        .addScaledVector(v, sv * hintHalfWidth);
      positions.push(corner.x, corner.y, corner.z);
      normals.push(normal.x, normal.y, normal.z);
    }
    indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
    hintVertexRanges.set(faceIdx, { start, count: 4 });
  }

  body.dispose();
  return {
    position: new BufferAttribute(new Float32Array(positions), 3),
    normal: new BufferAttribute(new Float32Array(normals), 3),
    index: new BufferAttribute(new Uint16Array(indices), 1),
    vertexCount: positions.length / 3,
    bodyIndexCount: bodyIndices.length,
    hintIndexCount: indices.length - bodyIndices.length,
    faceVertexRanges,
    hintVertexRanges,
  };
}

function newCubiePiece(cubie: CubieLayout, shape: CubieShape): PiecePlan {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", shape.position);
  geometry.setAttribute("normal", shape.normal);
  geometry.setIndex(shape.index);
  const colors = new BufferAttribute(
    new Uint8Array(4 * shape.vertexCount),
    4,
    true,
  );
  geometry.setAttribute("color", colors);
  geometry.addGroup(0, shape.bodyIndexCount, BODY_MATERIAL_INDEX);
  if (shape.hintIndexCount > 0) {
    geometry.addGroup(
      shape.bodyIndexCount,
      shape.hintIndexCount,
      HINT_MATERIAL_INDEX,
    );
  }
  // Every face starts out as the plastic inside the puzzle; the ones that point
  // out of it are painted over by the first `onPositionChange`.
  paintInternal(colors, shape.faceVertexRanges);

  const facelets: FaceletPlan[] = cubie.stickers.map((sticker) => ({
    ori: sticker.ori,
    faceStyle: sticker.faceIdx,
    // A duplicate shares its square with the real facelet, which is the one
    // that gets painted.
    body: sticker.isDup ? [] : [shape.faceVertexRanges[sticker.faceIdx]],
    hint: sticker.isDup
      ? []
      : [shape.hintVertexRanges.get(sticker.faceIdx)!].filter(Boolean),
  }));
  return {
    orbit: cubie.orbit,
    ord: cubie.ord,
    home: new Matrix4().setPosition(cubie.center),
    geometry,
    colors,
    facelets,
  };
}

/** The plan for an N×N×N cube, or `null` for any puzzle that is not one. */
export function cubePuzzlePlan(stickerDat: StickerDat): PuzzlePlan | null {
  const layout = cubeLayout(stickerDat);
  if (!layout) {
    return null;
  }
  const slotWidth = (2 * layout.halfExtent) / layout.layers;
  const shapes = new Map<string, CubieShape>();
  const pieces = layout.cubies.map((cubie) => {
    const shapeKey = cubie.outwardFaces.join(",");
    let shape = shapes.get(shapeKey);
    if (!shape) {
      shape = newCubieShape(cubie.outwardFaces, slotWidth);
      shapes.set(shapeKey, shape);
    }
    return newCubiePiece(cubie, shape);
  });
  return {
    faceStyles: cubeFaceStyles,
    pieces,
    // Oversized pieces push the puzzle past the half-extent the camera framing
    // assumes, so scale it back to the size `PG3D` would have drawn.
    scale:
      (PG_SCALE * layout.halfExtent) /
      (cubieBodyHalfExtent(layout.layers) * slotWidth),
  };
}
