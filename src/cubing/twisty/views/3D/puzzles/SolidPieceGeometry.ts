import { Vector3 } from "three/src/math/Vector3.js";

/**
 * One flat side of a piece.
 *
 * A piece of a twisty puzzle is what is left when every cut of the puzzle has
 * been made, so it is exactly an intersection of half-spaces — which is a far
 * easier thing to hand a renderer than a mesh. Give this module the planes and
 * it hands back a solid.
 */
export interface PiecePlane {
  /** Unit vector pointing out of the piece. */
  normal: Vector3;
  /** The plane is where `position · normal === offset`. */
  offset: number;
  /**
   * `null` for a side that meets another piece rather than the outside world:
   * it is cut back to open a groove, and shows the plastic inside.
   */
  color: number | null;
}

export interface VertexRange {
  start: number;
  count: number;
}

export interface SolidPiece {
  positions: Float32Array;
  normals: Float32Array;
  vertexCount: number;
  /**
   * Vertices to paint with each plane's color, indexed like the planes passed
   * in. A colored plane owns its own face plus the bevels running around it, so
   * that changing a facelet's color changes all of it.
   */
  ranges: VertexRange[][];
  /** Everything else: the plastic inside the puzzle. */
  internalRanges: VertexRange[];
}

/**
 * Default groove and bevel, as a fraction of how far the puzzle's faces sit
 * from its center. The groove is sized to read about as wide as the one between
 * two cubies of the 3×3×3; the bevel is deliberately a hairline, just enough to
 * catch the light along a rim, since a facelet is a flat plate and a wide bevel
 * would make every piece look raised.
 */
export const SOLID_PIECE_GROOVE = 0.018;
export const SOLID_PIECE_CHAMFER = 0.005;

export interface SolidPieceOptions {
  /**
   * How far a side that meets another piece is cut back. Half the width of the
   * groove between two pieces, since both sides give up the same.
   */
  groove: number;
  /**
   * Width of the bevel where a colored face runs into a groove. Only there:
   * where two colored faces meet, the piece is one unbroken piece of plastic
   * and its edge stays sharp, the way a cube's own edges do.
   */
  chamfer: number;
  /** Roughly how far the puzzle reaches from its center. Sets the tolerances. */
  radius: number;
}

interface WorkingPlane {
  normal: Vector3;
  offset: number;
  /**
   * Which of the planes passed in colors this one: itself for a real side, the
   * face it runs alongside for a bevel, and -1 for the box we start from.
   */
  source: number;
}

interface Facet {
  plane: number;
  vertices: Vector3[];
}

const BOX_PLANE = -1;

/** The polygon of the starting box's side along `normal`. */
function boxFacet(planeIdx: number, normal: Vector3, size: number): Facet {
  const reference =
    Math.abs(normal.y) > 0.5 ? new Vector3(0, 0, 1) : new Vector3(0, 1, 0);
  const u = new Vector3().crossVectors(reference, normal).normalize();
  const v = new Vector3().crossVectors(normal, u);
  const center = normal.clone().multiplyScalar(size);
  return {
    plane: planeIdx,
    vertices: (
      [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ] as const
    ).map(([su, sv]) =>
      center
        .clone()
        .addScaledVector(u, su * size)
        .addScaledVector(v, sv * size),
    ),
  };
}

const BOX_NORMALS = [
  new Vector3(1, 0, 0),
  new Vector3(-1, 0, 0),
  new Vector3(0, 1, 0),
  new Vector3(0, -1, 0),
  new Vector3(0, 0, 1),
  new Vector3(0, 0, -1),
];

/** Sorts points lying in one plane into a loop, counter-clockwise from outside. */
function orderInPlane(points: Vector3[], normal: Vector3): Vector3[] {
  const centroid = new Vector3();
  for (const point of points) {
    centroid.addScaledVector(point, 1 / points.length);
  }
  const reference = new Vector3().subVectors(points[0], centroid).normalize();
  const other = new Vector3().crossVectors(normal, reference);
  const offset = new Vector3();
  return points
    .map((point) => {
      offset.subVectors(point, centroid);
      return {
        point,
        angle: Math.atan2(offset.dot(other), offset.dot(reference)),
      };
    })
    .sort((a, b) => a.angle - b.angle)
    .map(({ point }) => point);
}

function vertexKey(vertex: Vector3, quantum: number): string {
  return `${Math.round(vertex.x / quantum)},${Math.round(vertex.y / quantum)},${Math.round(vertex.z / quantum)}`;
}

function clipByPlane(
  facets: Facet[],
  plane: WorkingPlane,
  planeIdx: number,
  epsilon: number,
): Facet[] {
  const clipped: Facet[] = [];
  const capPoints: Vector3[] = [];
  const capKeys = new Set<string>();
  const quantum = epsilon * 10;

  for (const facet of facets) {
    const kept: Vector3[] = [];
    const count = facet.vertices.length;
    for (let i = 0; i < count; i++) {
      const current = facet.vertices[i];
      const next = facet.vertices[(i + 1) % count];
      const currentSide = current.dot(plane.normal) - plane.offset;
      const nextSide = next.dot(plane.normal) - plane.offset;
      if (currentSide <= epsilon) {
        kept.push(current);
      }
      if (
        (currentSide > epsilon && nextSide < -epsilon) ||
        (currentSide < -epsilon && nextSide > epsilon)
      ) {
        kept.push(
          current.clone().lerp(next, currentSide / (currentSide - nextSide)),
        );
      }
    }
    if (kept.length < 3) {
      continue;
    }
    clipped.push({ plane: facet.plane, vertices: kept });
    for (const vertex of kept) {
      if (Math.abs(vertex.dot(plane.normal) - plane.offset) > epsilon) {
        continue;
      }
      // The same corner reaches the cap once per facet that meets there.
      const key = vertexKey(vertex, quantum);
      if (!capKeys.has(key)) {
        capKeys.add(key);
        capPoints.push(vertex);
      }
    }
  }

  if (capPoints.length >= 3) {
    clipped.push({
      plane: planeIdx,
      vertices: orderInPlane(capPoints, plane.normal),
    });
  }
  return clipped;
}

