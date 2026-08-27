import type { KPuzzle } from "../../../kpuzzle";
import type { KPattern } from "../../../kpuzzle/KPattern";
import type {
  FaceletMeshStickeringMask,
  StickeringMask,
} from "../../../puzzles/stickerings/mask"; // TODO

const xmlns = "http://www.w3.org/2000/svg";
const DATA_COPY_ID_ATTRIBUTE = "data-copy-id";
const DATA_FACELET_STROKE_WIDTH_ATTRIBUTE = "data-facelet-stroke-width";
const DATA_PIECE_SEPARATOR_ATTRIBUTE = "data-piece-separator";
const DATA_BONDED_PIECES_ATTRIBUTE = "data-bonded-pieces";

interface PieceSeparator {
  element: SVGElement;
  orbitName: string;
  slotA: number;
  slotB: number;
  // Last value written to `element.style.display`, so `draw(…)` can skip the
  // DOM write (and the style recalc it triggers) on frames where it is stable.
  lastDisplay: string | null;
}

// Unique ID mechanism to keep SVG gradient element IDs unique. TODO: Is there
// something more performant, and that can't be broken by other elements of the
// page? (And also doesn't break if this library is run in parallel.)
let svgCounter = 0;
function nextSVGID(): string {
  svgCounter += 1;
  return `svg${svgCounter.toString()}`;
}

// TODO: This is hardcoded to 3x3x3 SVGs
const colorMaps: Partial<
  Record<FaceletMeshStickeringMask, string | Record<string, string>>
> = {
  dim: {
    white: "#dddddd",
    orange: "#884400",
    limegreen: "#008800",
    red: "#660000",
    "rgb(34, 102, 255)": "#000088", // TODO
    yellow: "#888800",
    "rgb(102, 0, 153)": "rgb(50, 0, 76)",
    purple: "#3f003f",
  },
  oriented: "#44ddcc",
  ignored: "#555555",
  invisible: "#00000000",
};

export class TwistyAnimatedSVG {
  public wrapperElement: HTMLElement;
  public svgElement: SVGElement;
  public gradientDefs: SVGDefsElement;
  private originalColors: { [type: string]: string } = {};
  private gradients: { [type: string]: SVGGradientElement } = {};
  private svgID: string;
  private faceletStrokeWidth: string | null = null;
  private pieceSeparators: PieceSeparator[] = [];
  private bondedPieces = new Set<string>();
  constructor(
    public kpuzzle: KPuzzle,
    svgSource: string,
    experimentalStickeringMask?: StickeringMask,
    private showUnknownOrientations: boolean = false,
  ) {
    if (!svgSource) {
      throw new Error(`No SVG definition for puzzle type: ${kpuzzle.name()}`);
    }

    this.svgID = nextSVGID();

    this.wrapperElement = document.createElement("div");
    this.wrapperElement.classList.add("svg-wrapper");
    // TODO: Sanitization.
    this.wrapperElement.innerHTML = svgSource;

    const svgElem = this.wrapperElement.querySelector("svg");
    if (!svgElem) {
      throw new Error("Could not get SVG element");
    }
    this.svgElement = svgElem;
    if (xmlns !== svgElem.namespaceURI) {
      throw new Error("Unexpected XML namespace");
    }
    svgElem.style.maxWidth = "100%";
    svgElem.style.maxHeight = "100%";
    this.faceletStrokeWidth = svgElem.getAttribute(
      DATA_FACELET_STROKE_WIDTH_ATTRIBUTE,
    );
    for (const bond of (
      svgElem.getAttribute(DATA_BONDED_PIECES_ATTRIBUTE) ?? ""
    ).split(/\s+/)) {
      if (bond) {
        this.bondedPieces.add(bond);
      }
    }
    this.gradientDefs = document.createElementNS(xmlns, "defs");
    svgElem.insertBefore(this.gradientDefs, svgElem.firstChild);

    for (const orbitDefinition of kpuzzle.definition.orbits) {
      for (let idx = 0; idx < orbitDefinition.numPieces; idx++) {
        for (
          let orientation = 0;
          orientation < orbitDefinition.numOrientations;
          orientation++
        ) {
          const id = this.elementID(
            orbitDefinition.orbitName,
            idx,
            orientation,
          );
          const elem = this.elementByID(id);

          let originalColor: string = elem?.style.fill;
          /// TODO: Allow setting stickering mask dynamically.
          if (experimentalStickeringMask) {
            (() => {
              // TODO: dedup with Cube3D,,factor out fallback calculations
              const a = experimentalStickeringMask.orbits;
              if (!a) {
                return;
              }
              const orbitStickeringMask = a[orbitDefinition.orbitName];
              if (!orbitStickeringMask) {
                return;
              }
              const pieceStickeringMask = orbitStickeringMask.pieces[idx];
              if (!pieceStickeringMask) {
                return;
              }
              const faceletStickeringMasks =
                pieceStickeringMask.facelets[orientation];
              if (!faceletStickeringMasks) {
                return;
              }
              const stickeringMask =
                typeof faceletStickeringMasks === "string"
                  ? faceletStickeringMasks
                  : faceletStickeringMasks?.mask;
              const colorMap = colorMaps[stickeringMask];
              if (typeof colorMap === "string") {
                originalColor = colorMap;
              } else if (colorMap) {
                originalColor = colorMap[originalColor];
              }
            })();
          } else {
            originalColor = elem?.style.fill;
          }
          this.originalColors[id] = originalColor;
          this.gradients[id] = this.newGradient(id, originalColor);
          this.gradientDefs.appendChild(this.gradients[id]);
          elem?.setAttribute("style", this.faceletStyle(id));
        }
      }
    }

    for (const hintElem of Array.from(
      svgElem.querySelectorAll(`[${DATA_COPY_ID_ATTRIBUTE}]`),
    )) {
      const id = hintElem.getAttribute(DATA_COPY_ID_ATTRIBUTE);
      hintElem.setAttribute("style", this.faceletStyle(id!));
    }

    for (const separatorElem of Array.from(
      svgElem.querySelectorAll(`[${DATA_PIECE_SEPARATOR_ATTRIBUTE}]`),
    )) {
      const [orbitName, slotA, slotB] = separatorElem
        .getAttribute(DATA_PIECE_SEPARATOR_ATTRIBUTE)!
        .split(/\s+/);
      this.pieceSeparators.push({
        element: separatorElem as SVGElement,
        orbitName,
        slotA: Number.parseInt(slotA, 10),
        slotB: Number.parseInt(slotB, 10),
        lastDisplay: null,
      });
    }

    if (this.showUnknownOrientations) {
      this.drawPattern(this.kpuzzle.defaultPattern());
    }
  }

