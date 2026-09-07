import { cube3x3x3, type PuzzleLoader } from "../../../puzzles";
import type { FaceletScale } from "../../model/props/puzzle/display/FaceletScaleProp";
import type { HintFaceletStyle } from "../../model/props/puzzle/display/HintFaceletProp";
import { Cube3D, type Cube3DOptions } from "../../views/3D/puzzles/Cube3D";
import { cubePuzzlePlan } from "../../views/3D/puzzles/CubePieces";
import { PG3D } from "../../views/3D/puzzles/PG3D";
import { logoFaceletAddress } from "../../views/3D/puzzles/PuzzleLogo";
import { solidPuzzlePlan } from "../../views/3D/puzzles/SolidPieces";
import { Square1_3D } from "../../views/3D/puzzles/Square1_3D";
import { Stickerless3D } from "../../views/3D/puzzles/Stickerless3D";

// TODO: figure out how to load these dynamically without a bottleneck.
export { PerspectiveCamera as ThreePerspectiveCamera } from "three/src/cameras/PerspectiveCamera.js";
export { Raycaster as ThreeRaycaster } from "three/src/core/Raycaster.js";
export { TextureLoader as ThreeTextureLoader } from "three/src/loaders/TextureLoader.js";
export { Spherical as ThreeSpherical } from "three/src/math/Spherical.js";
export { Vector2 as ThreeVector2 } from "three/src/math/Vector2.js";
export { Vector3 as ThreeVector3 } from "three/src/math/Vector3.js";
export { WebGLRenderer as ThreeWebGLRenderer } from "three/src/renderers/WebGLRenderer.js";
export { Scene as ThreeScene } from "three/src/scenes/Scene.js";

export { Cube3D } from "../../views/3D/puzzles/Cube3D";
export { PG3D } from "../../views/3D/puzzles/PG3D";
export { Square1_3D } from "../../views/3D/puzzles/Square1_3D";
export { Stickerless3D } from "../../views/3D/puzzles/Stickerless3D";
export { Twisty3DScene } from "../../views/3D/Twisty3DScene";

export async function cube3DShim(
  renderCallback: () => void,
  options?: Cube3DOptions,
): Promise<Cube3D> {
  return new Cube3D(await cube3x3x3.kpuzzle(), renderCallback, options);
}

export async function square1_3DShim(
  renderCallback: () => void,
  puzzleLoader: PuzzleLoader,
  faceletScale: FaceletScale,
): Promise<Square1_3D> {
  return new Square1_3D(await puzzleLoader.kpuzzle(), renderCallback, {
    faceletScale,
  });
}

// TODO: take loader?
export async function pg3dShim(
  renderCallback: () => void,
  puzzleLoader: PuzzleLoader,
  hintFacelets: HintFaceletStyle,
  faceletScale: FaceletScale,
  darkIgnoredOrbits: boolean,
  // A picture cube needs a sticker to print on, and a stickerless piece has
  // none, so leave those to `PG3D` as well.
  pictureCube: boolean = false,
): Promise<PG3D | Stickerless3D> {
  const kpuzzle = await puzzleLoader.kpuzzle();
  const stickerDat = (await puzzleLoader.pg!()).get3d({ darkIgnoredOrbits });
  // Every puzzle whose pieces we can cut gets the same solid plastic the 3×3×3
  // gets from `Cube3D`. `PG3D` still draws the rest.
  const plan =
    darkIgnoredOrbits || pictureCube
      ? null
      : (cubePuzzlePlan(stickerDat) ?? solidPuzzlePlan(stickerDat));
  if (plan) {
    return new Stickerless3D(renderCallback, kpuzzle, stickerDat, plan, {
      hintFacelets,
      logoFacelet: logoFaceletAddress(puzzleLoader.id, stickerDat),
    });
  }
  return new PG3D(
    renderCallback,
    kpuzzle,
    stickerDat,
    true,
    hintFacelets === "floating",
    undefined,
    faceletScale,
  );
}
