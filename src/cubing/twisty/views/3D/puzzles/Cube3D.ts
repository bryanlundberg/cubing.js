import { BackSide, DoubleSide, FrontSide } from "three/src/constants.js";
import { BufferAttribute } from "three/src/core/BufferAttribute.js";
import { BufferGeometry } from "three/src/core/BufferGeometry.js";
import { Object3D } from "three/src/core/Object3D.js";
import { BoxGeometry } from "three/src/geometries/BoxGeometry.js";
import { TextureLoader } from "three/src/loaders/TextureLoader.js";
import type { Material } from "three/src/materials/Material.js";
import { MeshBasicMaterial } from "three/src/materials/MeshBasicMaterial.js";
import { Color } from "three/src/math/Color.js";
import type { Euler } from "three/src/math/Euler.js";
import { Matrix4 } from "three/src/math/Matrix4.js";
import { Quaternion } from "three/src/math/Quaternion.js";
import { Vector2 } from "three/src/math/Vector2.js";
import { Vector3 } from "three/src/math/Vector3.js";
import { Group } from "three/src/objects/Group.js";
import { Mesh } from "three/src/objects/Mesh.js";
import type { Texture } from "three/src/textures/Texture.js";
import type { KPuzzle } from "../../../../kpuzzle";
import type { ExperimentalStickeringMask } from "../../../../puzzles/cubing-private";
import type {
  FaceletMeshStickeringMask,
  StickeringMask,
} from "../../../../puzzles/stickerings/mask";
import type {
  MillisecondTimestamp,
  PuzzlePosition,
} from "../../../controllers/AnimationTypes";
import { smootherStep } from "../../../controllers/easing";
import type { FaceletScale } from "../../../model/props/puzzle/display/FaceletScaleProp";
import {
  type HintFaceletStyle,
  hintFaceletStyles,
} from "../../../model/props/puzzle/display/HintFaceletProp";
import type { InitialHintFaceletsAnimation } from "../../../model/props/puzzle/display/InitialHintFaceletsAnimationProp";
import { TAU } from "../TAU";
import { haveStartedSharingRenderers } from "../Twisty3DVantage";
import { beveledCubieGeometry } from "./BeveledCubieGeometry";
import {
  bodyMaskColors,
  type CubeFaceStyle,
  cubeFaceStyles,
  cubieBodyDimensions,
  cubieBodyHalfExtent,
  hintMaskStyles,
  newBodyMaterial,
} from "./CubieStyle";
import {
  frameMaterial,
  frameTriangles,
  newOutlineGeometry,
  outlineMaterial,
} from "./PieceOutline";
import { newLogoMesh, rectangleLogoSurface, surfaceMatrix } from "./PuzzleLogo";
import type { Twisty3DPuzzle } from "./Twisty3DPuzzle";

const svgLoader = new TextureLoader();

function newHintMaterial(style: {
  color: number;
  opacity: number;
}): MeshBasicMaterial {
  return new MeshBasicMaterial({
    color: new Color(style.color).convertLinearToSRGB(),
    side: BackSide,
    transparent: true,
    opacity: style.opacity,
  });
}

const ignoredMaterial = new MeshBasicMaterial({
  color: new Color(bodyMaskColors.ignored).convertLinearToSRGB(),
});

const ignoredMaterialHint = newHintMaterial(hintMaskStyles.ignored);

const invisibleMaterial = new MeshBasicMaterial({
  visible: false,
});

const orientedMaterial = new MeshBasicMaterial({
  color: bodyMaskColors.oriented,
});

const orientedMaterialHint = newHintMaterial(hintMaskStyles.oriented);

const experimentalOriented2Material = new MeshBasicMaterial({
  color: bodyMaskColors.experimentalOriented2,
});

const experimentalOriented2MaterialHint = newHintMaterial(
  hintMaskStyles.experimentalOriented2,
);

const mysteryMaterial = new MeshBasicMaterial({
  color: bodyMaskColors.mystery,
});

const mysterMaterialHint = newHintMaterial(hintMaskStyles.mystery);

const internalBodyMaterial = newBodyMaterial(bodyMaskColors.internal);
const ignoredBodyMaterial = newBodyMaterial(bodyMaskColors.ignored);
const orientedBodyMaterial = newBodyMaterial(bodyMaskColors.oriented);
const experimentalOriented2BodyMaterial = newBodyMaterial(
  bodyMaskColors.experimentalOriented2,
);
const mysteryBodyMaterial = newBodyMaterial(bodyMaskColors.mystery);

interface MaterialMap<T extends Material = MeshBasicMaterial>
  extends Record<FaceletMeshStickeringMask, T> {
  regular: T;
  dim: T;
  ignored: T;
  invisible: T;
}

class AxisInfo {
  public vector: Vector3;
  public fromZ: Euler;
  public stickerMaterial: MaterialMap;
  public hintStickerMaterial: MaterialMap;
  public bodyMaterial: MaterialMap;
  constructor(style: CubeFaceStyle) {
    const { color, dimColor, hintOpacityScale } = style;
    this.vector = style.vector;
    this.fromZ = style.fromZ;
    const colorLinearSRGB = new Color(color).convertLinearToSRGB();
    const dimColorLinearSRGB = new Color(dimColor).convertLinearToSRGB();
    // TODO: Make sticker material single-sided when cubie foundation is opaque?
    this.stickerMaterial = {
      regular: new MeshBasicMaterial({
        color: colorLinearSRGB,
        side: FrontSide, // TODO: set to `DoubleSide` when hint facelets are disabled.
      }),
      dim: new MeshBasicMaterial({
        color: dimColorLinearSRGB,
        side: FrontSide, // TODO: set to `DoubleSide` when hint facelets are disabled.
      }),
      oriented: orientedMaterial,
      experimentalOriented2: experimentalOriented2Material,
      ignored: ignoredMaterial,
      invisible: invisibleMaterial,
      mystery: mysteryMaterial,
    };
    this.hintStickerMaterial = {
      regular: newHintMaterial({
        color: style.hintColor,
        opacity: 0.5 * hintOpacityScale,
      }),
      dim: newHintMaterial({
        color: style.hintDimColor,
        opacity: 0.5 * hintOpacityScale,
      }),
      oriented: orientedMaterialHint,
      experimentalOriented2: experimentalOriented2MaterialHint,
      ignored: ignoredMaterialHint,
      invisible: invisibleMaterial,
      mystery: mysterMaterialHint,
    };
    this.bodyMaterial = {
      regular: newBodyMaterial(colorLinearSRGB),
      dim: newBodyMaterial(dimColorLinearSRGB),
      oriented: orientedBodyMaterial,
      experimentalOriented2: experimentalOriented2BodyMaterial,
      ignored: ignoredBodyMaterial,
      // A solid piece of plastic can't have a hole punched in it, so an
      // invisible facelet falls back to the internal plastic color.
      invisible: internalBodyMaterial,
      mystery: mysteryBodyMaterial,
    };
  }
}