  public drawPattern(
    pattern: KPattern,
    nextPattern?: KPattern,
    fraction?: number,
  ): void {
    this.draw(pattern, nextPattern, fraction);
  }

  // TODO: save definition in the constructor?
  public draw(
    pattern: KPattern,
    nextPattern?: KPattern,
    fraction?: number,
  ): void {
    const nextTransformation = nextPattern?.experimentalToTransformation();
    if (!pattern) {
      throw new Error("Distinguishable pieces are not handled for SVG yet!");
    }

    for (const separator of this.pieceSeparators) {
      const { pieces } = pattern.patternData[separator.orbitName];
      const a = pieces[separator.slotA];
      const b = pieces[separator.slotB];
      const lo = a < b ? a : b;
      const hi = a < b ? b : a;
      const display = this.bondedPieces.has(
        `${separator.orbitName}:${lo}:${hi}`,
      )
        ? "none"
        : "";
      if (separator.lastDisplay !== display) {
        separator.element.style.display = display;
        separator.lastDisplay = display;
      }
    }

    for (const orbitDefinition of pattern.kpuzzle.definition.orbits) {
      const currentPatternOrbit =
        pattern.patternData[orbitDefinition.orbitName];
      const nextTransformationOrbit = nextTransformation
        ? nextTransformation.transformationData[orbitDefinition.orbitName]
        : null;
      for (let idx = 0; idx < orbitDefinition.numPieces; idx++) {
        for (
          let orientation = 0;
          orientation < orbitDefinition.numOrientations;
          orientation++
        ) {
          const id = this.elementID(
            orbitDefinition.orbitName,
            idx,
            orientation,
          );
          const fromCur = this.elementID(
            orbitDefinition.orbitName,
            currentPatternOrbit.pieces[idx],
            (orbitDefinition.numOrientations -
              currentPatternOrbit.orientation[idx] +
              orientation) %
              orbitDefinition.numOrientations,
          );
          // Resolve the gradient's final state for this frame *before*
          // touching the DOM. A stationary piece during a move matches both the
          // animated branch and the flat-color branch, and the flat one wins;
          // deciding first means each gradient is described by exactly one
          // signature, which is what makes skipping a repeat write sound.
          let stopColorStart: string;
          let stopColorEnd: string;
          let leadingOffset: string;
          let trailingOffset: string;
          let signature: string;

          let singleColor = false;
          let fromNext: string | null = null;
          if (nextTransformationOrbit) {
            fromNext = this.elementID(
              orbitDefinition.orbitName,
              nextTransformationOrbit.permutation[idx],
              (orbitDefinition.numOrientations -
                nextTransformationOrbit.orientationDelta[idx] +
                orientation) %
                orbitDefinition.numOrientations,
            );
            if (fromCur === fromNext) {
              singleColor = true;
            }
          } else {
            singleColor = true;
          }

          if (!singleColor) {
            fraction = fraction || 0; // TODO Use the type system to tie this to nextPattern?
            const easedBackwardsPercent =
              100 * (1 - fraction * fraction * (2 - fraction * fraction)); // TODO: Move easing up the stack.
            stopColorStart = this.originalColors[fromCur];
            stopColorEnd = this.originalColors[fromNext!];
            leadingOffset = `${Math.max(easedBackwardsPercent - 5, 0)}%`;
            trailingOffset = `${easedBackwardsPercent}%`;
            signature = `a|${fromCur}|${fromNext}|${easedBackwardsPercent}`;
          } else if (
            this.showUnknownOrientations &&
            currentPatternOrbit.orientationMod?.[idx] === 1
          ) {
            stopColorStart = "#000";
            stopColorEnd = this.originalColors[fromCur];
            leadingOffset = "5%";
            trailingOffset = "20%";
            signature = `b|${fromCur}`;
          } else {
            stopColorStart = this.originalColors[fromCur];
            stopColorEnd = this.originalColors[fromCur];
            leadingOffset = "100%";
            trailingOffset = "100%";
            signature = `c|${fromCur}`;
          }

          if (this.#lastGradientWrite[id] !== signature) {
            this.#lastGradientWrite[id] = signature;
            const { children } = this.gradients[id];
            children[0].setAttribute("stop-color", stopColorStart);
            children[0].setAttribute("offset", leadingOffset);
            children[1].setAttribute("offset", leadingOffset);
            children[2].setAttribute("offset", trailingOffset);
            children[3].setAttribute("offset", trailingOffset);
            children[3].setAttribute("stop-color", stopColorEnd);
          }
          // this.gradients[id]
          // this.elementByID(id).style.fill = this.originalColors[from];
        }
      }
    }
  }

