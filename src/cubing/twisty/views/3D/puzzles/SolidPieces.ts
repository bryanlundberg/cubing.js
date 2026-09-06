import { BufferAttribute } from "three/src/core/BufferAttribute.js";
import { BufferGeometry } from "three/src/core/BufferGeometry.js";
import { Color } from "three/src/math/Color.js";
import { Matrix4 } from "three/src/math/Matrix4.js";
import { Vector3 } from "three/src/math/Vector3.js";
import type {
  StickerDat,
  StickerDatSticker,
} from "../../../../puzzle-geometry";
import { cubeFaceStyles, type FaceletStyle } from "./CubieStyle";
import {
  type PiecePlane,
  SOLID_PIECE_CHAMFER,
  SOLID_PIECE_GROOVE,
  solidPieceGeometry,
  type VertexRange,
} from "./SolidPieceGeometry";
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
 * The pieces of a puzzle whose cuts all pass through its center — a skewb, say
 * — read off the stickers `PuzzleGeometry` produces.
 *
 * A piece is bounded by the faces of the puzzle its stickers sit on, and by the
 * cuts separating it from its neighbors. Both are recoverable: the faces are
 * the sticker planes, and each cut shows up on the surface as an edge between
 * two stickers of different pieces. Taking the plane through such an edge and
 * the puzzle's center gives the cut back exactly for a deep-cut puzzle, and for
 * any other one gives a piece that is right everywhere it can be seen and only
 * runs too deep inside, where it is hidden.
 *
 * `CubePieces` handles the N×N×N cubes instead, whose cuts do *not* pass
 * through the center and whose pieces are worth rounding properly.
 */

const PG_SCALE = 0.5; // Matches `PG3D`, so that the camera framing carries over.

const EPSILON = 1e-6;

function vertexAt(sticker: StickerDatSticker, index: number): Vector3 {
  return new Vector3(
    sticker.coords[3 * index],
    sticker.coords[3 * index + 1],
    sticker.coords[3 * index + 2],
  );
}

function polygonOf(sticker: StickerDatSticker): Vector3[] {
  const vertices: Vector3[] = [];
  for (let i = 0; i < sticker.coords.length / 3; i++) {
    vertices.push(vertexAt(sticker, i));
  }
  return vertices;
}

/** The outward unit normal of a sticker on a puzzle centered at the origin. */
function outwardNormal(polygon: Vector3[]): Vector3 | null {
  const normal = new Vector3().crossVectors(
    new Vector3().subVectors(polygon[1], polygon[0]),
    new Vector3().subVectors(polygon[2], polygon[0]),
  );
  if (normal.length() < EPSILON) {
    return null;
  }
  normal.normalize();
  return normal.dot(polygon[0]) < 0 ? normal.negate() : normal;
}

function keyOf(vertex: Vector3, quantum: number): string {
  return `${Math.round(vertex.x / quantum)},${Math.round(vertex.y / quantum)},${Math.round(vertex.z / quantum)}`;
}

interface PieceStickers {
  orbit: string;
  ord: number;
  stickers: { sticker: StickerDatSticker; polygon: Vector3[] }[];
  duplicates: StickerDatSticker[];
}

/**
 * How each face of the puzzle is colored.
 *
 * A puzzle shaped like a cube borrows the scheme every other cube in the app is
 * painted from, so that a skewb and a 3×3×3 side by side are the same plastic.
 * Anything else keeps the colors `PuzzleGeometry` gave it, dimmed the way
 * `PG3D` dims them.
 */
function faceStyles(
  faceNormals: (Vector3 | null)[],
  faceColors: (string | undefined)[],
): FaceletStyle[] | null {
  const styles: FaceletStyle[] = [];
  const cubeFaces: number[] = [];
  for (let face = 0; face < faceNormals.length; face++) {
    const normal = faceNormals[face];
    const color = faceColors[face];
    if (!normal || color === undefined) {
      return null;
    }
    cubeFaces.push(
      cubeFaceStyles.findIndex((style) => style.vector.dot(normal) > 0.999),
    );
  }
  const isCube =
    faceNormals.length === cubeFaceStyles.length &&
    new Set(cubeFaces).size === cubeFaceStyles.length &&
    !cubeFaces.includes(-1) &&
    new Set(faceColors).size === faceColors.length;
  for (let face = 0; face < faceNormals.length; face++) {
    if (isCube) {
      styles.push(cubeFaceStyles[cubeFaces[face]]);
      continue;
    }
    const color = new Color(faceColors[face]).getHex();
    const dimColor = new Color(color).multiplyScalar(0.5).getHex();
    styles.push({
      color,
      dimColor,
      hintColor: color,
      hintDimColor: dimColor,
      hintOpacityScale: 1,
    });
  }
  return styles;
}