const axesInfo: AxisInfo[] = cubeFaceStyles.map((style) => new AxisInfo(style));

const face: { [s: string]: number } = {
  U: 0,
  L: 1,
  F: 2,
  R: 3,
  B: 4,
  D: 5,
};

const familyToAxis: { [s: string]: number } = {
  U: face["U"],
  u: face["U"],
  Uw: face["U"],
  Uv: face["U"],
  y: face["U"],
  L: face["L"],
  l: face["L"],
  Lw: face["L"],
  Lv: face["L"],
  M: face["L"],
  F: face["F"],
  f: face["F"],
  Fw: face["F"],
  Fv: face["F"],
  S: face["F"],
  z: face["F"],
  R: face["R"],
  r: face["R"],
  Rw: face["R"],
  Rv: face["R"],
  x: face["R"],
  B: face["B"],
  b: face["B"],
  Bw: face["B"],
  Bv: face["B"],
  D: face["D"],
  d: face["D"],
  Dw: face["D"],
  Dv: face["D"],
  E: face["D"],
};

const cubieDimensions = {
  // stickerWidth: 0.85, // Now `faceletScale` in options.
  stickerElevation: 0.503,
  foundationWidth: 1,
  defaultHintStickerElevation: 1.45,
  /**
   * How far back the eight corners of a `stickerless` cubie are shaved, from 0
   * (not at all) to 1 (all the way back to the edges). This is the only knob
   * that widens the notch where four pieces meet without also widening the
   * straight dividing lines.
   */
  bodyVertexCut: 0.45,
};

/**
 * The piece a logo is printed on: the white center, which is `CENTERS` piece 0
 * showing its only facelet.
 */
const LOGO_PIECE = { orbit: "CENTERS", ord: 0, faceletIdx: 0 };
/** How far the logo floats off the face, in cubie widths. */
const LOGO_ELEVATION = 0.01;

const EXPERIMENTAL_PICTURE_CUBE_HINT_ELEVATION = 2;

/**
 * - `stickers`: flat colored facelets floating above a black body.
 * - `stickerless`: solid beveled pieces of colored plastic, lit so that the
 *   bevels read as volume. `showFoundation` and `faceletScale` do not apply,
 *   since there is no separate foundation or sticker to size.
 */
export type ExperimentalCubieStyle = "stickers" | "stickerless";

export interface Cube3DOptions {
  showMainStickers?: boolean;
  experimentalCubieStyle?: ExperimentalCubieStyle;
  hintFacelets?: HintFaceletStyle;
  showFoundation?: boolean; // TODO: better name
  experimentalStickeringMask?: ExperimentalStickeringMask;
  foundationSprite?: Texture | null;
  hintSprite?: Texture | null;
  initialHintFaceletsAnimation?: InitialHintFaceletsAnimation;
  faceletScale?: "auto" | number;
  hintFaceletsElevation?: "auto" | number;
}

const cube3DOptionsDefaults: Cube3DOptions = {
  showMainStickers: true,
  experimentalCubieStyle: "stickerless",
  hintFacelets: "floating",
  showFoundation: true,
  experimentalStickeringMask: undefined,
  foundationSprite: null,
  hintSprite: null,
  initialHintFaceletsAnimation: "auto",
  faceletScale: "auto",
  hintFaceletsElevation: "auto",
};

const DEFAULT_STICKER_SCALE = 0.85;
function getFaceletScale(options: Cube3DOptions): number {
  if (
    typeof options.faceletScale === "undefined" ||
    options.faceletScale === "auto"
  ) {
    return DEFAULT_STICKER_SCALE;
  }
  return options.faceletScale;
}

// TODO: Make internal foundation faces one-sided, facing to the outside of the cube.
const blackMesh = new MeshBasicMaterial({
  color: 0x000000,
  opacity: 1,
  transparent: true,
});

const blackTranslucentMesh = new MeshBasicMaterial({
  color: 0x000000,
  opacity: 0.3,
  transparent: true,
});

class CubieDef {
  public matrix: Matrix4;
  public stickerFaces: number[];
  // stickerFaceNames can be e.g. ["U", "F", "R"], "UFR" if every face is a single letter.
  constructor(
    public orbit: string,
    stickerFaceNames: string[] | string,
    q: Quaternion,
  ) {
    const individualStickerFaceNames =
      typeof stickerFaceNames === "string"
        ? stickerFaceNames.split("")
        : stickerFaceNames;
    this.stickerFaces = individualStickerFaceNames.map((s) => face[s]);
    this.matrix = new Matrix4();
    this.matrix.setPosition(firstPiecePosition[orbit]);
    this.matrix.premultiply(new Matrix4().makeRotationFromQuaternion(q));
  }
}

function t(v: Vector3, t4: number): Quaternion {
  return new Quaternion().setFromAxisAngle(v, (TAU * t4) / 4);
}

const r = {
  O: new Vector3(0, 0, 0),
  U: new Vector3(0, -1, 0),
  L: new Vector3(1, 0, 0),
  F: new Vector3(0, 0, -1),
  R: new Vector3(-1, 0, 0),
  B: new Vector3(0, 0, 1),
  D: new Vector3(0, 1, 0),
};

