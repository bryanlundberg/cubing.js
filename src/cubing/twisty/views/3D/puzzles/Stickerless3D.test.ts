import { expect, test } from "bun:test";
import { Vector3 } from "three/src/math/Vector3.js";
import type { Mesh } from "three/src/objects/Mesh.js";
import { Texture } from "three/src/textures/Texture.js";
import { Move } from "../../../../alg";
import type { KPuzzle, KTransformation } from "../../../../kpuzzle";
import { puzzles } from "../../../../puzzles";
import {
  Direction,
  type PuzzlePosition,
} from "../../../controllers/AnimationTypes";
import { cubePuzzlePlan } from "./CubePieces";
import { logoFaceletAddress, logoGeometry } from "./PuzzleLogo";
import { solidPuzzlePlan } from "./SolidPieces";
import { Stickerless3D } from "./Stickerless3D";

async function puzzleWithLogo(puzzleID: string): Promise<{
  puzzle: Stickerless3D;
  logo: Mesh;
  kpuzzle: KPuzzle;
  /** The quantum moves the renderer animates. */
  moves: Move[];
}> {
  const loader = puzzles[puzzleID];
  const kpuzzle = await loader.kpuzzle();
  const stickerDat = (await loader.pg!()).get3d({ darkIgnoredOrbits: false });
  const plan = cubePuzzlePlan(stickerDat) ?? solidPuzzlePlan(stickerDat);
  const puzzle = new Stickerless3D(() => {}, kpuzzle, stickerDat, plan!, {
    logoFacelet: logoFaceletAddress(puzzleID, stickerDat),
  });
  puzzle.experimentalSetLogo(new Texture());
  const logo = puzzle.children.find(
    (child) => (child as Mesh).geometry === logoGeometry(),
  ) as Mesh;
  const moves = Object.keys(kpuzzle.definition.moves)
    .map((name) => new Move(name))
    .filter((move) => stickerDat.unswizzle(move));
  return { puzzle, logo, kpuzzle, moves };
}

function position(
  transformation: KTransformation,
  moveInProgress?: Move,
): PuzzlePosition {
  return {
    pattern: transformation.toKPattern(),
    movesInProgress: moveInProgress
      ? [{ move: moveInProgress, direction: Direction.Forwards, fraction: 1 }]
      : [],
    transformation,
  };
}

/** Where the logo's middle is, and which ways its edges point. */
function logoFrame(logo: Mesh): Vector3[] {
  const [x, y, _, center] = [0, 1, 2, 3].map((column) =>
    new Vector3().setFromMatrixColumn(logo.matrix, column),
  );
  return [center, x.normalize(), y.normalize()];
}

function expectSameFrame(
  actual: Vector3[],
  expected: Vector3[],
  label: string,
) {
  for (const [i, vector] of actual.entries()) {
    expect(vector.distanceTo(expected[i]), `${label} [${i}]`).toBeLessThan(
      1e-6,
    );
  }
}

// A fixed walk through the moves, so that a failure can be replayed.
function scramble(moves: Move[], length: number, seed: number): Move[] {
  const scrambleMoves: Move[] = [];
  for (let i = 0; i < length; i++) {
    seed = (seed * 1103515245 + 12345) % 2 ** 31;
    const move = moves[seed % moves.length];
    scrambleMoves.push(seed % 3 === 0 ? move.invert() : move);
  }
  return scrambleMoves;
}

test("a finished move leaves the logo where its animation put it", async () => {
  for (const puzzleID of [
    "2x2x2",
    "3x3x3",
    "4x4x4",
    "megaminx",
    "pyraminx",
    "skewb",
  ]) {
    const { puzzle, logo, kpuzzle, moves } = await puzzleWithLogo(puzzleID);
    for (const seed of [1, 2, 3, 4]) {
      let start = kpuzzle.identityTransformation();
      for (const scrambleMove of scramble(moves, 12, seed)) {
        start = start.applyMove(scrambleMove);
        for (const quantum of moves) {
          for (const move of [quantum, quantum.invert()]) {
            const label = `${puzzleID} seed ${seed} + ${move}`;
            puzzle.onPositionChange(position(start, move));
            expect(logo.visible, label).toBe(true);
            const animated = logoFrame(logo);
            puzzle.onPositionChange(position(start.applyMove(move)));
            expectSameFrame(logoFrame(logo), animated, label);
          }
        }
      }
    }
  }
});

test("a logo on a center turns with its face", async () => {
  for (const [puzzleID, turns] of [
    ["3x3x3", 4],
    ["megaminx", 5],
  ] as const) {
    const { puzzle, logo, kpuzzle } = await puzzleWithLogo(puzzleID);
    puzzle.onPositionChange(position(kpuzzle.identityTransformation()));
    const [center, solvedX] = logoFrame(logo);
    puzzle.onPositionChange(position(kpuzzle.algToTransformation("U")));
    const [turnedCenter, turnedX] = logoFrame(logo);
    expect(turnedCenter.distanceTo(center), puzzleID).toBeLessThan(1e-6);
    expect(turnedX.angleTo(solvedX), puzzleID).toBeCloseTo(
      (2 * Math.PI) / turns,
      6,
    );
  }
});
