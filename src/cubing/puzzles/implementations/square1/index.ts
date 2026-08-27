import { KPuzzle } from "../../../kpuzzle";
import type { ExperimentalStickering } from "../../../twisty";
import { getCached } from "../../async/lazy-cached";
import type { PuzzleLoader } from "../../PuzzleLoader";
import { cubeLikeStickeringList } from "../../stickerings/cube-like-stickerings";
import type { StickeringMask } from "../../stickerings/mask";

export const square1: PuzzleLoader = {
  id: "square1",
  fullName: "Square-1",
  inventedBy: ["Karel Hršel", "Vojtech Kopský"],
  inventionYear: 1990, // Czech patent application year: http://spisy.upv.cz/Patents/FullDocuments/277/277266.pdf
  kpuzzle: getCached(
    async () =>
      new KPuzzle(
        (await import("../dynamic/side-events/puzzles-dynamic-side-events"))
          .sq1HyperOrbitJSON,
      ),
  ),
  svg: getCached(async () => {
    return (await import("../dynamic/side-events/puzzles-dynamic-side-events"))
      .sq1HyperOrbitSVG;
  }),
  llSVG: getCached(async () => {
    return (await import("../dynamic/side-events/puzzles-dynamic-side-events"))
      .sq1HyperOrbitLLSVG;
  }),
  stickeringMask: async (
    stickering: ExperimentalStickering,
  ): Promise<StickeringMask> => {
    return (
      await import("../../stickerings/square1-stickerings")
    ).square1StickeringMask(square1, stickering);
  },
  stickerings: () => cubeLikeStickeringList("square1"),
};
