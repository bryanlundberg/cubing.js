import { FrontSide } from "three/src/constants.js";
import { BufferAttribute } from "three/src/core/BufferAttribute.js";
import { BufferGeometry } from "three/src/core/BufferGeometry.js";
import { MeshBasicMaterial } from "three/src/materials/MeshBasicMaterial.js";
import type { Matrix4 } from "three/src/math/Matrix4.js";
import { Vector3 } from "three/src/math/Vector3.js";
import { Mesh } from "three/src/objects/Mesh.js";
import type { Texture } from "three/src/textures/Texture.js";
import type { StickerDat } from "../../../../puzzle-geometry";

/**
 * A logo printed on one piece of the puzzle, the way a brand prints one on the
 * white center of a 3×3×3.
 *
 * The image is placed by the puzzle's own geometry rather than by anything the
 * caller passes in: whatever picture arrives is stretched onto the largest
 * square that fits the facelet it belongs on, so a tall logo, a wide one, and
 * one of an odd size all come out the same size on the piece.
 *
 * Which piece that is, is a question about the puzzle and not about the
 * renderer, so it is answered once here (see {@link logoFaceletAddress}) and
 * every 3D renderer places the same square the same way.
 */

/** How much of the facelet the logo takes up, across its middle. */
const LOGO_FIT = 0.8;

const EPSILON = 1e-9;

/** One facelet of one piece, in the numbering a `KPuzzle` orbit uses. */
export interface FaceletAddress {
  orbit: string;
  /** The piece the logo is printed on, by its solved position. */
  ord: number;
  /** Which facelet of that piece. */
  ori: number;
}

/**
 * The square a logo is drawn on: `center ± u ± v` are its corners, so `u` and
 * `v` are half-axes and their cross product points out of the puzzle.
 */
export interface FaceletSurface {
  center: Vector3;
  u: Vector3;
  v: Vector3;
}

/**
 * The largest square centered on a facelet that stays inside it, shrunk to
 * {@link LOGO_FIT} and lifted clear of the plastic by `elevation`.
 *
 * The square is aligned with the facelet's first edge, which puts it square to
 * a cube's facelets and leaves it centered on anything else. Its size comes
 * from the polygon itself rather than from a bounding box, so that a triangle
 * (the middle of a pyraminx face) and a pentagon (a megaminx center) each get a
 * logo that fits them instead of one that hangs over their slanted edges.
 */
export function logoSurface(
  polygon: Vector3[],
  normal: Vector3,
  elevation: number,
): FaceletSurface | null {
  if (polygon.length < 3) {
    return null;
  }
  const center = new Vector3();
  for (const vertex of polygon) {
    center.addScaledVector(vertex, 1 / polygon.length);
  }
  const u = new Vector3()
    .subVectors(polygon[1], polygon[0])
    .addScaledVector(
      normal,
      -new Vector3().subVectors(polygon[1], polygon[0]).dot(normal),
    );
  if (u.lengthSq() < EPSILON) {
    return null;
  }
  u.normalize();
  const v = new Vector3().crossVectors(normal, u).normalize();

  // A square of half-size `h` clears an edge when the edge's distance from the
  // center covers the square's reach in that direction, which is `h` times the
  // edge normal's own spread over the two in-plane axes.
  let half = Number.POSITIVE_INFINITY;
  for (let i = 0; i < polygon.length; i++) {
    const edge = new Vector3().subVectors(
      polygon[(i + 1) % polygon.length],
      polygon[i],
    );
    const outward = new Vector3().crossVectors(edge, normal);
    if (outward.lengthSq() < EPSILON) {
      continue;
    }
    outward.normalize();
    const distance = Math.abs(
      new Vector3().subVectors(polygon[i], center).dot(outward),
    );
    const reach = Math.abs(outward.dot(u)) + Math.abs(outward.dot(v));
    if (reach > EPSILON) {
      half = Math.min(half, distance / reach);
    }
  }
  if (!Number.isFinite(half) || half <= 0) {
    return null;
  }
  half *= LOGO_FIT;
  return {
    center: center.addScaledVector(normal, elevation),
    u: u.multiplyScalar(half),
    v: v.multiplyScalar(half),
  };
}

/** The same, for a facelet that is already known to be a rectangle. */
export function rectangleLogoSurface(
  center: Vector3,
  u: Vector3,
  v: Vector3,
): FaceletSurface {
  const half = LOGO_FIT * Math.min(u.length(), v.length());
  return {
    center,
    u: u.clone().setLength(half),
    v: v.clone().setLength(half),
  };
}

/** Places the unit quad from {@link logoGeometry} onto a facelet. */
export function surfaceMatrix(surface: FaceletSurface, into: Matrix4): Matrix4 {
  return into
    .makeBasis(
      surface.u,
      surface.v,
      new Vector3().crossVectors(surface.u, surface.v).normalize(),
    )
    .setPosition(surface.center);
}

