import { expect } from "../../../../test/chai-workarounds";

import { puzzles } from "../../../puzzles";
import { TwistyAnimatedSVG } from "./TwistyAnimatedSVG";

// `draw(…)` memoizes the last write applied to each gradient so that redundant
// DOM writes can be skipped on animation frames where nothing changed. These
// tests pin the property that makes that safe: the memoized DOM state is always
// identical to the state a non-memoized run would have produced.

function gradientSnapshot(svg: TwistyAnimatedSVG): string {
  const gradients = Array.from(
    svg.gradientDefs.querySelectorAll("radialGradient"),
  );
  return JSON.stringify(
    gradients.map((gradient) => [
      // Strip the per-instance SVG ID so snapshots from different instances
      // are comparable.
      gradient.getAttribute("id")!.replace(/^grad-svg\d+-/, ""),
      Array.from(gradient.children).map((stop) => [
        stop.getAttribute("offset"),
        stop.getAttribute("stop-color"),
      ]),
    ]),
  );
}

async function newSVG(): Promise<TwistyAnimatedSVG> {
  const puzzleLoader = puzzles["3x3x3"];
  return new TwistyAnimatedSVG(
    await puzzleLoader.kpuzzle(),
    await puzzleLoader.svg!(),
  );
}

describe("TwistyAnimatedSVG", () => {
  it("produces the same DOM whether or not writes were skipped", async () => {
    const kpuzzle = await puzzles["3x3x3"].kpuzzle();
    const solved = kpuzzle.defaultPattern();
    const scrambled = solved.applyAlg("R U R' U'");

    // One instance walks a sequence and benefits from memoization.
    const memoized = await newSVG();
    memoized.draw(solved);
    memoized.draw(solved); // Repeat: every write should be skipped.
    memoized.draw(scrambled);
    memoized.draw(scrambled, scrambled.applyMove("R"), 0.4);
    memoized.draw(scrambled);

    // A fresh instance per step never has a memo to hit, so it always writes.
    const unmemoized = await newSVG();
    unmemoized.draw(scrambled);

    expect(gradientSnapshot(memoized)).to.equal(gradientSnapshot(unmemoized));
  });

  it("reaches the same DOM mid-move as an instance drawing it directly", async () => {
    const kpuzzle = await puzzles["3x3x3"].kpuzzle();
    const solved = kpuzzle.defaultPattern();
    const target = solved.applyMove("U");

    const memoized = await newSVG();
    memoized.draw(solved);
    memoized.draw(solved, target, 0.25);
    memoized.draw(solved, target, 0.6);

    const direct = await newSVG();
    direct.draw(solved, target, 0.6);

    expect(gradientSnapshot(memoized)).to.equal(gradientSnapshot(direct));
  });

  it("keeps piece separators in sync with the pattern", async () => {
    const puzzleLoader = puzzles["square1"];
    const svg = new TwistyAnimatedSVG(
      await puzzleLoader.kpuzzle(),
      await puzzleLoader.svg!(),
    );
    const separators = Array.from(
      svg.svgElement.querySelectorAll("[data-piece-separator]"),
    ) as SVGElement[];
    // If the Square-1 SVG ever loses its separators, the rest of this test
    // would silently pass, so assert that there are some.
    expect(separators.length).to.be.greaterThan(0);

    const kpuzzle = await puzzleLoader.kpuzzle();
    const solved = kpuzzle.defaultPattern();
    const turned = solved.applyAlg("(1, 0)");

    svg.draw(solved);
    const solvedDisplays = separators.map((s) => s.style.display);

    svg.draw(turned);
    svg.draw(solved); // Back to the start: separators must return to the start state.
    expect(separators.map((s) => s.style.display)).to.deep.equal(
      solvedDisplays,
    );
  });
});
