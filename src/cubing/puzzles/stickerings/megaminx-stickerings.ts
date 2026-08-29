import { LazyPromise } from "@cubing/lazy-promise";
import type { ExperimentalStickering } from "../../twisty";
import type { PuzzleLoader } from "../PuzzleLoader";
import {
  cubeLikeStickeringList,
  cubeLikeStickeringMask,
} from "./cube-like-stickerings";
import {
  PieceStickering,
  PuzzleStickering,
  StickeringManager,
  type StickeringMask,
} from "./mask";

// The Megaminx last-layer diagram carries a border of the surrounding face
// colors, so the top face carries no information for PLL: blank it out and let
// permutation be read off the side stickers alone.
async function megaminxPLLStickeringMask(
  puzzleLoader: PuzzleLoader,
): Promise<StickeringMask> {
  const kpuzzle = await puzzleLoader.kpuzzle();
  const puzzleStickering = new PuzzleStickering(kpuzzle);
  const m = new StickeringManager(kpuzzle);

  const LL = m.move("U");
  puzzleStickering.set(m.not(LL), PieceStickering.Dim);
  puzzleStickering.set(LL, PieceStickering.IgnorePrimary);
  puzzleStickering.set(
    m.and([LL, m.orbitPrefix("CENTER")]),
    PieceStickering.Ignored,
  );
  return puzzleStickering.toStickeringMask();
}

// TODO: cache calculations?
export async function megaminxStickeringMask(
  puzzleLoader: PuzzleLoader,
  stickering: ExperimentalStickering,
): Promise<StickeringMask> {
  // TODO: optimize lookup instead of looking through a list
  if ((await megaminxStickerings()).includes(stickering)) {
    if (stickering === "PLL") {
      return megaminxPLLStickeringMask(puzzleLoader);
    }
    return cubeLikeStickeringMask(puzzleLoader, stickering);
  }
  console.warn(
    `Unsupported stickering for ${puzzleLoader.id}: ${stickering}. Setting all pieces to dim.`,
  );
  return cubeLikeStickeringMask(puzzleLoader, "full");
}

const megaminxStickeringListPromise: Promise<string[]> = new LazyPromise(() =>
  cubeLikeStickeringList("megaminx"),
);
export function megaminxStickerings(): Promise<string[]> {
  return megaminxStickeringListPromise;
}