interface OrbitIndexed<T> {
  [s: string]: T;
}
type PieceIndexed<T> = OrbitIndexed<T[]>;

const firstPiecePosition: OrbitIndexed<Vector3> = {
  EDGES: new Vector3(0, 1, 1),
  CORNERS: new Vector3(1, 1, 1),
  CENTERS: new Vector3(0, 1, 0),
};
const orientationRotation: OrbitIndexed<Matrix4[]> = {
  EDGES: [0, 1].map((i) =>
    new Matrix4().makeRotationAxis(
      firstPiecePosition["EDGES"].clone().normalize(),
      (-i * TAU) / 2,
    ),
  ),
  CORNERS: [0, 1, 2].map((i) =>
    new Matrix4().makeRotationAxis(
      firstPiecePosition["CORNERS"].clone().normalize(),
      (-i * TAU) / 3,
    ),
  ),
  CENTERS: [0, 1, 2, 3].map((i) =>
    new Matrix4().makeRotationAxis(
      firstPiecePosition["CENTERS"].clone().normalize(),
      (-i * TAU) / 4,
    ),
  ),
};
const cubieStickerOrder = [face["U"], face["F"], face["R"]];

const pieceDefs: PieceIndexed<CubieDef> = {
  EDGES: [
    new CubieDef("EDGES", "UF", t(r.O, 0)),
    new CubieDef("EDGES", "UR", t(r.U, 3)),
    new CubieDef("EDGES", "UB", t(r.U, 2)),
    new CubieDef("EDGES", "UL", t(r.U, 1)),
    new CubieDef("EDGES", "DF", t(r.F, 2)),
    new CubieDef("EDGES", "DR", t(r.F, 2).premultiply(t(r.D, 1))),
    new CubieDef("EDGES", "DB", t(r.F, 2).premultiply(t(r.D, 2))),
    new CubieDef("EDGES", "DL", t(r.F, 2).premultiply(t(r.D, 3))),
    new CubieDef("EDGES", "FR", t(r.U, 3).premultiply(t(r.R, 3))),
    new CubieDef("EDGES", "FL", t(r.U, 1).premultiply(t(r.R, 3))),
    new CubieDef("EDGES", "BR", t(r.U, 3).premultiply(t(r.R, 1))),
    new CubieDef("EDGES", "BL", t(r.U, 1).premultiply(t(r.R, 1))),
  ],
  CORNERS: [
    new CubieDef("CORNERS", "UFR", t(r.O, 0)),
    new CubieDef("CORNERS", "URB", t(r.U, 3)),
    new CubieDef("CORNERS", "UBL", t(r.U, 2)),
    new CubieDef("CORNERS", "ULF", t(r.U, 1)),
    new CubieDef("CORNERS", "DRF", t(r.F, 2).premultiply(t(r.D, 1))),
    new CubieDef("CORNERS", "DFL", t(r.F, 2).premultiply(t(r.D, 0))),
    new CubieDef("CORNERS", "DLB", t(r.F, 2).premultiply(t(r.D, 3))),
    new CubieDef("CORNERS", "DBR", t(r.F, 2).premultiply(t(r.D, 2))),
  ],
  CENTERS: [
    new CubieDef("CENTERS", "U", t(r.O, 0)),
    new CubieDef("CENTERS", "L", t(r.R, 3).premultiply(t(r.U, 1))),
    new CubieDef("CENTERS", "F", t(r.R, 3)),
    new CubieDef("CENTERS", "R", t(r.R, 3).premultiply(t(r.D, 1))),
    new CubieDef("CENTERS", "B", t(r.R, 3).premultiply(t(r.D, 2))),
    new CubieDef("CENTERS", "D", t(r.R, 2)),
  ],
};

const CUBE_SCALE = 1 / 3;

// Oversized `stickerless` pieces push the puzzle past the ±1.5 half-extent that
// `CUBE_SCALE` and the camera framing assume, so scale it back to the same outer
// size. Reduces to `CUBE_SCALE` at a half-width of 0.5.
function cubeScale(stickerless: boolean): number {
  return stickerless ? 0.5 / cubieBodyHalfExtent(3) : CUBE_SCALE;
}

interface FaceletInfo {
  faceIdx: number;
  facelet: Mesh;
  hintFacelet?: Mesh;
  hintFrame?: Mesh;
  /**
   * Set in `stickerless` mode, where the facelet is one material group of the
   * shared cubie body instead of a mesh of its own.
   */
  bodyMaterialIndex?: number;
}

// TODO: Compatibility with Randelshofer or standard net layout? Offer a
// conversion function?
const pictureStickerCoords: Record<string, number[][][]> = {
  EDGES: [
    [
      [0, 4, 6],
      [0, 4, 5],
    ],
    [
      [3, 5, 7],
      [0, 7, 5],
    ],
    [
      [2, 4, 8],
      [0, 10, 5],
    ],
    [
      [1, 3, 7],
      [0, 1, 5],
    ],
    [
      [2, 4, 2],
      [2, 4, 3],
    ],
    [
      [3, 5, 1],
      [2, 7, 3],
    ],
    [
      [0, 4, 0],
      [2, 10, 3],
    ],
    [
      [1, 3, 1],
      [2, 1, 3],
    ],
    [
      [3, 5, 4],
      [3, 6, 4],
    ],
    [
      [1, 3, 4],
      [1, 2, 4],
    ],
    [
      [1, 9, 4],
      [1, 8, 4],
    ],
    [
      [3, 11, 4],
      [3, 0, 4],
    ],
  ],
  CORNERS: [
    [
      [0, 5, 6],
      [0, 5, 5],
      [0, 6, 5],
    ],
    [
      [3, 5, 8],
      [0, 8, 5],
      [0, 9, 5],
    ],
    [
      [2, 3, 8],
      [0, 11, 5],
      [0, 0, 5],
    ],
    [
      [1, 3, 6],
      [0, 2, 5],
      [0, 3, 5],
    ],
    [
      [3, 5, 2],
      [2, 6, 3],
      [2, 5, 3],
    ],
    [
      [2, 3, 2],
      [2, 3, 3],
      [2, 2, 3],
    ],
    [
      [1, 3, 0],
      [2, 0, 3],
      [2, 11, 3],
    ],
    [
      [0, 5, 0],
      [2, 9, 3],
      [2, 8, 3],
    ],
  ],
  CENTERS: [
    [[0, 4, 7]],
    [[0, 1, 4]],
    [[0, 4, 4]],
    [[0, 7, 4]],
    [[0, 10, 4]],
    [[0, 4, 1]],
  ],
};

