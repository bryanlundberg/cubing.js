import type { Move } from "../../../alg";
import type { KPattern, KPuzzle } from "../../../kpuzzle";
import type { ExperimentalStickeringMask } from "../../../puzzles/cubing-private";
import type { PuzzleLoader } from "../../../puzzles/PuzzleLoader";
import type { StickeringMask } from "../../../puzzles/stickerings/mask";
import {
  type FaceColorBorderStyle,
  faceColorBorderStyles,
} from "../../../twisty/model/props/puzzle/display/FaceColorBorderProp";
import {
  type HintFaceletStyleWithAuto,
  hintFaceletStyles,
} from "../../../twisty/model/props/puzzle/display/HintFaceletProp";
import type { PuzzleID } from "../..";
import {
  Direction,
  type PositionListener,
  type PuzzlePosition,
} from "../../controllers/AnimationTypes";
import { RenderScheduler } from "../../controllers/RenderScheduler";
import { FreshListenerManager } from "../../model/props/TwistyProp";
import type { TwistyPlayerModel } from "../../model/TwistyPlayerModel";
import { ClassListManager } from "../ClassListManager";
import { ManagedCustomElement } from "../ManagedCustomElement";
import { customElementsShim } from "../node-custom-element-shims";
import { twisty2DSVGCSS } from "./Twisty2DPuzzle.css";
import { TwistyAnimatedSVG } from "./TwistyAnimatedSVG";

export interface Twisty2DPuzzleOptions {
  experimentalStickeringMask?: ExperimentalStickeringMask;
}

// <twisty-2d-svg>
export class Twisty2DPuzzle
  extends ManagedCustomElement
  implements PositionListener
{
  public svgWrapper?: TwistyAnimatedSVG;
  private scheduler = new RenderScheduler(this.render.bind(this));
  #cachedPosition: PuzzlePosition | null = null; // TODO: pull when needed.
  constructor(
    private model?: TwistyPlayerModel,
    private kpuzzle?: KPuzzle,
    private svgSource?: string,
    private options?: Twisty2DPuzzleOptions,
    private puzzleLoader?: PuzzleLoader,
  ) {
    super();
    this.addCSS(twisty2DSVGCSS);

    this.resetSVG(); // TODO: do this in `connectedCallback()`?

    this.#freshListenerManager.addListener(
      this.model!.puzzleID,
      (puzzleID: PuzzleID) => {
        if (puzzleLoader?.id !== puzzleID) {
          this.disconnect();
        }
      },
    );

    this.#freshListenerManager.addListener(
      this.model!.twistySceneModel.hintFacelet,
      (hintFacelet) => {
        this.setHintFacelet(hintFacelet);
      },
    );

    this.#freshListenerManager.addListener(
      this.model!.twistySceneModel.faceColorBorder,
      (faceColorBorder) => {
        this.setFaceColorBorder(faceColorBorder);
      },
    );

    this.#freshListenerManager.addListener(
      this.model!.legacyPosition,
      this.onPositionChange.bind(this),
    );

    if (this.options?.experimentalStickeringMask) {
      this.experimentalSetStickeringMask(
        this.options.experimentalStickeringMask,
      );
    }
  }

  #freshListenerManager = new FreshListenerManager();
  disconnect(): void {
    this.#freshListenerManager.disconnect();
  }

  // Only the `fraction` of a move in progress changes from frame to frame, so
  // the destination pattern is recomputed once per move rather than per frame.
  #cachedTargetPattern: {
    pattern: KPattern;
    move: Move;
    direction: Direction;
    target: KPattern;
  } | null = null;

  #targetPattern(position: PuzzlePosition): KPattern {
    const { move, direction } = position.movesInProgress[0];
    const cached = this.#cachedTargetPattern;
    if (
      cached &&
      cached.pattern === position.pattern &&
      cached.move === move &&
      cached.direction === direction
    ) {
      return cached.target;
    }
    const partialMove =
      direction === Direction.Backwards ? move.invert() : move;
    const target = position.pattern.applyMove(partialMove);
    this.#cachedTargetPattern = {
      pattern: position.pattern,
      move,
      direction,
      target,
    };
    return target;
  }

  onPositionChange(position: PuzzlePosition): void {
    try {
      if (position.movesInProgress.length > 0) {
        // TODO: move to render()
        this.svgWrapper?.draw(
          position.pattern,
          this.#targetPattern(position),
          position.movesInProgress[0].fraction,
        );
      } else {
        this.svgWrapper?.draw(position.pattern);
        this.#cachedPosition = position;
      }
    } catch (e) {
      console.warn(
        "Bad position (this doesn't necessarily mean something is wrong). Pre-emptively disconnecting:",
        this.puzzleLoader?.id,
        e,
      );
      this.disconnect();
    }
  }

  scheduleRender(): void {
    this.scheduler.requestAnimFrame();
  }

  experimentalSetStickeringMask(
    stickeringMask: ExperimentalStickeringMask,
  ): void {
    this.resetSVG(stickeringMask);
  }

  // TODO: do this without constructing a new SVG.
  private resetSVG(stickeringMask?: StickeringMask): void {
    if (this.svgWrapper) {
      this.removeElement(this.svgWrapper.wrapperElement);
    }
    if (!this.kpuzzle) {
      return; // TODO
    }
    this.svgWrapper = new TwistyAnimatedSVG(
      this.kpuzzle,
      this.svgSource!,
      stickeringMask,
    ); // TODO
    this.addElement(this.svgWrapper.wrapperElement);
    this.#applyFaceColorBorderViewBox();
    if (this.#cachedPosition) {
      this.onPositionChange(this.#cachedPosition);
    }
  }

  private hintFaceletsClassListManager = new ClassListManager(
    this,
    "hint-facelets-",
    Object.keys(hintFaceletStyles),
  );
  setHintFacelet(hintFacelet: HintFaceletStyleWithAuto) {
    this.hintFaceletsClassListManager.setValue(
      hintFacelet === "auto" ? "floating" : hintFacelet,
    );
  }

  private faceColorBorderClassListManager = new ClassListManager(
    this,
    "face-color-border-",
    Object.keys(faceColorBorderStyles),
  );
  #faceColorBorder: FaceColorBorderStyle = "auto";
  setFaceColorBorder(faceColorBorder: FaceColorBorderStyle) {
    this.#faceColorBorder = faceColorBorder;
    this.faceColorBorderClassListManager.setValue(faceColorBorder);
    this.#applyFaceColorBorderViewBox();
  }

  // The border sits outside the puzzle outline, so an SVG that has one reserves
  // room for it in the `viewBox` it ships with. Hiding the border would then
  // leave the diagram floating in a band of empty space, so swap in the tight
  // `viewBox` the SVG declares alongside it.
  #applyFaceColorBorderViewBox(): void {
    const svgElement = this.svgWrapper?.svgElement;
    const viewBox = svgElement?.getAttribute(
      this.#faceColorBorder === "none"
        ? "data-view-box-without-face-color-border"
        : "data-view-box-with-face-color-border",
    );
    if (viewBox) {
      svgElement!.setAttribute("viewBox", viewBox);
    }
  }

  private render(): void {
    /*...*/
  }
}

customElementsShim.define("twisty-2d-puzzle", Twisty2DPuzzle);
