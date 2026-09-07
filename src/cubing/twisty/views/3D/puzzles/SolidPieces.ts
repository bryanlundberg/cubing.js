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
import { type FaceletSurface, logoSurface } from "./PuzzleLogo";
import {
  type PiecePlane,
  SOLID_PIECE_CHAMFER,
  SOLID_PIECE_GROOVE,
  solidPieceGeometry,
  type VertexRange,
} from "./SolidPieceGeometry";
import {
  type FaceletPlan,
  HINT_FACELET_ELEVATION,
  HINT_FACELET_SCALE,
  type PieceMesh,
  type PiecePlan,
  type PuzzlePlan,
  paintInternal,
} from "./StickerlessPlan";

/**
 * The pieces of a puzzle, read off the stickers `PuzzleGeometry` produces.
 *
 * A piece is bounded by the faces of the puzzle its stickers sit on, and by the
 * cuts separating it from its neighbors. Both are recoverable from the surface:
 * the faces are the sticker planes, and every cut shows up as an edge between
 * two stickers of different pieces, lying square to an axis the puzzle turns
 * about. Recovering the cuts is most of the work, since an edge fits several
 * axes and only one of them is the cut it lies on.
 *
 * `CubePieces` gets first refusal on the N×N×N cubes, whose pieces are all the
 * same shape and worth rounding properly.
 */

const PG_SCALE = 0.5; // Matches `PG3D`, so that the camera framing carries over.

const EPSILON = 1e-6;

/** How far a logo floats off the face it is printed on, in feature widths. */
const LOGO_ELEVATION = 0.01;

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
  let faceletArea = 0;
  let faceletCount = 0;
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
    faceletCount++;
    for (let i = 1; i < polygon.length - 1; i++) {
      faceletArea +=
        new Vector3()
          .subVectors(polygon[i], polygon[0])
          .cross(new Vector3().subVectors(polygon[i + 1], polygon[0]))
          .length() / 2;
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
  // A groove is a gap in the plastic, so it goes by the size of the puzzle. On
  // a puzzle whose facelets are small that would swamp them, so it goes by the
  // size of a facelet too, whichever comes out narrower. The two agree on a
  // 3×3×3, whose half-width is one and a half facelets.
  const featureScale = Math.min(
    faceDistance,
    1.5 * Math.sqrt(faceletArea / faceletCount),
  );

  const cuts = cutPlanes(
    order,
    edges,
    stickerDat.axis.map((axis) => new Vector3(...axis.coordinates).normalize()),
    quantum,
  );
  if (!cuts) {
    return null;
  }
  const plans: PiecePlan[] = [];
  for (const piece of order) {
    const plan = newSolidPiece(
      piece,
      { planes: cuts, edges },
      {
        quantum,
        radius,
        featureScale,
      },
    );
    if (!plan) {
      return null;
    }
    plans.push(plan);
  }
  return { faceStyles: styles, pieces: plans, scale: PG_SCALE };
}

/**
 * Every cut of the puzzle, recovered from the surface.
 *
 * A cut shows up as an edge between two stickers of different pieces, and it
 * faces along an axis the puzzle turns about, so each such edge nominates the
 * axes it lies square to. Several axes fit any one edge, and the way to tell
 * the real cut from the rest is that a cut never crosses a piece: it is a plane
 * the whole puzzle is cut along, not just a plane that happens to slip between
 * these two pieces. Anything some piece straddles is dropped.
 *
 * Returns `null` when an edge is left with no cut to lie on, which means this
 * isn't a puzzle whose pieces can be recovered this way.
 */
interface Cut {
  normal: Vector3;
  offset: number;
  /** How many edges of the surface lie in it. */
  uses: number;
}

