import { BufferAttribute } from "three/src/core/BufferAttribute.js";
import { BufferGeometry } from "three/src/core/BufferGeometry.js";
import { Vector3 } from "three/src/math/Vector3.js";

function clamp(value: number, bound: number): number {
  return Math.min(Math.max(value, -bound), bound);
}

function component(vector: Vector3, axis: number): number {
  return axis === 0 ? vector.x : axis === 1 ? vector.y : vector.z;
}

function setComponent(vector: Vector3, axis: number, value: number): void {
  if (axis === 0) {
    vector.x = value;
  } else if (axis === 1) {
    vector.y = value;
  } else {
    vector.z = value;
  }
}

/**
 * Builds a rounded cubie centered at the origin, with one material group per
 * face.
 *
 * The surface of a box of half-size `halfSize` is sampled as six grids, and
 * every sample is pushed onto the Minkowski sum of a smaller box and an
 * ellipsoid. A sample in the middle of a face lands back where it started, so
 * the face stays flat; one near an edge or a corner rolls over.
 *
 * Three properties make this worth doing over a hand-built rounded box:
 *
 * - Each grid covers exactly one face of the underlying box, so the boundary
 *   between two grids maps onto the midline of the rounding between them —
 *   exactly where two colors of plastic meet on a stickerless cube. Each face
 *   can be its own material group and its color wraps over its own half of the
 *   rounding for free.
 * - The rounding is a field over the cubie rather than a constant. Because it
 *   is a pure function of the sample's position on the box — which is shared by
 *   the two grids meeting along any edge — neighboring faces still agree
 *   exactly and the surface stays closed.
 * - The field is a radius per axis, not one radius. A sphere of radius r rounds
 *   a corner by r *and* domes it by r, and the two cannot be separated. An
 *   ellipsoid can be wide across a face and shallow along its normal, which is
 *   what a real speedcube facelet is: a flat plate with a rounded outline
 *   rather than a cushion.
 *
 * Each axis takes its radius from whether the face on that side of the cubie is
 * listed in `outerFaceIndices`:
 *
 * - Pointing out of the puzzle: `outerAxisRadius` everywhere. This is the roll
 *   at the rim of a facelet, so keeping it small is what keeps the piece flat.
 * - Pointing at a neighboring piece: `innerEdgeRadius` along the middle of an
 *   edge, widening to `innerCornerRadius` at a corner over `cornerSharpness`.
 *   The first sets how wide the line between two pieces reads, the second
 *   rounds a facelet's corners within its own plane — but only at corners
 *   where a single face points out of the puzzle, so that the ones sitting on
 *   the puzzle's rim stay square.
 *
 * Those two rules alone give a face its three piece shapes. A center has no
 * outward-facing axis in its own plane, so its outline rounds off on all four
 * sides and it reads as a disc. A corner piece has two, so it stays square
 * apart from the single corner pointing at the middle of the face. An edge
 * piece has one, so it is straight along the puzzle's rim and round on its
 * other three sides.
 *
 * Group `i` corresponds to `faceNormals[i]`.
 */