/** The hint facelet of one sticker: its own outline, floating beyond it. */
function hintPolygon(polygon: Vector3[], normal: Vector3): Vector3[] {
  const centroid = new Vector3();
  for (const vertex of polygon) {
    centroid.addScaledVector(vertex, 1 / polygon.length);
  }
  return polygon.map((vertex) =>
    centroid
      .clone()
      .addScaledVector(
        new Vector3().subVectors(vertex, centroid),
        HINT_FACELET_SCALE,
      )
      .addScaledVector(normal, HINT_FACELET_ELEVATION),
  );
}

/**
 * The plan for a puzzle whose pieces can be cut out of its stickers this way,
 * or `null` for one where they can't — which falls back to `PG3D`.
 */
export function solidPuzzlePlan(stickerDat: StickerDat): PuzzlePlan | null {
  const { stickers } = stickerDat;
  if (stickers.length === 0 || stickerDat.faces.length === 0) {
    return null;
  }

  let radius = 0;
  for (const sticker of stickers) {
    if (sticker.coords.length < 9 || sticker.coords.length % 3 !== 0) {
      return null;
    }
    for (let i = 0; i < sticker.coords.length; i += 3) {
      radius = Math.max(
        radius,
        Math.hypot(
          sticker.coords[i],
          sticker.coords[i + 1],
          sticker.coords[i + 2],
        ),
      );
    }
  }
  const quantum = radius * 1e-5;

  const faceNormals: (Vector3 | null)[] = new Array(stickerDat.faces.length);
  const faceColors: (string | undefined)[] = new Array(stickerDat.faces.length);
  const pieces = new Map<string, PieceStickers>();
  const order: PieceStickers[] = [];
  // Which pieces meet along each edge of the surface.
  const edges = new Map<string, Set<string>>();
  let faceDistance = 0;

  for (const sticker of stickers) {
    const pieceKey = `${sticker.orbit}/${sticker.ord}`;
    let piece = pieces.get(pieceKey);
    if (!piece) {
      piece = {
        orbit: sticker.orbit,
        ord: sticker.ord,
        stickers: [],
        duplicates: [],
      };
      pieces.set(pieceKey, piece);
      order.push(piece);
    }
    // A duplicate is stacked on top of a real sticker; only the real one is
    // part of the surface.
    if (sticker.isDup) {
      piece.duplicates.push(sticker);
      continue;
    }
    const polygon = polygonOf(sticker);
    const normal = outwardNormal(polygon);
    if (!normal) {
      return null;
    }
    for (const vertex of polygon) {
      if (Math.abs(vertex.dot(normal) - polygon[0].dot(normal)) > quantum) {
        return null; // Not flat.
      }
    }
    const distance = polygon[0].dot(normal);
    faceDistance = faceDistance || distance;
    if (faceNormals[sticker.face]) {
      if (faceNormals[sticker.face]!.dot(normal) < 0.999) {
        return null; // One face, two planes.
      }
    } else {
      faceNormals[sticker.face] = normal;
    }
    faceColors[sticker.face] ??= sticker.color;
    if (faceColors[sticker.face] !== sticker.color) {
      return null;
    }
    piece.stickers.push({ sticker, polygon });

    for (let i = 0; i < polygon.length; i++) {
      const edgeKey = [
        keyOf(polygon[i], quantum),
        keyOf(polygon[(i + 1) % polygon.length], quantum),
      ]
        .sort()
        .join("|");
      const sharing = edges.get(edgeKey);
      if (sharing) {
        sharing.add(pieceKey);
      } else {
        edges.set(edgeKey, new Set([pieceKey]));
      }
    }
  }

  const styles = faceStyles(faceNormals, faceColors);
  if (!styles) {
    return null;
  }

  const axes = stickerDat.axis.map((axis) =>
    new Vector3(...axis.coordinates).normalize(),
  );
  const plans: PiecePlan[] = [];
  for (const piece of order) {
    const plan = newSolidPiece(piece, edges, axes, {
      quantum,
      radius,
      faceDistance,
    });
    if (!plan) {
      return null;
    }
    plans.push(plan);
  }
  return { faceStyles: styles, pieces: plans, scale: PG_SCALE };
}