function cutPlanes(
  pieces: PieceStickers[],
  edges: Map<string, Set<string>>,
  axes: Vector3[],
  quantum: number,
): Cut[] | null {
  const candidates = new Map<string, Cut>();
  const boundaryEdges: [Vector3, Vector3][] = [];
  for (const piece of pieces) {
    const pieceKey = `${piece.orbit}/${piece.ord}`;
    for (const { polygon } of piece.stickers) {
      for (let i = 0; i < polygon.length; i++) {
        const a = polygon[i];
        const b = polygon[(i + 1) % polygon.length];
        const sharing = edges.get(
          [keyOf(a, quantum), keyOf(b, quantum)].sort().join("|"),
        );
        // An edge the piece keeps to itself is a fold in one piece of plastic,
        // not a cut.
        if (!sharing || ![...sharing].some((key) => key !== pieceKey)) {
          continue;
        }
        boundaryEdges.push([a, b]);
        for (const axis of axes) {
          if (Math.abs(a.dot(axis) - b.dot(axis)) > quantum) {
            continue;
          }
          // One entry per plane, however many edges nominate it.
          const offset = a.dot(axis);
          const key = `${keyOf(axis, 1e-4)}|${Math.round(offset / quantum)}`;
          const candidate = candidates.get(key);
          if (candidate) {
            candidate.uses++;
          } else {
            candidates.set(key, { normal: axis, offset, uses: 1 });
          }
        }
      }
    }
  }

  // A cut of the puzzle runs the whole way across it, so it holds many of the
  // edges it could hold. A plane that merely grazes a corner holds a handful,
  // and picking by this is what tells the two apart where geometry cannot.
  const cuts = [...candidates.values()].sort((a, b) => b.uses - a.uses);
  const kept = cuts.filter(({ normal, offset }) => {
    for (const piece of pieces) {
      let above = false;
      let below = false;
      for (const { polygon } of piece.stickers) {
        let onIt = true;
        for (const vertex of polygon) {
          above ||= vertex.dot(normal) > offset + quantum;
          below ||= vertex.dot(normal) < offset - quantum;
          onIt &&= Math.abs(vertex.dot(normal) - offset) <= quantum;
        }
        // A plane holding a whole sticker is the puzzle's own surface, not a
        // cut. Letting it through would cut every piece back from its face.
        if (onIt) {
          return false;
        }
      }
      if (above && below) {
        return false;
      }
    }
    return true;
  });

  for (const [a, b] of boundaryEdges) {
    const covered = kept.some(
      ({ normal, offset }) =>
        Math.abs(a.dot(normal) - offset) < quantum &&
        Math.abs(b.dot(normal) - offset) < quantum,
    );
    if (!covered) {
      return null;
    }
  }
  return kept;
}

