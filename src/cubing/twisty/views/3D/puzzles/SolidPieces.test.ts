import { expect, test } from "bun:test";
import { puzzles } from "../../../../puzzles";
import { solidPuzzlePlan } from "./SolidPieces";

async function stickerDatFor(puzzleID: string) {
  const pg = await puzzles[puzzleID].pg!();
  return pg.get3d({ darkIgnoredOrbits: false });
}

test("`solidPuzzlePlan` cuts every piece of the puzzles it claims", async () => {
  for (const [puzzleID, pieces] of [
    // Eight corners and six centers.
    ["skewb", 14],
    // Twelve centers, twenty corners and thirty edges.
    ["megaminx", 62],
    // Four corners, four of the tips they turn against, and six edges.
    ["pyraminx", 14],
    // Six corners, twenty-four centers and twelve edges.
    ["fto", 42],
    // `cubePuzzlePlan` gets first refusal on the cubes, but the pieces are here
    // to be cut all the same.
    ["2x2x2", 8],
    ["4x4x4", 56],
  ] as const) {
    const plan = solidPuzzlePlan(await stickerDatFor(puzzleID));
    expect(plan, puzzleID).not.toBeNull();
    expect(plan!.pieces.length, puzzleID).toEqual(pieces);
    for (const piece of plan!.pieces) {
      // Every facelet the puzzle shows is somewhere on its piece. The ones with
      // nothing to paint are the duplicates stacked on a facelet that has it.
      const painted = piece.facelets.filter(
        (facelet) => facelet.body.length > 0,
      );
      expect(painted.length, `${puzzleID} ${piece.orbit}/${piece.ord}`).toBe(
        new Set(piece.facelets.map((facelet) => facelet.faceStyle)).size,
      );
    }
  }
});