let sharedCubieFoundationGeometryCache: BoxGeometry | null = null;
function sharedCubieFoundationGeometry(): BoxGeometry {
  return (
    sharedCubieFoundationGeometryCache ??
    (sharedCubieFoundationGeometryCache = new BoxGeometry(
      cubieDimensions.foundationWidth,
      cubieDimensions.foundationWidth,
      cubieDimensions.foundationWidth,
    ))
  );
}

function newStickerGeometry(): BufferGeometry {
  const r = new BufferGeometry();
  const half = 0.5;
  r.setAttribute(
    "position",
    new BufferAttribute(
      new Float32Array([
        half,
        half,
        0,
        -half,
        half,
        0,
        half,
        -half,
        0,
        -half,
        half,
        0,
        -half,
        -half,
        0,
        half,
        -half,
        0,
      ]),
      3,
    ),
  );
  r.setAttribute(
    "uv",
    new BufferAttribute(
      new Float32Array([
        1, 1, 0, 1, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 1, 1,
      ]),
      2,
    ),
  );
  //  r.setAttribute('normals', new BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]), 3));
  return r;
}

// Keyed by orbit: every cubie in an orbit has its outward faces along the same
// local axes, so they all share one body.
const cubieBodyGeometryCache = new Map<string, BufferGeometry>();
function cubieBodyGeometry(orbit: string, outerAxes: number[]): BufferGeometry {
  const cached = cubieBodyGeometryCache.get(orbit);
  if (cached) {
    return cached;
  }
  const scale = cubieBodyDimensions.pieceScale;
  // The material groups come out indexed like `axesInfo`, so a facelet's group
  // is the index of the local axis it sits on, and the outward faces are just
  // the axes this orbit's stickers sit on.
  const geometry = beveledCubieGeometry(
    axesInfo.map((axisInfo) => axisInfo.vector),
    outerAxes,
    cubieBodyDimensions.halfWidth * scale,
    cubieBodyDimensions.outerAxisRadius * scale,
    cubieBodyDimensions.innerEdgeRadius * scale,
    cubieBodyDimensions.innerCornerRadius * scale,
    cubieBodyDimensions.cornerSharpness,
    cubieBodyDimensions.roundingSegments,
  );
  cubieBodyGeometryCache.set(orbit, geometry);
  return geometry;
}

const cubieOutlineGeometryCache = new Map<string, BufferGeometry>();
function cubieOutlineGeometry(
  orbit: string,
  body: BufferGeometry,
): BufferGeometry {
  let geometry = cubieOutlineGeometryCache.get(orbit);
  if (!geometry) {
    geometry = newOutlineGeometry(body, cubeScale(true));
    cubieOutlineGeometryCache.set(orbit, geometry);
  }
  return geometry;
}

let sharedStickerGeometryCache: BufferGeometry | undefined;
function sharedStickerGeometry(): BufferGeometry {
  return (sharedStickerGeometryCache ??= newStickerGeometry());
}

// TODO: Split into "scene model" and "view".
export class Cube3D extends Object3D implements Twisty3DPuzzle {
  kpuzzleFaceletInfo: Record<string, FaceletInfo[][]>;
  private pieces: PieceIndexed<Object3D> = {};
  private options: Cube3DOptions;
  // TODO: Keep track of option-based meshes better.
  private experimentalHintStickerMeshes: Mesh[] = [];
  private experimentalFoundationMeshes: Mesh[] = [];