function buildFacets(
  planes: WorkingPlane[],
  radius: number,
  epsilon: number,
): Facet[] | null {
  let facets = BOX_NORMALS.map((normal) =>
    boxFacet(BOX_PLANE, normal, radius * 4),
  );
  for (let planeIdx = 0; planeIdx < planes.length; planeIdx++) {
    facets = clipByPlane(facets, planes[planeIdx], planeIdx, epsilon);
  }
  // A surviving side of the starting box means the planes didn't close a solid.
  if (facets.some((facet) => facet.plane === BOX_PLANE) || facets.length < 4) {
    return null;
  }
  return facets;
}

/**
 * The bevel planes: one for each edge where a colored face meets a groove.
 *
 * Adding them as more half-spaces rather than building the bevel geometry by
 * hand keeps the result a convex solid built the one way, and makes the bevels
 * meet each other correctly at the piece's corners for free.
 */
function chamferPlanes(
  facets: Facet[],
  planes: WorkingPlane[],
  chamfer: number,
  epsilon: number,
): WorkingPlane[] {
  const quantum = epsilon * 10;
  // Which facets meet along each edge.
  const edges = new Map<string, number[]>();
  for (const facet of facets) {
    const { vertices } = facet;
    for (let i = 0; i < vertices.length; i++) {
      const edgeKey = [
        vertexKey(vertices[i], quantum),
        vertexKey(vertices[(i + 1) % vertices.length], quantum),
      ]
        .sort()
        .join("|");
      const sharing = edges.get(edgeKey);
      if (sharing) {
        sharing.push(facet.plane);
      } else {
        edges.set(edgeKey, [facet.plane]);
      }
    }
  }

  const added: WorkingPlane[] = [];
  const seen = new Set<string>();
  for (const sharing of edges.values()) {
    if (sharing.length !== 2) {
      continue;
    }
    const [a, b] = sharing;
    const colored = planes[a].source !== -1 ? a : b;
    const internal = planes[a].source !== -1 ? b : a;
    // Only the rim between plastic that shows and plastic that doesn't.
    if (planes[colored].source === -1 || planes[internal].source !== -1) {
      continue;
    }
    const pairKey = `${colored}|${internal}`;
    if (seen.has(pairKey)) {
      continue;
    }
    seen.add(pairKey);
    const sum = new Vector3().addVectors(
      planes[colored].normal,
      planes[internal].normal,
    );
    if (sum.length() < 1e-6) {
      continue;
    }
    added.push({
      normal: sum.clone().normalize(),
      // Where the two faces meet, measured along the bevel's own direction.
      offset:
        (planes[colored].offset + planes[internal].offset) / sum.length() -
        chamfer,
      source: planes[colored].source,
    });
  }
  return added;
}

/**
 * Builds a piece as the intersection of its planes: the sides that meet other
 * pieces cut back to open a thin groove, and a small bevel run around every
 * colored face that borders one.
 *
 * Returns `null` if the planes don't bound a solid, so that a caller handed
 * something unexpected can fall back rather than draw nonsense.
 */
export function solidPieceGeometry(
  planes: PiecePlane[],
  options: SolidPieceOptions,
): SolidPiece | null {
  const epsilon = options.radius * 1e-6;
  // An internal plane keeps `source: -1`, which is also what marks it as the
  // plastic inside: only a colored plane names a facelet to paint.
  const working: WorkingPlane[] = planes.map((plane, index) => ({
    normal: plane.normal,
    offset: plane.offset - (plane.color === null ? options.groove : 0),
    source: plane.color === null ? -1 : index,
  }));

  const plain = buildFacets(working, options.radius, epsilon);
  if (!plain) {
    return null;
  }
  const withChamfers =
    options.chamfer > 0
      ? working.concat(chamferPlanes(plain, working, options.chamfer, epsilon))
      : working;
  const facets =
    (options.chamfer > 0
      ? buildFacets(withChamfers, options.radius, epsilon)
      : plain) ?? plain;

  const positions: number[] = [];
  const normals: number[] = [];
  const ranges: VertexRange[][] = planes.map(() => []);
  const internalRanges: VertexRange[] = [];
  for (const facet of facets) {
    const plane = withChamfers[facet.plane];
    const start = positions.length / 3;
    for (let i = 1; i < facet.vertices.length - 1; i++) {
      for (const vertex of [
        facet.vertices[0],
        facet.vertices[i],
        facet.vertices[i + 1],
      ]) {
        positions.push(vertex.x, vertex.y, vertex.z);
        normals.push(plane.normal.x, plane.normal.y, plane.normal.z);
      }
    }
    const range = { start, count: positions.length / 3 - start };
    if (range.count === 0) {
      continue;
    }
    if (plane.source === -1) {
      internalRanges.push(range);
    } else {
      ranges[plane.source].push(range);
    }
  }

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    vertexCount: positions.length / 3,
    ranges,
    internalRanges,
  };
}