function newSolidPiece(
  piece: PieceStickers,
  cuts: { planes: Cut[]; edges: Map<string, Set<string>> },
  sizes: { quantum: number; radius: number; featureScale: number },
): PiecePlan | null {
  if (piece.stickers.length === 0) {
    return null;
  }
  const planes: PiecePlane[] = [];
  // Which plane each sticker's face became, so its facelet can be painted.
  const planeOfSticker = new Map<StickerDatSticker, number>();

  // Strictly inside the piece, since a cut runs along an edge of a sticker and
  // the rest of the piece stays on one side of it. Pulling it toward the
  // puzzle's center instead would leave a shallow piece behind.
  const interior = new Vector3();
  for (const { polygon } of piece.stickers) {
    for (const vertex of polygon) {
      interior.addScaledVector(
        vertex,
        1 / polygon.length / piece.stickers.length,
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

  // One cut per edge the piece shares with another piece, which is what bounds
  // it. Taking every cut the piece happens to sit on one side of instead would
  // let a plane that only grazes the surface here slice into the body.
  const pieceKey = `${piece.orbit}/${piece.ord}`;
  for (const { polygon } of piece.stickers) {
    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[i];
      const b = polygon[(i + 1) % polygon.length];
      const sharing = cuts.edges.get(
        [keyOf(a, sizes.quantum), keyOf(b, sizes.quantum)].sort().join("|"),
      );
      // An edge the piece keeps to itself is a fold in one piece of plastic,
      // not a cut: it stays sharp, and no plane belongs to it.
      if (!sharing || ![...sharing].some((key) => key !== pieceKey)) {
        continue;
      }
      // `cuts.planes` is in order of how much of the puzzle each cut explains,
      // so the first one holding this edge is the one both pieces settle on.
      const cut = cuts.planes.find(
        ({ normal, offset }) =>
          Math.abs(a.dot(normal) - offset) < sizes.quantum &&
          Math.abs(b.dot(normal) - offset) < sizes.quantum,
      );
      if (!cut) {
        return null;
      }
      const outward = interior.dot(cut.normal) < cut.offset;
      const normal = outward ? cut.normal.clone() : cut.normal.clone().negate();
      const offset = outward ? cut.offset : -cut.offset;
      if (
        planes.some(
          (plane) =>
            plane.color === null &&
            plane.normal.dot(normal) > 0.9999 &&
            Math.abs(plane.offset - offset) < sizes.quantum,
        )
      ) {
        continue;
      }
      planes.push({ normal, offset, color: null });
    }
  }

  // A cut can also bound the piece from behind, where it never reaches the
  // surface and so no edge nominates it — the back of a cube's center, say.
  // Those are the cuts the piece stays clear of entirely; a cut it touches is
  // one an edge already spoke for, and adding it here would let a plane that
  // only grazes the surface slice into the body.
  for (const cut of cuts.planes) {
    let touches = false;
    let above = false;
    let below = false;
    for (const { polygon } of piece.stickers) {
      for (const vertex of polygon) {
        const side = vertex.dot(cut.normal) - cut.offset;
        if (Math.abs(side) <= sizes.quantum) {
          touches = true;
        } else if (side > 0) {
          above = true;
        } else {
          below = true;
        }
      }
    }
    if (touches || above === below) {
      continue;
    }
    planes.push(
      above
        ? {
            normal: cut.normal.clone().negate(),
            offset: -cut.offset,
            color: null,
          }
        : { normal: cut.normal.clone(), offset: cut.offset, color: null },
    );
  }

  const solid = solidPieceGeometry(planes, {
    groove: SOLID_PIECE_GROOVE * sizes.featureScale,
    chamfer: SOLID_PIECE_CHAMFER * sizes.featureScale,
    radius: sizes.radius,
  });
  if (!solid) {
    return null;
  }

  // The hint facelets are a mesh of their own: they are drawn with a different
  // material, so they belong in a different batch.
  const hintPositions: number[] = [];
  const hintRanges = new Map<StickerDatSticker, VertexRange>();
  for (const { sticker, polygon } of piece.stickers) {
    const normal = outwardNormal(polygon)!;
    const hint = hintPolygon(polygon, normal);
    const start = hintPositions.length / 3;
    for (let i = 1; i < hint.length - 1; i++) {
      for (const vertex of [hint[0], hint[i], hint[i + 1]]) {
        hintPositions.push(vertex.x, vertex.y, vertex.z);
      }
    }
    hintRanges.set(sticker, {
      start,
      count: hintPositions.length / 3 - start,
    });
  }

  const body = newPieceMesh(solid.positions);
  const hint =
    hintPositions.length > 0
      ? newPieceMesh(new Float32Array(hintPositions))
      : null;
  paintInternal(body.colors, solid.internalRanges);

  // A logo sits just clear of the plastic, on the largest square that fits the
  // facelet. Kept per face rather than per sticker, so that the duplicates
  // stacked on a center's square get the square they share.
  const logoByFace = new Map<number, FaceletSurface | null>();
  for (const { sticker, polygon } of piece.stickers) {
    logoByFace.set(
      sticker.face,
      logoSurface(
        polygon,
        outwardNormal(polygon)!,
        LOGO_ELEVATION * sizes.featureScale,
      ),
    );
  }

  const facelets: FaceletPlan[] = piece.stickers.map(({ sticker }) => ({
    ori: sticker.ori,
    faceStyle: sticker.face,
    body: solid.ranges[planeOfSticker.get(sticker)!],
    hint: [hintRanges.get(sticker)!],
    logo: logoByFace.get(sticker.face) ?? null,
  }));
  for (const sticker of piece.duplicates) {
    facelets.push({
      ori: sticker.ori,
      faceStyle: sticker.face,
      body: [],
      hint: [],
      logo: logoByFace.get(sticker.face) ?? null,
    });
  }

  return {
    orbit: piece.orbit,
    ord: piece.ord,
    // The geometry is already where the piece belongs.
    home: new Matrix4(),
    body,
    hint,
    facelets,
  };
}

function newPieceMesh(positions: Float32Array): PieceMesh {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  const colors = new BufferAttribute(
    new Uint8Array((4 * positions.length) / 3),
    4,
    true,
  );
  geometry.setAttribute("color", colors);
  return { geometry, colors };
}