  #setSpriteURL: ((url: string) => void) | undefined;
  private sprite: Texture | Promise<Texture> = new Promise((resolve) => {
    this.#setSpriteURL = (url: string): void => {
      svgLoader.load(url, resolve);
    };
  });

  // TODO: Don't overwrite the static function.
  // TODO: This doesn't work dynamically yet.
  setSprite(texture: Texture): void {
    this.sprite = texture;
  }

  #setHintSpriteURL: ((url: string) => void) | undefined;
  private hintSprite: Texture | Promise<Texture> = new Promise((resolve) => {
    this.#setHintSpriteURL = (url: string): void => {
      svgLoader.load(url, resolve);
    };
  });

  // TODO: Don't overwrite the static function.
  // TODO: This doesn't work dynamically yet.
  setHintSprite(texture: Texture): void {
    this.hintSprite = texture;
  }

  constructor(
    private kpuzzle: KPuzzle,
    private scheduleRenderCallback?: () => void,
    options: Cube3DOptions = {},
  ) {
    super();

    this.options = { ...cube3DOptionsDefaults };
    Object.assign(this.options, options); // TODO: check if this works

    if (this.kpuzzle.name() !== "3x3x3") {
      throw new Error(
        `Invalid puzzle for this Cube3D implementation: ${this.kpuzzle.name()}`,
      );
    }

    if (options.foundationSprite) {
      this.setSprite(options.foundationSprite);
    }
    if (options.hintSprite) {
      this.setHintSprite(options.hintSprite);
    }

    this.kpuzzleFaceletInfo = {};
    for (const orbit in pieceDefs) {
      const orbitFaceletInfo: FaceletInfo[][] = [];
      this.kpuzzleFaceletInfo[orbit] = orbitFaceletInfo;
      this.pieces[orbit] = pieceDefs[orbit].map(
        this.createCubie.bind(this, orbit, orbitFaceletInfo),
      );
    }
    const scale = cubeScale(this.#stickerless());
    this.scale.set(scale, scale, scale);

    // TODO: Can we construct this directly instead of applying it later? Would that be more code-efficient?
    if (this.options.experimentalStickeringMask) {
      this.setStickeringMask(this.options.experimentalStickeringMask);
    }
    void this.#animateRaiseHintFacelets();

    if (this.options.faceletScale) {
      this.experimentalSetFaceletScale(this.options.faceletScale);
    }

    if (typeof this.options["hintFaceletsElevation"] !== "undefined") {
      this.#elevationRequest = this.options.hintFaceletsElevation;
    }
  }

  #sharedHintStickerGeometryCache: BufferGeometry | undefined;
  #sharedHintStickerGeometry(): BufferGeometry {
    return (this.#sharedHintStickerGeometryCache ??= newStickerGeometry());
  }

  #sharedHintFrameGeometryCache: BufferGeometry | undefined;
  #sharedHintFrameGeometry(): BufferGeometry {
    if (!this.#sharedHintFrameGeometryCache) {
      const geometry = new BufferGeometry();
      geometry.setAttribute(
        "position",
        new BufferAttribute(
          new Float32Array(
            frameTriangles(
              newStickerGeometry(),
              cubeScale(this.#stickerless()) * getFaceletScale(this.options),
            ),
          ),
          3,
        ),
      );
      // Level with the hint facelets, wherever their elevation has them.
      geometry.translate(
        0,
        0,
        this.#sharedHintStickerGeometry().getAttribute("position").getZ(0),
      );
      this.#sharedHintFrameGeometryCache = geometry;
    }
    return this.#sharedHintFrameGeometryCache;
  }

  #elevationRequest: "auto" | number | undefined;
  setHintFaceletsElevation(elevation: "auto" | number) {
    if (elevation === this.#elevationRequest) {
      return;
    }
    this.#cancelAnimateRaiseHintSticker = true;
    this.#setHintFaceletsElevation(
      typeof elevation === "number"
        ? elevation
        : cubieDimensions.defaultHintStickerElevation,
    );
    this.#elevationRequest = elevation;
  }

  #lastHintStickerElevation = 0;
  #setHintFaceletsElevation(elevation: number) {
    this.#sharedHintStickerGeometry().translate(
      0,
      0,
      elevation - this.#lastHintStickerElevation,
    );
    this.#sharedHintFrameGeometryCache?.translate(
      0,
      0,
      elevation - this.#lastHintStickerElevation,
    );
    this.#lastHintStickerElevation = elevation;
  }

  // TODO: support smooth physics
  #cancelAnimateRaiseHintSticker = false;
  // TODO: Generalize this into an animation mechanism.
  async #animateRaiseHintFacelets(): Promise<void> {
    if (
      this.options.initialHintFaceletsAnimation === "none" ||
      (this.options.initialHintFaceletsAnimation !== "always" &&
        haveStartedSharingRenderers())
    ) {
      return;
    }
    const targetElevation =
      typeof this.options.hintFaceletsElevation !== "undefined" &&
      this.options.hintFaceletsElevation !== "auto"
        ? this.options.hintFaceletsElevation
        : cubieDimensions.defaultHintStickerElevation;
    const translationRange = targetElevation - cubieDimensions.stickerElevation;
    this.#setHintFaceletsElevation(cubieDimensions.stickerElevation);

    // TODO: constant/config
    await new Promise((resolve) => setTimeout(resolve, 500));

    const hintStartTime = performance.now();
    // TODO: constant/config
    const translationDuration = 1000 as MillisecondTimestamp;
    function ease(x: number) {
      return x * (2 - x);
    }
    const animateRaiseHintSticker = () => {
      if (this.#cancelAnimateRaiseHintSticker) {
        return;
      }
      const elapsed = performance.now() - hintStartTime;
      const fraction = Math.min(elapsed / translationDuration, 1);
      const newTranslation =
        ease(fraction) * translationRange + cubieDimensions.stickerElevation;
      this.#setHintFaceletsElevation(newTranslation);

      this.scheduleRenderCallback?.();
      if (elapsed < translationDuration) {
        requestAnimationFrame(animateRaiseHintSticker);
      }
    };
    animateRaiseHintSticker();
  }

  // Can only be called once.
  /** @deprecated */
  experimentalSetStickerSpriteURL(stickerSpriteURL: string): void {
    this.#setSpriteURL?.(stickerSpriteURL);
  }

  // Can only be called once.
  /** @deprecated */
  experimentalSetHintStickerSpriteURL(hintStickerSpriteURL: string): void {
    this.#setHintSpriteURL?.(hintStickerSpriteURL);
  }

  #stickerless(): boolean {
    return this.options.experimentalCubieStyle === "stickerless";
  }

  #setFaceletMaterial(
    faceletInfo: FaceletInfo,
    mask: FaceletMeshStickeringMask,
  ): void {
    const axisInfo = axesInfo[faceletInfo.faceIdx];
    const { bodyMaterialIndex } = faceletInfo;
    if (bodyMaterialIndex === undefined) {
      faceletInfo.facelet.material = axisInfo.stickerMaterial[mask];
    } else {
      // The facelet shares its mesh with the rest of the piece, so only its own
      // material group can change.
      (faceletInfo.facelet.material as Material[])[bodyMaterialIndex] =
        axisInfo.bodyMaterial[mask];
    }
  }

  #setHintMaterial(faceletInfo: FaceletInfo, material: Material): void {
    if (faceletInfo.hintFacelet) {
      faceletInfo.hintFacelet.material = material;
    }
    if (faceletInfo.hintFrame) {
      faceletInfo.hintFrame.visible = material !== invisibleMaterial;
    }
  }

  setStickeringMask(stickeringMask: StickeringMask): void {
    if (stickeringMask.specialBehaviour === "picture") {
      // TODO: if the latest stickering mask was already "picture", don't redo work.
      for (const pieceInfos of Object.values(this.kpuzzleFaceletInfo)) {
        for (const faceletInfos of pieceInfos) {
          for (const faceletInfo of faceletInfos) {
            this.#setFaceletMaterial(faceletInfo, "invisible");
            this.#setHintMaterial(faceletInfo, invisibleMaterial);
          }
        }
      }
      return;
    }
    this.options.experimentalStickeringMask = stickeringMask;
    for (const [orbitName, orbitStickeringMask] of Object.entries(
      stickeringMask.orbits,
    )) {
      for (
        let pieceIdx = 0;
        pieceIdx < orbitStickeringMask.pieces.length;
        pieceIdx++
      ) {
        const pieceStickeringMask = orbitStickeringMask.pieces[pieceIdx];
        if (pieceStickeringMask) {
          const pieceInfo = this.kpuzzleFaceletInfo[orbitName][pieceIdx];
          for (
            let faceletIdx = 0;
            faceletIdx < pieceInfo.length;
            faceletIdx++
          ) {
            const faceletStickeringMask =
              pieceStickeringMask.facelets[faceletIdx];
            if (faceletStickeringMask) {
              const faceletInfo = pieceInfo[faceletIdx];

              const stickeringMask =
                typeof faceletStickeringMask === "string"
                  ? faceletStickeringMask
                  : faceletStickeringMask?.mask;

              this.#setFaceletMaterial(faceletInfo, stickeringMask);
              // TODO
              const hintStickeringMask =
                typeof faceletStickeringMask === "string"
                  ? stickeringMask
                  : (faceletStickeringMask.hintMask ?? stickeringMask);
              this.#setHintMaterial(
                faceletInfo,
                axesInfo[faceletInfo.faceIdx].hintStickerMaterial[
                  hintStickeringMask
                ],
              );
            }
          }
        }
      }
    }
    if (this.scheduleRenderCallback) {
      this.scheduleRenderCallback();
    }
  }

  /** @deprecated */
  public experimentalUpdateOptions(options: Cube3DOptions): void {
    if ("showMainStickers" in options) {
      throw new Error("Unimplemented");
    }

    const showFoundation = options.showFoundation;
    if (
      typeof showFoundation !== "undefined" &&
      this.options.showFoundation !== showFoundation
    ) {
      this.options.showFoundation = showFoundation;
      for (const foundation of this.experimentalFoundationMeshes) {
        foundation.visible = showFoundation;
      }
    }

    const hintFacelets = options.hintFacelets;
    if (
      typeof hintFacelets !== "undefined" &&
      this.options.hintFacelets !== hintFacelets &&
      hintFaceletStyles[hintFacelets] // TODO: test this
    ) {
      this.options.hintFacelets = hintFacelets;
      for (const hintSticker of this.experimentalHintStickerMeshes) {
        hintSticker.visible = hintFacelets === "floating";
      }
      this.scheduleRenderCallback!(); // TODO
    }

    const { experimentalStickeringMask } = options;
    if (typeof experimentalStickeringMask !== "undefined") {
      this.options.experimentalStickeringMask = experimentalStickeringMask;
      this.setStickeringMask(experimentalStickeringMask);
      this.scheduleRenderCallback!(); // TODO
    }

    const { faceletScale } = options;
    if (typeof faceletScale !== "undefined") {
      this.experimentalSetFaceletScale(faceletScale);
    }

    const { hintFaceletsElevation } = options;
    if (typeof hintFaceletsElevation !== "undefined") {
      this.setHintFaceletsElevation(hintFaceletsElevation);
    }
  }

  #lastPosition: PuzzlePosition | null = null;
  public onPositionChange(p: PuzzlePosition): void {
    this.#lastPosition = p;
    const reid333 = p.pattern;
    for (const orbit in pieceDefs) {
      const pieces = pieceDefs[orbit];
      for (let i = 0; i < pieces.length; i++) {
        const j = reid333.patternData[orbit].pieces[i];
        this.pieces[orbit][j].matrix.copy(pieceDefs[orbit][i].matrix);
        this.pieces[orbit][j].matrix.multiply(
          orientationRotation[orbit][reid333.patternData[orbit].orientation[i]],
        );
      }
      for (const moveProgress of p.movesInProgress) {
        const move = moveProgress.move;
        const turnNormal = axesInfo[familyToAxis[move.family]].vector;
        const moveMatrix = new Matrix4().makeRotationAxis(
          turnNormal,
          (-this.ease(moveProgress.fraction) *
            moveProgress.direction *
            move.amount *
            TAU) /
            4,
        );
        // Loop-invariant: this depends only on `move`, so computing it inside
        // the piece loop rebuilt a `Move` and a `KTransformation` per piece per
        // frame.
        const orbitTransformationData = this.kpuzzle.moveToTransformation(
          move.modified({ amount: 1 }),
        ).transformationData[orbit];
        const { permutation, orientationDelta } = orbitTransformationData;
        for (let i = 0; i < pieces.length; i++) {
          if (i !== permutation[i] || orientationDelta[i] !== 0) {
            const j = reid333.patternData[orbit].pieces[i];
            this.pieces[orbit][j].matrix.premultiply(moveMatrix);
          }
        }
      }
    }
    // After the pieces, since the logo rides on one of them.
    this.#placeLogo(p);
    this.scheduleRenderCallback!();
  }

  // TODO: Always create (but sometimes hide parts) so we can show them later,
  // or (better) support creating puzzle parts on demand.
  private createCubie(
    orbit: string,
    orbitFacelets: FaceletInfo[][],
    piece: CubieDef,
    orbitPieceIdx: number,
  ): Object3D {
    const cubieFaceletInfo: FaceletInfo[] = [];
    orbitFacelets.push(cubieFaceletInfo);
    const cubie = new Group();
    // In `stickerless` mode the whole piece is one solid mesh, and each of its
    // six material groups is either an outward facelet color or the internal
    // plastic that shows through the grooves.
    const body = this.#stickerless()
      ? new Mesh(
          cubieBodyGeometry(
            orbit,
            cubieStickerOrder.slice(0, piece.stickerFaces.length),
          ),
          axesInfo.map(() => internalBodyMaterial as Material),
        )
      : null;
    if (body) {
      cubie.add(body);
      cubie.add(
        new Mesh(cubieOutlineGeometry(orbit, body.geometry), outlineMaterial()),
      );
    } else if (this.options.showFoundation) {
      const foundation = this.createCubieFoundation();
      cubie.add(foundation);
      this.experimentalFoundationMeshes.push(foundation);
    }
    for (let i = 0; i < piece.stickerFaces.length; i++) {
      const faceIdx = piece.stickerFaces[i];
      const faceletInfo: FaceletInfo = body
        ? { faceIdx, facelet: body, bodyMaterialIndex: cubieStickerOrder[i] }
        : {
            faceIdx,
            facelet: this.createSticker(
              axesInfo[cubieStickerOrder[i]],
              axesInfo[faceIdx],
              false,
            ),
          };
      if (body) {
        (body.material as Material[])[cubieStickerOrder[i]] =
          axesInfo[faceIdx].bodyMaterial.regular;
      } else {
        cubie.add(faceletInfo.facelet);
      }
      if (this.options.hintFacelets === "floating") {
        const hintSticker = this.createSticker(
          axesInfo[cubieStickerOrder[i]],
          axesInfo[faceIdx],
          true,
        );
        cubie.add(hintSticker);
        faceletInfo.hintFacelet = hintSticker;
        if (
          this.options.experimentalStickeringMask?.specialBehaviour !==
          "picture"
        ) {
          faceletInfo.hintFrame = new Mesh(
            this.#sharedHintFrameGeometry(),
            frameMaterial(),
          );
          hintSticker.add(faceletInfo.hintFrame);
        }
        this.experimentalHintStickerMeshes.push(hintSticker);
      }

      if (
        this.options.experimentalStickeringMask?.specialBehaviour ===
          "picture" &&
        pictureStickerCoords[orbit] &&
        pictureStickerCoords[orbit][orbitPieceIdx] &&
        pictureStickerCoords[orbit][orbitPieceIdx][i]
      ) {
        const [rotate, offsetX, offsetY] =
          pictureStickerCoords[orbit][orbitPieceIdx][i];
        void (async () => {
          const addImageSticker = async (hint: boolean) => {
            const texture: Texture = await (hint
              ? this.hintSprite
              : this.sprite);

            const mesh = this.createSticker(
              axesInfo[cubieStickerOrder[i]],
              axesInfo[piece.stickerFaces[i]],
              hint,
            );
            mesh.material = new MeshBasicMaterial({
              map: texture,
              side: hint ? BackSide : DoubleSide,
              transparent: true,
            });

            const x1 = offsetX / 12;
            const x2 = (offsetX + 1) / 12;
            const y1 = offsetY / 9;
            const y2 = (offsetY + 1) / 9;

            let v1 = new Vector2(x1, y1);
            let v2 = new Vector2(x1, y2);
            let v3 = new Vector2(x2, y2);
            let v4 = new Vector2(x2, y1);

            switch (rotate) {
              case 1: {
                [v1, v2, v3, v4] = [v2, v3, v4, v1];
                break;
              }
              case 2: {
                [v1, v2, v3, v4] = [v3, v4, v1, v2];
                break;
              }
              case 3: {
                [v1, v2, v3, v4] = [v4, v1, v2, v3];
                break;
              }
            }
            mesh.geometry.setAttribute(
              "uv",
              new BufferAttribute(
                new Float32Array([
                  v3.x,
                  v3.y,
                  v2.x,
                  v2.y,
                  v4.x,
                  v4.y,
                  v2.x,
                  v2.y,
                  v1.x,
                  v1.y,
                  v4.x,
                  v4.y,
                ]),
                2,
              ),
            );
            cubie.add(mesh);
          };
          // const delay: number = ({
          //   CENTERS: 1000,
          //   EDGES: 2000,
          //   CORNERS: 3500,
          // } as Record<string, number>)[orbit];
          // if (orbit === "CENTERS" && orbitPieceIdx === 5) {
          void addImageSticker(true);
          void addImageSticker(false);
          // } else {
          //   await this.sprite;
          //   await this.hintSprite;
          //   setTimeout(
          //     () => addImageSticker(true),
          //     delay + orbitPieceIdx * 100,
          //   );
          //   setTimeout(
          //     () => addImageSticker(false),
          //     delay + orbitPieceIdx * 100,
          //   );
          // }
        })();
      }

      cubieFaceletInfo.push(faceletInfo);
    }
    cubie.matrix.copy(piece.matrix);
    cubie.matrixAutoUpdate = false;
    this.add(cubie);
    return cubie;
  }

  // TODO: Support creating only the outward-facing parts?
  private createCubieFoundation(): Mesh {
    const box = sharedCubieFoundationGeometry();
    return new Mesh(
      box,
      this.options.experimentalStickeringMask?.specialBehaviour === "picture"
        ? blackMesh
        : blackTranslucentMesh,
    );
  }

  private createSticker(
    posAxisInfo: AxisInfo,
    materialAxisInfo: AxisInfo,
    isHint: boolean,
  ): Mesh {
    const geo =
      this.options.experimentalStickeringMask?.specialBehaviour === "picture"
        ? newStickerGeometry()
        : isHint
          ? this.#sharedHintStickerGeometry()
          : sharedStickerGeometry();
    const stickerMesh = new Mesh(
      geo,
      isHint
        ? materialAxisInfo.hintStickerMaterial.regular
        : materialAxisInfo.stickerMaterial.regular,
    );
    stickerMesh.setRotationFromEuler(posAxisInfo.fromZ);
    stickerMesh.position.copy(posAxisInfo.vector);

    const elevation = (() => {
      if (!isHint) {
        return cubieDimensions.stickerElevation;
      }
      if (typeof this.options.hintFaceletsElevation === "number") {
        return this.options.hintFaceletsElevation;
      }
      if (
        this.options.experimentalStickeringMask?.specialBehaviour === "picture"
      ) {
        return EXPERIMENTAL_PICTURE_CUBE_HINT_ELEVATION;
      }
      return cubieDimensions.defaultHintStickerElevation;
    })();
    if (isHint) {
      this.#lastHintStickerElevation = elevation;
    }
    const scale = getFaceletScale(this.options);
    stickerMesh.scale.setX(scale);
    stickerMesh.scale.setY(scale);
    stickerMesh.translateZ(elevation - 1);
    return stickerMesh;
  }

  #logoMesh: Mesh | null = null;
  /** The logo's placement on its facelet, in the piece's own frame. */
  #logoSurface: Matrix4 | null = null;
  #logoPieceMatrix = new Matrix4();
  /**
   * Prints a logo on the white center, or takes it off again when passed
   * `null`.
   *
   * The image is stretched onto a square sized to the piece, so its own
   * proportions don't matter. It rides the piece, so a rotation of the whole
   * cube carries it to whichever face the white center ends up on.
   */
  experimentalSetLogo(texture: Texture | null): void {
    if (this.#logoMesh) {
      this.#logoMesh.removeFromParent();
      (this.#logoMesh.material as MeshBasicMaterial).dispose();
      this.#logoMesh = null;
      this.#logoSurface = null;
    }
    if (texture) {
      // The facelet's own axis in cubie-local coordinates, which for the first
      // facelet of a piece is the first of `cubieStickerOrder`.
      const normal = axesInfo[cubieStickerOrder[LOGO_PIECE.faceletIdx]].vector;
      const u = new Vector3(normal.y, normal.z, normal.x);
      const v = new Vector3().crossVectors(normal, u);
      const surface = rectangleLogoSurface(
        normal.clone().multiplyScalar(this.#faceletDistance() + LOGO_ELEVATION),
        // Half-axes of the facelet, which is one cubie wide.
        u.multiplyScalar(0.5),
        v.multiplyScalar(0.5),
      );
      this.#logoMesh = newLogoMesh(texture);
      this.#logoSurface = surfaceMatrix(surface, new Matrix4());
      this.add(this.#logoMesh);
      if (this.#lastPosition) {
        this.#placeLogo(this.#lastPosition);
      }
    }
    this.scheduleRenderCallback?.();
  }

  /**
   * Puts the logo where its piece is.
   *
   * Almost all of this is the piece's own matrix, but not quite: the 3×3×3's
   * `KPuzzle` does not track how a center is turned (`orientationMod` is 1),
   * so a `U` ends in the state it started in as far as the white center is
   * concerned. Riding that animation would spin the logo through the turn and
   * snap it back at the end, so a move that leaves the piece in its own slot
   * leaves the logo alone. A move that carries the piece elsewhere — a cube
   * rotation — still takes the logo with it.
   */
  #placeLogo(p: PuzzlePosition): void {
    const mesh = this.#logoMesh;
    if (!mesh || !this.#logoSurface) {
      return;
    }
    const { orbit, ord } = LOGO_PIECE;
    const orbitPattern = p.pattern.patternData[orbit];
    const slot = orbitPattern.pieces.indexOf(ord);
    if (slot === -1) {
      mesh.visible = false;
      return;
    }
    mesh.visible = true;
    const untracked = orbitPattern.orientationMod?.[slot] === 1;
    const staysPut =
      untracked &&
      p.movesInProgress.every(
        (moveProgress) =>
          this.kpuzzle.moveToTransformation(
            moveProgress.move.modified({ amount: 1 }),
          ).transformationData[orbit].permutation[slot] === slot,
      );
    const pieceMatrix = staysPut
      ? this.#logoPieceMatrix
          .copy(pieceDefs[orbit][slot].matrix)
          .multiply(orientationRotation[orbit][orbitPattern.orientation[slot]])
      : this.pieces[orbit][ord].matrix;
    mesh.matrix.multiplyMatrices(pieceMatrix, this.#logoSurface);
    mesh.matrixWorldNeedsUpdate = true;
  }

  /** How far a facelet's surface sits from the center of its cubie. */
  #faceletDistance(): number {
    return this.#stickerless()
      ? cubieBodyDimensions.halfWidth * cubieBodyDimensions.pieceScale
      : cubieDimensions.stickerElevation;
  }

  /** @deprecated */
  experimentalSetFoundationOpacity(opacity: number): void {
    // `stickerless` pieces are solid, so there are no foundation meshes.
    if (this.experimentalFoundationMeshes.length === 0) {
      return;
    }
    (
      this.experimentalFoundationMeshes[0].material as MeshBasicMaterial
    ).opacity = opacity;
  }

  /** @deprecated */
  experimentalSetFaceletScale(faceletScale: FaceletScale): void {
    this.options.faceletScale = faceletScale;
    for (const orbitInfo of Object.values(this.kpuzzleFaceletInfo)) {
      for (const pieceInfo of orbitInfo) {
        for (const faceletInfo of pieceInfo) {
          const scale = getFaceletScale(this.options);
          // A `stickerless` facelet is part of the piece itself; scaling it
          // would resize the whole cubie.
          if (faceletInfo.bodyMaterialIndex === undefined) {
            faceletInfo.facelet.scale.setX(scale);
            faceletInfo.facelet.scale.setY(scale);
          }
          faceletInfo.hintFacelet?.scale.setX(scale);
          faceletInfo.hintFacelet?.scale.setY(scale);
          // faceletInfo.facelet.setRotationFromAxisAngle(new Vector3(0, 1, 0), 0);
          // faceletInfo.facelet.rotateOnAxis(new Vector3(1, 0, 1), TAU / 6);
        }
      }
    }
  }

  // /** @deprecated */
  // experimentalSetCenterStickerWidth(width: number): void {
  //   for (const orbitInfo of [this.kpuzzleFaceletInfo["CENTERS"]]) {
  //     for (const pieceInfo of orbitInfo) {
  //       for (const faceletInfo of pieceInfo) {
  //         faceletInfo.facelet.scale.setScalar(
  //           width / getStickerScale(this.options),
  //         );
  //         // faceletInfo.facelet.setRotationFromAxisAngle(new Vector3(0, 1, 0), 0);
  //         // faceletInfo.facelet.rotateOnAxis(new Vector3(1, 0, 1), TAU / 6);
  //       }
  //     }
  //   }
  // }

  private ease(fraction: number): number {
    return smootherStep(fraction);
  }
}
