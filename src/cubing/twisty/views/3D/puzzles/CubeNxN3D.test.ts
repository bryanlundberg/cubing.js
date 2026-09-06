import { expect, test } from "bun:test";
import { puzzles } from "../../../../puzzles";
import { cubeLayout } from "./CubeNxN3D";

async function layoutFor(puzzleID: string) {
  const puzzleLoader = puzzles[puzzleID];
  const pg = await puzzleLoader.pg!();
  return cubeLayout(pg.get3d({ darkIgnoredOrbits: false }));
}

test("`cubeLayout` reads every N×N×N cube out of its `StickerDat`", async () => {
  for (const [puzzleID, layers] of [
    ["2x2x2", 2],
    ["4x4x4", 4],
    ["5x5x5", 5],
    ["6x6x6", 6],
    ["7x7x7", 7],
  ] as const) {
    const layout = await layoutFor(puzzleID);
    expect(layout, puzzleID).not.toBeNull();
    expect(layout!.layers, puzzleID).toEqual(layers);
    // Every cell but the ones sealed inside the puzzle.
    expect(layout!.cubies.length, puzzleID).toEqual(
      layers ** 3 - (layers - 2) ** 3,
    );
    // A cube has eight cells with three faces out, twelve edges of cells with
    // two, and the rest of each face with one.
    const byOutwardFaces = [0, 0, 0, 0];
    for (const cubie of layout!.cubies) {
      byOutwardFaces[cubie.outwardFaces.length]++;
    }
    expect(byOutwardFaces, puzzleID).toEqual([
      0,
      6 * (layers - 2) ** 2,
      12 * (layers - 2),
      8,
    ]);
  }
});

test("`cubeLayout` turns down anything that is not an N×N×N cube", async () => {
  for (const puzzleID of ["megaminx", "pyraminx", "skewb", "fto"]) {
    expect(await layoutFor(puzzleID), puzzleID).toBeNull();
  }
});
