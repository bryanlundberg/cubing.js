import type { Object3D } from "three/src/core/Object3D.js";
import { AmbientLight } from "three/src/lights/AmbientLight.js";
import { DirectionalLight } from "three/src/lights/DirectionalLight.js";
import { MeshPhongMaterial } from "three/src/materials/MeshPhongMaterial.js";
import { Color } from "three/src/math/Color.js";
import { Euler } from "three/src/math/Euler.js";
import { Vector3 } from "three/src/math/Vector3.js";
import { TAU } from "../TAU";

/**
 * What a cube is made of, kept in one place so that every cube renderer molds
 * its pieces out of the same plastic. A 3×3×3 (`Cube3D`) and a 7×7×7
 * (`CubeNxN3D`) sitting side by side should look like two puzzles from the same
 * shelf, not two puzzles from two apps.
 */

/** Everything the color of one facelet depends on. */
export interface FaceletStyle {
  color: number;
  dimColor: number;
  hintColor: number;
  hintDimColor: number;
  // TODO: make this work better across bright *and* dark backgrounds. Maybe tweak sticker compositing settings?
  hintOpacityScale: number;
}

export interface CubeFaceStyle extends FaceletStyle {
  /** Outward direction of the face, in cubie-local coordinates. */
  vector: Vector3;
  /** Rotation taking a facelet lying in the `z` plane onto this face. */
  fromZ: Euler;
}

/** Indexed `U`, `L`, `F`, `R`, `B`, `D`. */
export const cubeFaceStyles: CubeFaceStyle[] = [
  {
    vector: new Vector3(0, 1, 0),
    fromZ: new Euler(-TAU / 4, 0, 0),
    color: 0xffffff,
    dimColor: 0xdddddd,
    hintColor: 0xffffff,
    hintDimColor: 0xdddddd,
    hintOpacityScale: 1.25,
  },
  {
    vector: new Vector3(-1, 0, 0),
    fromZ: new Euler(0, -TAU / 4, 0),
    color: 0xff9900,
    dimColor: 0x885500,
    hintColor: 0xff9900,
    hintDimColor: 0x884400,
    hintOpacityScale: 1,
  },
  {
    vector: new Vector3(0, 0, 1),
    fromZ: new Euler(0, 0, 0),
    color: 0x00ff00,
    dimColor: 0x008800,
    hintColor: 0x00ff00,
    hintDimColor: 0x009900,
    hintOpacityScale: 1,
  },
  {
    vector: new Vector3(1, 0, 0),
    fromZ: new Euler(0, TAU / 4, 0),
    color: 0xff0000,
    dimColor: 0x660000,
    hintColor: 0xff0000,
    hintDimColor: 0x660000,
    hintOpacityScale: 1,
  },
  {
    vector: new Vector3(0, 0, -1),
    fromZ: new Euler(0, TAU / 2, 0),
    color: 0x2266ff,
    dimColor: 0x113388,
    hintColor: 0x2266ff,
    hintDimColor: 0x001866,
    hintOpacityScale: 0.75,
  },
  {
    vector: new Vector3(0, -1, 0),
    fromZ: new Euler(TAU / 4, 0, 0),
    color: 0xffff00,
    dimColor: 0x888800,
    hintColor: 0xffff00,
    hintDimColor: 0xdddd00,
    hintOpacityScale: 1.25,
  },
];

/**
 * The shape of a `stickerless` cubie, in units where a cubie's slot is exactly
 * 1 wide. A renderer for an N×N×N cube scales all of these by the width of one
 * of its slots, so that pieces of any cube are the same shape.
 */
export const cubieBodyDimensions = {
  /**
   * Half-width of a `stickerless` cubie body. Deliberately more than the 0.5
   * that would make pieces exactly fill their slot: oversized pieces press into
   * each other, which buries most of each rounded edge inside its neighbor and
   * keeps the dividing lines thin.
   */
  halfWidth: 0.54,
  /**
   * Roll at the rim of a facelet, along the axis the facelet faces — so also
   * the rounding of the puzzle's own outer edges and corners. Effectively zero,
   * which leaves those edges sharp and the plates dead flat.
   *
   * Not exactly zero: the construction lifts each face off the core box along
   * this axis, so a true zero leaves nothing to normalize in the middle of a
   * face. A few thousandths is below a pixel at any sane size.
   */
  outerAxisRadius: 0.004,
  /**
   * Rounding along an axis pointing at a neighboring piece, in the middle of an
   * edge. Sets how wide the dividing line between two pieces reads.
   */
  innerEdgeRadius: 0.07,
  /**
   * The same axis at a corner. This one rounds a facelet's corners within its
   * own plane, so it is what turns a center into a disc, and it costs no
   * thickness because the roll stays `outerAxisRadius` deep.
   */
  innerCornerRadius: 0.34,
  /** How tightly the corner rounding is pulled in toward the corners. */
  cornerSharpness: 1.3,
  /**
   * Everything above, shrunk about each piece's own center. Scaling rather than
   * trimming the half-width leaves every proportion of the piece untouched and
   * only opens a gap against its neighbors, so the pieces read as separate with
   * a thin line of the puzzle's interior showing between them.
   */
  pieceScale: 0.95,
  roundingSegments: 7,
};

