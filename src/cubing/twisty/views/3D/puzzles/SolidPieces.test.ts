import { expect, test } from "bun:test";
import { puzzles } from "../../../../puzzles";
import { solidPuzzlePlan } from "./SolidPieces";

async function stickerDatFor(puzzleID: string) {
  const pg = await puzzles[puzzleID].pg!();
  return pg.get3d({ darkIgnoredOrbits: false });
}

test("`solidPuzzlePlan` claims the deep-cut puzzles and no others", async () => {
  for (const [puzzleID, pieces] of [
    // A skewb: eight corners and six centers.
    ["skewb", 14],
    // Cubes are deep-cut only at 2×2×2, and `cubePuzzlePlan` gets first refusal
    // on those anyway.
    ["2x2x2", 8],
  ] as const) {
    const plan = solidPuzzlePlan(await stickerDatFor(puzzleID));
    expect(plan, puzzleID).not.toBeNull();
    expect(plan!.pieces.length, puzzleID).toEqual(pieces);
  }
  // Cuts that don't run through the center: the plane through a sticker edge
  // and the puzzle's center is the wrong plane, and it has to be caught.
  for (const puzzleID of ["megaminx", "pyraminx", "fto", "4x4x4"]) {
    expect(
      await solidPuzzlePlan(await stickerDatFor(puzzleID)),
      puzzleID,
    ).toBeNull();
  }
});