function newSolidPiece(
  piece: PieceStickers,
  edges: Map<string, Set<string>>,
  axes: Vector3[],
  sizes: { quantum: number; radius: number; faceDistance: number },
): PiecePlan | null {
  if (piece.stickers.length === 0) {
    return null;
  }
  const pieceKey = `${piece.orbit}/${piece.ord}`;
  const planes: PiecePlane[] = [];
  // Which plane each sticker's face became, so its facelet can be painted.
  const planeOfSticker = new Map<StickerDatSticker, number>();

  const interior = new Vector3();
  for (const { polygon } of piece.stickers) {
    for (const vertex of polygon) {
      interior.addScaledVector(
        vertex,
        0.5 / polygon.length / piece.stickers.length,
      );
    }
  }

  for (const { sticker, polygon } of piece.stickers) {
    const normal = outwardNormal(polygon)!;
    planeOfSticker.set(sticker, planes.length);
    planes.push({
      normal,
      offset: polygon[0].dot(normal),
      color: sticker.face,
    });
  }

  for (const { polygon } of piece.stickers) {
    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[i];
      const b = polygon[(i + 1) % polygon.length];
      const edgeKey = [keyOf(a, sizes.quantum), keyOf(b, sizes.quantum)]
        .sort()
        .join("|");
      const sharing = edges.get(edgeKey);
      // An edge the piece keeps to itself is a fold in one piece of plastic,
      // not a cut: it stays sharp, and no plane belongs to it.
      if (sharing && sharing.size === 1 && sharing.has(pieceKey)) {
        continue;
      }
      const normal = new Vector3().crossVectors(a, b);
      if (normal.length() < sizes.quantum) {
        return null; // The cut would have to pass through the puzzle's center.
      }
      normal.normalize();
      if (normal.dot(interior) > 0) {
        normal.negate();
      }
      // The cut plane through this edge and the puzzle's center. On a puzzle
      // whose cuts don't run through its center this is the wrong plane, and it
      // gives itself away twice over: it doesn't face along an axis the puzzle
      // turns about, and it can slice through the piece's own stickers. Check
      // both, and hand the whole puzzle back to `PG3D` when either fails.
      if (!axes.some((axis) => Math.abs(axis.dot(normal)) > 0.9999)) {
        return null;
      }
      for (const other of piece.stickers) {
        for (const vertex of other.polygon) {
          if (vertex.dot(normal) > sizes.quantum) {
            return null;
          }
        }
      }
      if (
        planes.some(
          (plane) =>
            plane.color === null &&
            plane.normal.dot(normal) > 0.9999 &&
            Math.abs(plane.offset) < sizes.quantum,
        )
      ) {
        continue;
      }
      planes.push({ normal, offset: 0, color: null });
    }
  }

  const solid = solidPieceGeometry(planes, {
    groove: SOLID_PIECE_GROOVE * sizes.faceDistance,
    chamfer: SOLID_PIECE_CHAMFER * sizes.faceDistance,
    radius: sizes.radius,
  });
  if (!solid) {
    return null;
  }

  // The hint facelets go after the body, so that each is one contiguous group.
  const positions = Array.from(solid.positions);
  const normals = Array.from(solid.normals);
  const hintRanges = new Map<StickerDatSticker, VertexRange>();
  for (const { sticker, polygon } of piece.stickers) {
    const normal = outwardNormal(polygon)!;
    const hint = hintPolygon(polygon, normal);
    const start = positions.length / 3;
    for (let i = 1; i < hint.length - 1; i++) {
      for (const vertex of [hint[0], hint[i], hint[i + 1]]) {
        positions.push(vertex.x, vertex.y, vertex.z);
        normals.push(normal.x, normal.y, normal.z);
      }
    }
    hintRanges.set(sticker, {
      start,
      count: positions.length / 3 - start,
    });
  }

  const vertexCount = positions.length / 3;
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    "position",
    new BufferAttribute(new Float32Array(positions), 3),
  );
  geometry.setAttribute(
    "normal",
    new BufferAttribute(new Float32Array(normals), 3),
  );
  const colors = new BufferAttribute(new Uint8Array(4 * vertexCount), 4, true);
  geometry.setAttribute("color", colors);
  geometry.addGroup(0, solid.vertexCount, BODY_MATERIAL_INDEX);
  if (vertexCount > solid.vertexCount) {
    geometry.addGroup(
      solid.vertexCount,
      vertexCount - solid.vertexCount,
      HINT_MATERIAL_INDEX,
    );
  }
  paintInternal(colors, solid.internalRanges);

  const facelets: FaceletPlan[] = piece.stickers.map(({ sticker }) => ({
    ori: sticker.ori,
    faceStyle: sticker.face,
    body: solid.ranges[planeOfSticker.get(sticker)!],
    hint: [hintRanges.get(sticker)!],
  }));
  for (const sticker of piece.duplicates) {
    facelets.push({
      ori: sticker.ori,
      faceStyle: sticker.face,
      body: [],
      hint: [],
    });
  }

  return {
    orbit: piece.orbit,
    ord: piece.ord,
    // The geometry is already where the piece belongs.
    home: new Matrix4(),
    geometry,
    colors,
    facelets,
  };
}