/**
 * The outer half-extent a puzzle built from {@link cubieBodyDimensions} reaches,
 * in slots, for a cube `layers` slots wide. More than `layers / 2` because the
 * pieces are oversized; a renderer scales by the ratio of the two to hold the
 * puzzle to the size the camera framing expects.
 */
export function cubieBodyHalfExtent(layers: number): number {
  return (
    layers / 2 -
    0.5 +
    cubieBodyDimensions.halfWidth * cubieBodyDimensions.pieceScale
  );
}

// Stickerless pieces are molded plastic rather than a decal on a black body,
// so they need lit materials: with a flat/unlit material the bevels would be
// invisible and same-colored neighbors would merge into a single blob.
const BODY_SHININESS = 30;
const BODY_SPECULAR = 0x0a0a0a;

// `Color` converts sRGB to linear on assignment, and the renderer writes linear
// values straight out (see `RendererPool`), so every color here has to make the
// same `convertLinearToSRGB` round trip the sticker materials make — including
// the specular, which is otherwise quartered and leaves the plastic looking
// matte.
export function newBodyMaterial(color: Color | number): MeshPhongMaterial {
  return new MeshPhongMaterial({
    color:
      typeof color === "number"
        ? new Color(color).convertLinearToSRGB()
        : color,
    shininess: BODY_SHININESS,
    specular: new Color(BODY_SPECULAR).convertLinearToSRGB(),
  });
}

/**
 * The same material, but taking its color from the mesh's own vertices — for
 * renderers that put many pieces into one mesh instead of giving each facelet
 * its own material.
 */
export function newVertexColorBodyMaterial(): MeshPhongMaterial {
  const material = newBodyMaterial(0xffffff);
  material.vertexColors = true;
  return material;
}

/** Colors a stickering mask puts on a piece in place of a facelet's own. */
export const bodyMaskColors = {
  /** The plastic that shows through the grooves between pieces. */
  internal: 0x0e0e0e,
  ignored: 0x666666,
  oriented: 0x44ddcc,
  experimentalOriented2: 0xfffdaa,
  mystery: 0xf2cbcb,
};

/** The same, for hint facelets, which are lighter and partly transparent. */
export const hintMaskStyles = {
  ignored: { color: 0xcccccc, opacity: 0.75 },
  oriented: { color: 0x44ddcc, opacity: 0.5 },
  experimentalOriented2: { color: 0xfff979, opacity: 0.5 },
  mystery: { color: 0xf2cbcb, opacity: 0.5 },
};

// three divides irradiance by pi for the Lambert BRDF, and the renderer writes
// linear values out without an sRGB transfer (see `RendererPool`), so these are
// scaled to land the brightest facelet at roughly full color instead of a third
// of it.
//
// The key is directional rather than a point light, which means a flat facelet
// is lit perfectly evenly: the faces differ from each other, but nothing shades
// across a piece. That is the look of a real cube photographed under diffuse
// light, and it keeps the pieces reading as flat plates. With the key where it
// is, the three faces visible from the default camera land at about
// 1.00 / 0.93 / 0.86 of their color.
const AMBIENT_LIGHT_INTENSITY = 2.04;
const KEY_LIGHT_INTENSITY = 1.55;
// Only reach faces the key misses, so that a piece turning through the puzzle
// never goes flat black.
const FILL_LIGHT_INTENSITY = 0.3;
const RIM_LIGHT_INTENSITY = 0.3;

/**
 * The lights hang off the puzzle rather than the scene: `Twisty3DScene` is
 * shared with the other (unlit) puzzle renderers, and this way they are added
 * and removed along with the puzzle.
 */
export function addCubieBodyLighting(target: Object3D): void {
  target.add(new AmbientLight(0xffffff, AMBIENT_LIGHT_INTENSITY));
  const keyLight = new DirectionalLight(0xffffff, KEY_LIGHT_INTENSITY);
  keyLight.position.set(3, 5, 4);
  target.add(keyLight);
  const fillLight = new DirectionalLight(0xffffff, FILL_LIGHT_INTENSITY);
  fillLight.position.set(-5, 2, 3);
  target.add(fillLight);
  const rimLight = new DirectionalLight(0xffffff, RIM_LIGHT_INTENSITY);
  rimLight.position.set(-3, -2, -4);
  target.add(rimLight);
}
