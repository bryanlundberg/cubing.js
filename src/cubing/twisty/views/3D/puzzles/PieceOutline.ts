import { BackSide } from "three/src/constants.js";
import { BufferAttribute } from "three/src/core/BufferAttribute.js";
import { BufferGeometry } from "three/src/core/BufferGeometry.js";
import { MeshBasicMaterial } from "three/src/materials/MeshBasicMaterial.js";
import { Triangle } from "three/src/math/Triangle.js";
import { Vector3 } from "three/src/math/Vector3.js";

// Inverted hull; translucent black so it fades out on dark backgrounds.
// `width` is in scene units, where a 3×3×3 is 1 across.
const OUTLINE_WIDTH = 0.004;
const OUTLINE_OPACITY = 0.18;

// Caps the push at a sharp tip, where the exact offset grows without bound.
const MIN_NORMAL_DOT = 0.25;

let outlineMaterialCache: MeshBasicMaterial | undefined;
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
  const index = source.getIndex();

  // Vertices at one spot move together, or the hull would tear along seams.
  const spotOfVertex = new Int32Array(position.count);
  const spotIds = new Map<string, number>();
  const spotNormals: Vector3[][] = [];
  for (let i = 0; i < position.count; i++) {
    const key = `${Math.round(position.getX(i) * 1e5)},${Math.round(position.getY(i) * 1e5)},${Math.round(position.getZ(i) * 1e5)}`;
    let spot = spotIds.get(key);
    if (spot === undefined) {
      spot = spotNormals.length;
      spotIds.set(key, spot);
      spotNormals.push([]);
    }
    spotOfVertex[i] = spot;
  }

  const a = new Vector3();
  const b = new Vector3();
  const c = new Vector3();
  const normal = new Vector3();
  const triangleVertices = index ? index.count : position.count;
  for (let t = 0; t < triangleVertices; t += 3) {
    const vertices = [0, 1, 2].map((k) => (index ? index.getX(t + k) : t + k));
    a.fromBufferAttribute(position, vertices[0]);
    b.fromBufferAttribute(position, vertices[1]);
    c.fromBufferAttribute(position, vertices[2]);
    Triangle.getNormal(a, b, c, normal);
    if (normal.lengthSq() === 0) {
      continue;
    }
    // Distinct normals only, so a face cut into many triangles counts once.
    for (const vertex of vertices) {
      const normals = spotNormals[spotOfVertex[vertex]];
      if (normals.every((existing) => existing.dot(normal) < 0.999)) {
        normals.push(normal.clone());
      }
    }
  }

  const spotOffsets = spotNormals.map((normals) => {
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
  });

  const positions = new Float32Array(position.count * 3);
  for (let i = 0; i < position.count; i++) {
    const offset = spotOffsets[spotOfVertex[i]];
    positions[3 * i] = position.getX(i) + offset.x;
    positions[3 * i + 1] = position.getY(i) + offset.y;
    positions[3 * i + 2] = position.getZ(i) + offset.z;
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  if (index) {
    geometry.setIndex(index.clone());
  }
  return geometry;
}
