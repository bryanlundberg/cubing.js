import type { ExperimentalStickering } from "../../twisty";
import type { PuzzleLoader } from "../PuzzleLoader";
import type {
  FaceletMeshStickeringMask,
  PieceStickeringMask,
  StickeringMask,
} from "./mask";

// The Square-1 hyperorbit definition uses 9 facelets per wedge, so that a
// single set of SVG polygons can cover every wedge shape. Which facelets belong
// to the U/D face (rather than to a side face) depends on the shape of the
// wedge, and the leftover facelets have to be left alone so that they stay
// invisible.
const WEDGES_PER_LAYER = 12;
const NUM_WEDGE_FACELETS = 9;
const NUM_EQUATOR_FACELETS = 6;

type WedgeShape = "cornerHigh" | "cornerLow" | "edge";

function wedgeShape(piece: number): WedgeShape {
  const phase =
    piece < WEDGES_PER_LAYER ? piece % 3 : (piece - WEDGES_PER_LAYER + 2) % 3;
  return phase === 0 ? "cornerHigh" : phase === 1 ? "cornerLow" : "edge";
}

function isLastLayer(piece: number): boolean {
  return piece < WEDGES_PER_LAYER;
}

const UD_FACELETS: Record<WedgeShape, number[]> = {
  cornerHigh: [1, 2, 4],
  cornerLow: [1, 2, 3],
  edge: [1],
};

const SIDE_FACELETS: Record<WedgeShape, number[]> = {
  cornerHigh: [0, 3, 5, 6, 8],
  cornerLow: [0, 4, 5, 6, 7],
  edge: [0, 2, 3, 4, 5],
};

function wedgeMask(
  piece: number,
  udMask: FaceletMeshStickeringMask,
  sideMask: FaceletMeshStickeringMask,
): PieceStickeringMask {
  const shape = wedgeShape(piece);
  // `null` leaves a facelet untouched, which matters for the facelets that this
  // wedge shape doesn't use (they're transparent in the SVGs).
  const facelets: (FaceletMeshStickeringMask | null)[] = new Array(
    NUM_WEDGE_FACELETS,
  ).fill(null);
  for (const facelet of SIDE_FACELETS[shape]) {
    facelets[facelet] = sideMask;
  }
  for (const facelet of UD_FACELETS[shape]) {
    facelets[facelet] = udMask;
  }
  return { facelets };
}

function equatorMask(mask: FaceletMeshStickeringMask): PieceStickeringMask {
  return { facelets: new Array(NUM_EQUATOR_FACELETS).fill(mask) };
}

function masksFor(stickering: ExperimentalStickering): {
  wedge: (piece: number) => PieceStickeringMask;
  equator: FaceletMeshStickeringMask;
} {
  switch (stickering) {
    case "OLL":
      return {
        wedge: (piece) => wedgeMask(piece, "regular", "ignored"),
        equator: "dim",
      };
    case "PLL":
      return {
        wedge: (piece) =>
          isLastLayer(piece)
            ? wedgeMask(piece, "dim", "regular")
            : wedgeMask(piece, "dim", "dim"),
        equator: "dim",
      };
    default:
      return {
        wedge: (piece) => wedgeMask(piece, "regular", "regular"),
        equator: "regular",
      };
  }
}

export async function square1StickeringMask(
  _puzzleLoader: PuzzleLoader,
  stickering: ExperimentalStickering,
): Promise<StickeringMask> {
  const { wedge, equator } = masksFor(stickering);
  return {
    orbits: {
      WEDGES: {
        pieces: new Array(2 * WEDGES_PER_LAYER)
          .fill(null)
          .map((_, piece) => wedge(piece)),
      },
      EQUATOR: {
        pieces: new Array(2).fill(null).map(() => equatorMask(equator)),
      },
    },
  };
}
