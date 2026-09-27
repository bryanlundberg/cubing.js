import { expect, test } from "bun:test";
import { Matrix4 } from "three/src/math/Matrix4.js";
import type { Mesh } from "three/src/objects/Mesh.js";
import { Texture } from "three/src/textures/Texture.js";
import { Alg, Move } from "../../../../alg";
import type { KTransformation } from "../../../../kpuzzle";
import { cube3x3x3 } from "../../../../puzzles";
import {
  Direction,
  type PuzzlePosition,
} from "../../../controllers/AnimationTypes";
import { Cube3D } from "./Cube3D";
import { logoGeometry } from "./PuzzleLogo";

const TAU = 2 * Math.PI;

async function cubeWithLogo(): Promise<{ cube: Cube3D; logo: Mesh }> {
  // No hint facelet animation, which needs `requestAnimationFrame`.
  const cube = new Cube3D(await cube3x3x3.kpuzzle(), () => {}, {
    initialHintFaceletsAnimation: "none",
  });
  cube.experimentalSetLogo(new Texture());
  const logo = cube.children.find(
    (child) => (child as Mesh).geometry === logoGeometry(),
  ) as Mesh;
  return { cube, logo };
}

function position(
  transformation: KTransformation,
  moveInProgress?: Move,
): PuzzlePosition {
  return {
    pattern: transformation.toKPattern(),
    movesInProgress: moveInProgress
      ? [
          {
            move: moveInProgress,
            direction: Direction.Forwards,
            fraction: 1,
          },
        ]
      : [],
    transformation,
  };
}

function expectCloseMatrix(actual: Matrix4, expected: Matrix4, label: string) {
  for (let i = 0; i < 16; i++) {
    expect(actual.elements[i], `${label} [${i}]`).toBeCloseTo(
      expected.elements[i],
      6,
    );
  }
}

test("the logo turns with the white face", async () => {
  const { cube, logo } = await cubeWithLogo();
  const kpuzzle = await cube3x3x3.kpuzzle();

  cube.onPositionChange(position(kpuzzle.identityTransformation()));
  const solved = logo.matrix.clone();

  cube.onPositionChange(position(kpuzzle.algToTransformation("U")));
  expectCloseMatrix(
    logo.matrix,
    new Matrix4().makeRotationY(-TAU / 4).multiply(solved),
    "U",
  );

  cube.onPositionChange(position(kpuzzle.algToTransformation("U2 U2")));
  expectCloseMatrix(logo.matrix, solved, "U4");
});

test("a finished move leaves the logo where its animation put it", async () => {
  const { cube, logo } = await cubeWithLogo();
  const kpuzzle = await cube3x3x3.kpuzzle();
  for (const setup of ["", "U", "R U2 F'", "x U'", "z2 y D", "M' E S2"]) {
    const start = kpuzzle.algToTransformation(new Alg(setup));
    for (const moveString of [
      "U",
      "U'",
      "U2",
      "D",
      "R",
      "L'",
      "F",
      "B2",
      "x",
      "y'",
      "z",
      "M",
      "E'",
      "S",
    ]) {
      const move = new Move(moveString);
      cube.onPositionChange(position(start, move));
      const animated = logo.matrix.clone();
      cube.onPositionChange(position(start.applyMove(move)));
      expectCloseMatrix(logo.matrix, animated, `${setup} + ${moveString}`);
    }
  }
});
