import { BackSide } from "three/src/constants.js";
import { BufferAttribute } from "three/src/core/BufferAttribute.js";
import { BufferGeometry } from "three/src/core/BufferGeometry.js";
import { MeshBasicMaterial } from "three/src/materials/MeshBasicMaterial.js";
import { Triangle } from "three/src/math/Triangle.js";
import { Vector3 } from "three/src/math/Vector3.js";
import type { VertexRange } from "./SolidPieceGeometry";

// Translucent black so it fades out on dark backgrounds.
// `width` is in scene units, where a 3×3×3 is 1 across.
const OUTLINE_WIDTH = 0.004;
const OUTLINE_OPACITY = 0.18;

// Caps the push at a sharp tip, where the exact offset grows without bound.
const MIN_NORMAL_DOT = 0.25;

let outlineMaterialCache: MeshBasicMaterial | undefined;
/** For {@link newOutlineGeometry}: an inverted hull. */
export function outlineMaterial(): MeshBasicMaterial {
  if (!outlineMaterialCache) {
    outlineMaterialCache = new MeshBasicMaterial({
      color: 0x000000,
      side: BackSide,
      transparent: true,
      opacity: OUTLINE_OPACITY,
      depthWrite: false,
    });
    // Pinned to the far plane, so it only draws where no piece has.
    outlineMaterialCache.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader.replace(
        "#include <project_vertex>",
        "#include <project_vertex>\n\tgl_Position.z = gl_Position.w;",
      );
    };
  }
  return outlineMaterialCache;
}

let frameMaterialCache: MeshBasicMaterial | undefined;
/** For {@link frameTriangles}. */
export function frameMaterial(): MeshBasicMaterial {
  return (frameMaterialCache ??= new MeshBasicMaterial({
    color: 0x000000,
    side: BackSide,
    transparent: true,
    opacity: OUTLINE_OPACITY,
    depthWrite: false,
  }));
}

/** For {@link newFrameGeometry}, colored by {@link frameColor}. */
export function newVertexColorFrameMaterial(): MeshBasicMaterial {
  return new MeshBasicMaterial({
    vertexColors: true,
    side: BackSide,
    transparent: true,
    depthWrite: false,
  });
}

const visibleFrameColor = new Uint8Array([
  0,
  0,
  0,
  Math.round(OUTLINE_OPACITY * 0xff),
]);
const hiddenFrameColor = new Uint8Array(4);
export function frameColor(visible: boolean): Uint8Array {
  return visible ? visibleFrameColor : hiddenFrameColor;
}

/** Vertices at one spot, so that they move together. */
function spotsOf(position: BufferGeometry["attributes"][string]): {
  spotOfVertex: Int32Array;
  spotPositions: Vector3[];
} {
  const spotOfVertex = new Int32Array(position.count);
  const spotIds = new Map<string, number>();
  const spotPositions: Vector3[] = [];
  for (let i = 0; i < position.count; i++) {
    const key = `${Math.round(position.getX(i) * 1e5)},${Math.round(position.getY(i) * 1e5)},${Math.round(position.getZ(i) * 1e5)}`;
    let spot = spotIds.get(key);
    if (spot === undefined) {
      spot = spotPositions.length;
      spotIds.set(key, spot);
      spotPositions.push(new Vector3().fromBufferAttribute(position, i));
    }
    spotOfVertex[i] = spot;
  }
  return { spotOfVertex, spotPositions };
}

/** How far to move a spot so every face in `normals` moves out by `width`. */
function offsetFor(normals: Vector3[], width: number): Vector3 {
  const direction = new Vector3();
  for (const normal of normals) {
    direction.add(normal);
  }
  if (direction.lengthSq() === 0) {
    return direction;
  }
  direction.normalize();
  let minDot = 1;
  for (const normal of normals) {
    minDot = Math.min(minDot, direction.dot(normal));
  }
  return direction.multiplyScalar(width / Math.max(minDot, MIN_NORMAL_DOT));
}

function forEachTriangle(
  geometry: BufferGeometry,
  callback: (vertices: number[], normal: Vector3) => void,
): void {
  const position = geometry.getAttribute("position");
  const index = geometry.getIndex();
  const a = new Vector3();
  const b = new Vector3();
  const c = new Vector3();
  const normal = new Vector3();
  const count = index ? index.count : position.count;
  for (let t = 0; t < count; t += 3) {
    const vertices = [0, 1, 2].map((k) => (index ? index.getX(t + k) : t + k));
    a.fromBufferAttribute(position, vertices[0]);
    b.fromBufferAttribute(position, vertices[1]);
    c.fromBufferAttribute(position, vertices[2]);
    Triangle.getNormal(a, b, c, normal);
    if (normal.lengthSq() > 0) {
      callback(vertices, normal);
    }
  }
}