let cachedLogoGeometry: BufferGeometry | undefined;
/** A quad from (-1, -1) to (1, 1) in the `z` plane, carrying the whole image. */
export function logoGeometry(): BufferGeometry {
  if (cachedLogoGeometry) {
    return cachedLogoGeometry;
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    "position",
    new BufferAttribute(
      // biome-ignore format: one vertex per line is less readable than one triangle per line.
      new Float32Array([
        -1, -1, 0, 1, -1, 0, 1, 1, 0,
        -1, -1, 0, 1, 1, 0, -1, 1, 0,
      ]),
      3,
    ),
  );
  geometry.setAttribute(
    "uv",
    // biome-ignore format: see above.
    new BufferAttribute(new Float32Array([
      0, 0, 1, 0, 1, 1,
      0, 0, 1, 1, 0, 1,
    ]), 2),
  );
  cachedLogoGeometry = geometry;
  return geometry;
}

/**
 * A mesh ready to be parented to whatever the renderer moves around. Its matrix
 * is set by hand from a {@link FaceletSurface}, so it does not track a position
 * or rotation of its own.
 */
export function newLogoMesh(texture: Texture): Mesh {
  const mesh = new Mesh(
    logoGeometry(),
    new MeshBasicMaterial({
      map: texture,
      side: FrontSide,
      transparent: true,
      // The logo floats just above the plastic, so it never has to compete with
      // it for depth, and writing depth would let its transparent corners
      // punch a hole in anything drawn after it.
      depthWrite: false,
    }),
  );
  mesh.matrixAutoUpdate = false;
  // Drawn after the piece it sits on, whatever order the pieces come out in.
  mesh.renderOrder = 1;
  return mesh;
}

/** Where the logo goes on a puzzle, in terms the puzzle's geometry can answer. */
interface LogoSpot {
  /** The face it is printed on, by `PuzzleGeometry`'s name for it. */
  face: string;
  /**
   * Set for a logo on a corner of that face, which is the piece it goes on for
   * a cube big enough to have somewhere else to put it. Otherwise the facelet
   * closest to the middle of the face wins.
   */
  corner?: boolean;
  /**
   * Which of the equally good candidates to take: the one whose facelet lies
   * furthest this way. Points at the corner the default camera is looking at.
   */
  toward?: [number, number, number];
}

/**
 * The white face of every puzzle that has one, the yellow face of the pyraminx
 * (which does not), and the piece within it a logo belongs on.
 *
 * `PuzzleGeometry` colors a face by its name, so naming the face here picks the
 * color out of the default scheme without depending on the numbering, which
 * differs between puzzles.
 */
const logoSpots: Record<string, LogoSpot> = {
  // Every piece of a 2×2×2 is a corner, so this is just "a piece of the white
  // face".
  "2x2x2": { face: "U", corner: true, toward: [1, 1, 1] },
  // `Cube3D` draws the 3×3×3 by default and places its own logo; this is for
  // `visualization="PG3D"`.
  "3x3x3": { face: "U" },
  "4x4x4": { face: "U", corner: true, toward: [1, 1, 1] },
  "5x5x5": { face: "U", corner: true, toward: [1, 1, 1] },
  "6x6x6": { face: "U", corner: true, toward: [1, 1, 1] },
  "7x7x7": { face: "U", corner: true, toward: [1, 1, 1] },
  megaminx: { face: "U" },
  // A pyraminx has no center piece: the middle of a face is an edge's facelet.
  pyraminx: { face: "D" },
  skewb: { face: "U" },
  // No logo on the FTO or the clock.
};

function centroid(coords: number[]): Vector3 {
  const center = new Vector3();
  const vertices = coords.length / 3;
  for (let i = 0; i < coords.length; i += 3) {
    center.x += coords[i] / vertices;
    center.y += coords[i + 1] / vertices;
    center.z += coords[i + 2] / vertices;
  }
  return center;
}

/**
 * Which facelet of which piece carries the logo on this puzzle, or `null` for a
 * puzzle that doesn't take one.
 */
export function logoFaceletAddress(
  puzzleID: string,
  stickerDat: StickerDat,
): FaceletAddress | null {
  const spot = logoSpots[puzzleID];
  if (!spot) {
    return null;
  }
  const faceIdx = stickerDat.faces.findIndex((face) => face.name === spot.face);
  if (faceIdx === -1) {
    return null;
  }
  const faceCenter = centroid(stickerDat.faces[faceIdx].coords);

  // How many faces of the puzzle each piece reaches, which is what tells a
  // corner from a center without knowing an orbit's name.
  const faceletCounts = new Map<string, number>();
  for (const sticker of stickerDat.stickers) {
    if (sticker.isDup) {
      continue;
    }
    const key = `${sticker.orbit}/${sticker.ord}`;
    faceletCounts.set(key, (faceletCounts.get(key) ?? 0) + 1);
  }

  const toward = spot.toward ? new Vector3(...spot.toward) : null;
  let best: FaceletAddress | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const sticker of stickerDat.stickers) {
    if (sticker.isDup || sticker.face !== faceIdx) {
      continue;
    }
    if (
      spot.corner &&
      faceletCounts.get(`${sticker.orbit}/${sticker.ord}`) !== 3
    ) {
      continue;
    }
    const center = centroid(sticker.coords);
    const score = toward ? center.dot(toward) : -center.distanceTo(faceCenter);
    if (score > bestScore) {
      bestScore = score;
      best = { orbit: sticker.orbit, ord: sticker.ord, ori: sticker.ori };
    }
  }
  return best;
}