export function beveledCubieGeometry(
  faceNormals: Vector3[],
  outerFaceIndices: number[],
  halfSize: number,
  outerAxisRadius: number,
  innerEdgeRadius: number,
  innerCornerRadius: number,
  cornerSharpness: number,
  segments: number,
): BufferGeometry {
  const allRadii = [outerAxisRadius, innerEdgeRadius, innerCornerRadius];
  const maxRadius = Math.max(...allRadii);
  if (!(Math.min(...allRadii) > 0 && maxRadius < halfSize)) {
    throw new Error(
      "Every radius must be positive and smaller than the half-size.",
    );
  }
  if (cornerSharpness <= 0 || segments < 1) {
    throw new Error(
      "The corner sharpness must be positive, with at least one segment.",
    );
  }

  // Whether the face on each side of each axis points out of the puzzle.
  const outward: number[][] = [
    [0, 0],
    [0, 0],
    [0, 0],
  ];
  for (let faceIdx = 0; faceIdx < faceNormals.length; faceIdx++) {
    const normal = faceNormals[faceIdx];
    const axis =
      Math.abs(normal.x) > 0.5 ? 0 : Math.abs(normal.y) > 0.5 ? 1 : 2;
    outward[axis][component(normal, axis) > 0 ? 1 : 0] =
      outerFaceIndices.includes(faceIdx) ? 1 : 0;
  }

  // Laid out for the widest rounding anything asks for. Somewhere with a
  // smaller radius just stays flat further into the band, which costs a few
  // vertices but keeps the grid — and so the seams between faces — identical.
  const inner = halfSize - maxRadius;

  const samples: number[] = [];
  for (let i = 0; i <= segments; i++) {
    samples.push(-halfSize + (maxRadius * i) / segments);
  }
  for (let i = 0; i <= segments; i++) {
    samples.push(inner + (maxRadius * i) / segments);
  }
  const gridSize = samples.length;

  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];

  const geometry = new BufferGeometry();

  const point = new Vector3();
  const core = new Vector3();
  const offset = new Vector3();
  const u = new Vector3();
  const v = new Vector3();
  const radii = new Vector3();
  const outerness = [0, 0, 0];

  const radiiAt = (p: Vector3, out: Vector3): void => {
    // 1 at a corner, and 0 wherever any coordinate passes through the middle of
    // the cubie — which is also everywhere the sides below swap over, so the
    // corner term has faded out before it could jump.
    const towardCorner =
      ((Math.abs(p.x) * Math.abs(p.y) * Math.abs(p.z)) /
        (halfSize * halfSize * halfSize)) **
      cornerSharpness;
    let outwardFaceCount = 0;
    for (let axis = 0; axis < 3; axis++) {
      // Which side of this axis the point is on, as a ramp rather than a step,
      // so that the radius stays continuous through the middle of the cubie.
      const towardPositive = (component(p, axis) / halfSize + 1) / 2;
      outerness[axis] =
        towardPositive * outward[axis][1] +
        (1 - towardPositive) * outward[axis][0];
      outwardFaceCount += outerness[axis];
    }
    // Round a corner within its plane only where it is an interior point of a
    // single face — the place four pieces meet. As soon as a second face there
    // also points out of the puzzle the corner is on the puzzle's rim, where
    // the pieces have to meet the outline at a square 90° instead of flaring
    // into it.
    const interiorCorner = Math.min(Math.max(2 - outwardFaceCount, 0), 1);
    for (let axis = 0; axis < 3; axis++) {
      const alongEdge =
        innerEdgeRadius + (outerAxisRadius - innerEdgeRadius) * outerness[axis];
      const atCorner =
        innerCornerRadius +
        (outerAxisRadius - innerCornerRadius) * outerness[axis];
      setComponent(
        out,
        axis,
        alongEdge + (atCorner - alongEdge) * towardCorner * interiorCorner,
      );
    }
  };

  for (let faceIdx = 0; faceIdx < faceNormals.length; faceIdx++) {
    const normal = faceNormals[faceIdx];
    // Any perpendicular pair will do, as long as `u × v === normal` so that the
    // triangles below wind counter-clockwise as seen from outside. Rotating the
    // components is enough to get a vector that is never parallel to an
    // axis-aligned `normal`.
    u.set(normal.y, normal.z, normal.x);
    v.crossVectors(normal, u);

    const vertexStart = positions.length / 3;
    for (let i = 0; i < gridSize; i++) {
      for (let j = 0; j < gridSize; j++) {
        point
          .copy(u)
          .multiplyScalar(samples[i])
          .addScaledVector(v, samples[j])
          .addScaledVector(normal, halfSize);
        radiiAt(point, radii);
        core.set(
          clamp(point.x, halfSize - radii.x),
          clamp(point.y, halfSize - radii.y),
          clamp(point.z, halfSize - radii.z),
        );
        // Project onto the ellipsoid in the space where it is a unit sphere,
        // then scale back out.
        offset
          .set(
            (point.x - core.x) / radii.x,
            (point.y - core.y) / radii.y,
            (point.z - core.z) / radii.z,
          )
          .normalize();
        positions.push(
          core.x + offset.x * radii.x,
          core.y + offset.y * radii.y,
          core.z + offset.z * radii.z,
        );
        // The ellipsoid's gradient divides by the radius once more than the
        // point itself does.
        normals.push(
          ...offset
            .set(offset.x / radii.x, offset.y / radii.y, offset.z / radii.z)
            .normalize()
            .toArray(),
        );
      }
    }

    const indexStart = indices.length;
    for (let i = 0; i < gridSize - 1; i++) {
      for (let j = 0; j < gridSize - 1; j++) {
        const a = vertexStart + i * gridSize + j;
        const b = a + gridSize;
        indices.push(a, b, b + 1, a, b + 1, a + 1);
      }
    }
    geometry.addGroup(indexStart, indices.length - indexStart, faceIdx);
  }

  geometry.setAttribute(
    "position",
    new BufferAttribute(new Float32Array(positions), 3),
  );
  geometry.setAttribute(
    "normal",
    new BufferAttribute(new Float32Array(normals), 3),
  );
  geometry.setIndex(indices);
  return geometry;
}