/**
 * `source` inflated by the outline width. `scale` is the scale the puzzle
 * applies to its own geometry. Faces must wind counter-clockwise from outside.
 */
export function newOutlineGeometry(
  source: BufferGeometry,
  scale: number,
): BufferGeometry {
  const width = OUTLINE_WIDTH / scale;
  const position = source.getAttribute("position");
  const { spotOfVertex, spotPositions } = spotsOf(position);
  const spotNormals: Vector3[][] = spotPositions.map(() => []);
  forEachTriangle(source, (vertices, normal) => {
    // Distinct normals only, so a face cut into many triangles counts once.
    for (const vertex of vertices) {
      const normals = spotNormals[spotOfVertex[vertex]];
      if (normals.every((existing) => existing.dot(normal) < 0.999)) {
        normals.push(normal.clone());
      }
    }
  });
  const spotOffsets = spotNormals.map((normals) => offsetFor(normals, width));

  const positions = new Float32Array(position.count * 3);
  for (let i = 0; i < position.count; i++) {
    const offset = spotOffsets[spotOfVertex[i]];
    positions[3 * i] = position.getX(i) + offset.x;
    positions[3 * i + 1] = position.getY(i) + offset.y;
    positions[3 * i + 2] = position.getZ(i) + offset.z;
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  const index = source.getIndex();
  if (index) {
    geometry.setIndex(index.clone());
  }
  return geometry;
}

/**
 * Positions of a band the outline width wide around the rim of each flat
 * polygon in `source`, in the polygon's own plane and wound the same way, so
 * it shows from the same side. `include` limits it to the triangles whose
 * vertices all pass.
 */
export function frameTriangles(
  source: BufferGeometry,
  scale: number,
  include: (vertex: number) => boolean = () => true,
): number[] {
  const width = OUTLINE_WIDTH / scale;
  const { spotOfVertex, spotPositions } = spotsOf(
    source.getAttribute("position"),
  );

  // An edge used by one triangle only is on the rim.
  const edges = new Map<
    string,
    { from: number; to: number; third: number; normal: Vector3; uses: number }
  >();
  forEachTriangle(source, (vertices, normal) => {
    if (!vertices.every(include)) {
      return;
    }
    const spots = vertices.map((vertex) => spotOfVertex[vertex]);
    for (let k = 0; k < 3; k++) {
      const from = spots[k];
      const to = spots[(k + 1) % 3];
      const key = from < to ? `${from},${to}` : `${to},${from}`;
      const edge = edges.get(key);
      if (edge) {
        edge.uses++;
      } else {
        edges.set(key, {
          from,
          to,
          third: spots[(k + 2) % 3],
          normal: normal.clone(),
          uses: 1,
        });
      }
    }
  });

  const spotOutwards: Vector3[][] = spotPositions.map(() => []);
  const rim: { from: number; to: number }[] = [];
  for (const { from, to, third, normal, uses } of edges.values()) {
    if (uses !== 1) {
      continue;
    }
    const outward = spotPositions[to]
      .clone()
      .sub(spotPositions[from])
      .cross(normal)
      .normalize();
    if (
      outward.dot(spotPositions[third].clone().sub(spotPositions[from])) > 0
    ) {
      outward.negate();
    }
    spotOutwards[from].push(outward);
    spotOutwards[to].push(outward);
    rim.push({ from, to });
  }
  const spotOffsets = spotOutwards.map((outwards) =>
    offsetFor(outwards, width),
  );

  const positions: number[] = [];
  for (const { from, to } of rim) {
    const a = spotPositions[from];
    const b = spotPositions[to];
    const outerA = a.clone().add(spotOffsets[from]);
    const outerB = b.clone().add(spotOffsets[to]);
    for (const corner of [a, outerB, b, a, outerA, outerB]) {
      positions.push(corner.x, corner.y, corner.z);
    }
  }
  return positions;
}

/**
 * {@link frameTriangles} for each group of vertex ranges in `faces`, with a
 * zeroed `color` to write {@link frameColor} into. `ranges[i]` is where the
 * frame of `faces[i]` landed.
 */
export function newFrameGeometry(
  source: BufferGeometry,
  faces: VertexRange[][],
  scale: number,
): { geometry: BufferGeometry; ranges: VertexRange[] } {
  const positions: number[] = [];
  const ranges = faces.map((faceRanges) => {
    const start = positions.length / 3;
    positions.push(
      ...frameTriangles(source, scale, (vertex) =>
        faceRanges.some(
          (range) =>
            vertex >= range.start && vertex < range.start + range.count,
        ),
      ),
    );
    return { start, count: positions.length / 3 - start };
  });
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    "position",
    new BufferAttribute(new Float32Array(positions), 3),
  );
  geometry.setAttribute(
    "color",
    new BufferAttribute(new Uint8Array((4 * positions.length) / 3), 4, true),
  );
  return { geometry, ranges };
}