  // Signature of the state last written to each gradient. `draw(…)` runs on
  // every animation frame and rewrites all four stops of every facelet, but
  // only the facelets touched by the move in progress actually change, so a
  // matching signature means the DOM already holds the desired state.
  #lastGradientWrite: Record<string, string> = {};

  private faceletStyle(id: string): string {
    const paint = `url(#grad-${this.svgID}-${id})`;
    return this.faceletStrokeWidth === null
      ? `fill: ${paint}`
      : `fill: ${paint}; stroke: ${paint}; stroke-width: ${this.faceletStrokeWidth}`;
  }

  private newGradient(id: string, originalColor: string): SVGGradientElement {
    const grad = document.createElementNS(
      xmlns,
      "radialGradient",
    ) as SVGGradientElement;
    grad.setAttribute("id", `grad-${this.svgID}-${id}`);
    grad.setAttribute("r", "70.7107%"); // TODO: Adapt to puzzle.
    const stopDefs = [
      { offset: 0, color: originalColor },
      { offset: 0, color: "black" },
      { offset: 0, color: "black" },
      { offset: 0, color: originalColor },
    ];
    for (const stopDef of stopDefs) {
      const stop = document.createElementNS(xmlns, "stop");
      stop.setAttribute("offset", `${stopDef.offset}%`);
      stop.setAttribute("stop-color", stopDef.color);
      stop.setAttribute("stop-opacity", "1");
      grad.appendChild(stop);
    }
    return grad;
  }

  private elementID(
    orbitName: string,
    idx: number,
    orientation: number,
  ): string {
    return `${orbitName}-l${idx}-o${orientation}`;
  }

  private elementByID(id: string): HTMLElement {
    // TODO: Use classes and scope selector to SVG element.
    return this.wrapperElement.querySelector(`#${id}`) as HTMLElement;
  }
}
