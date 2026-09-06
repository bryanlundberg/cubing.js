import { BackSide } from "three/src/constants.js";
import { BufferAttribute } from "three/src/core/BufferAttribute.js";
import { BufferGeometry } from "three/src/core/BufferGeometry.js";
import { Object3D } from "three/src/core/Object3D.js";
import type { Material } from "three/src/materials/Material.js";
import { MeshBasicMaterial } from "three/src/materials/MeshBasicMaterial.js";
import { Matrix4 } from "three/src/math/Matrix4.js";
import { Vector3 } from "three/src/math/Vector3.js";
import { Mesh } from "three/src/objects/Mesh.js";
import type { Texture } from "three/src/textures/Texture.js";
import { Move } from "../../../../alg";
import type { KPuzzle, KTransformation } from "../../../../kpuzzle";
import type { StickerDat, StickerDatFace } from "../../../../puzzle-geometry";
import {
  type ExperimentalStickeringMask,
  experimentalGetFaceletStickeringMask,
} from "../../../../puzzles/cubing-private";
import type { FaceletMeshStickeringMask } from "../../../../puzzles/stickerings/mask";
import type { PuzzlePosition } from "../../../controllers/AnimationTypes";
import { smootherStep } from "../../../controllers/easing";
import type { HintFaceletStyle } from "../../../model/props/puzzle/display/HintFaceletProp";
import { TAU } from "../TAU";
import { addCubieBodyLighting, newVertexColorBodyMaterial } from "./CubieStyle";
import type { VertexRange } from "./SolidPieceGeometry";
import {
  faceletAppearance,
  faceletAppearanceKey,
  HINT_MATERIAL_INDEX,
  type PiecePlan,
  type PuzzlePlan,
  writeColor,
} from "./StickerlessPlan";
import type { Twisty3DPuzzle } from "./Twisty3DPuzzle";

/**
 * Draws a puzzle as solid pieces of colored plastic, the way `Cube3D` draws the
 * 3×3×3, for any puzzle whose pieces a planner in {@link PuzzlePlan} can cut.
 *
 * The difference from `Cube3D` that shapes everything here: a piece is drawn at
 * a *slot* rather than followed around the puzzle. Each mesh stays where it is
 * and takes on the colors of whichever piece is currently there, which is how
 * `PG3D` works too, and it means this renderer never has to know an orbit's
 * orientation convention — only which slots a move sweeps.
 */

const invisibleMaterial = new MeshBasicMaterial({ visible: false });

interface Piece {
  mesh: Mesh;
  colors: BufferAttribute;
  home: Matrix4;
}

/** Where one facelet of the puzzle lives, and what it is currently showing. */
interface FaceletSlot {
  piece: Piece;
  faceStyle: number;
  body: VertexRange[];
  hint: VertexRange[];
  /** Which face and masks the colors currently written here came from. */
  appearanceKey: number;
  /** The masks this facelet contributes when another slot displays it. */
  mask: FaceletMeshStickeringMask;
  hintMask: FaceletMeshStickeringMask;
}

interface AxisInfo {
  axis: Vector3;
  order: number;
}

export interface Stickerless3DOptions {
  hintFacelets?: HintFaceletStyle;
  stickeringMask?: ExperimentalStickeringMask;
}

export class Stickerless3D extends Object3D implements Twisty3DPuzzle {
  #pieces: Piece[] = [];
  /** Indexed `[orbit][ori][ord]`, like the orbits of the `KPuzzle`. */
  #facelets: Record<string, FaceletSlot[][]> = {};
  #axesInfo: Record<string, AxisInfo> = {};
  #controlTargets: Object3D[] = [];
  #materials: Material[];
  #bodyMaterial: Material;
  #hintMaterial: Material;
  #appearances = new Map<number, Uint8Array>();
  /** Pieces rotated away from their home position by the last frame. */
  #turningPieces: Piece[] = [];
  /** Which pieces each quantum move sweeps, by the move's notation. */
  #turnedPieces = new Map<string, Piece[]>();
  #dirtyColors = new Set<BufferAttribute>();
  #lastPosition: PuzzlePosition | null = null;
  #pendingStickeringUpdate = false;

  constructor(
    private scheduleRenderCallback: () => void,
    private kpuzzle: KPuzzle,
    private stickerDat: StickerDat,
    private plan: PuzzlePlan,
    options: Stickerless3DOptions = {},
  ) {
    super();
    this.#hintMaterial = new MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      // Hint facelets show the faces turned away from the camera, so they are
      // drawn from the inside out.
      side: BackSide,
    });
    this.#bodyMaterial = newVertexColorBodyMaterial();
    this.#materials = [this.#bodyMaterial, this.#hintMaterial];
    this.experimentalUpdateOptions({
      hintFacelets: options.hintFacelets ?? "floating",
    });

    for (const axis of stickerDat.axis) {
      this.#axesInfo[axis.quantumMove.family] = {
        axis: new Vector3(...axis.coordinates),
        order: axis.order,
      };
    }

    for (const piecePlan of plan.pieces) {
      this.#addPiece(piecePlan);
    }

    addCubieBodyLighting(this);
    for (const face of stickerDat.faces) {
      this.#addControlTarget(face);
    }
    this.scale.setScalar(plan.scale);

    if (options.stickeringMask) {
      this.setStickeringMask(options.stickeringMask);
    }
  }

  #addPiece(plan: PiecePlan): void {
    const mesh = new Mesh(plan.geometry, this.#materials);
    mesh.matrixAutoUpdate = false;
    mesh.matrix.copy(plan.home);
    this.add(mesh);
    const piece: Piece = { mesh, colors: plan.colors, home: plan.home };
    this.#pieces.push(piece);

    const orbitFacelets = (this.#facelets[plan.orbit] ??= []);
    for (const facelet of plan.facelets) {
      (orbitFacelets[facelet.ori] ??= [])[plan.ord] = {
        piece,
        faceStyle: facelet.faceStyle,
        body: facelet.body,
        hint: facelet.hint,
        appearanceKey: -1,
        mask: "regular",
        hintMask: "regular",
      };
    }
  }

  #addControlTarget(face: StickerDatFace): void {
    const { coords } = face;
    const triangles = coords.length / 3 - 2;
    const positions = new Float32Array(9 * triangles);
    for (let triangle = 0; triangle < triangles; triangle++) {
      for (const [vertex, source] of [
        0,
        triangle + 1,
        triangle + 2,
      ].entries()) {
        for (let axis = 0; axis < 3; axis++) {
          positions[9 * triangle + 3 * vertex + axis] =
            coords[3 * source + axis];
        }
      }
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(positions, 3));
    const mesh = new Mesh(geometry, invisibleMaterial);
    mesh.userData["quantumMove"] =
      this.stickerDat.notationMapper.notationToExternal(new Move(face.name));
    mesh.scale.setScalar(0.99);
    this.add(mesh);
    this.#controlTargets.push(mesh);
  }

  dispose(): void {
    for (const piece of this.#pieces) {
      piece.mesh.geometry.dispose();
    }
    this.#bodyMaterial.dispose();
    this.#hintMaterial.dispose();
  }

  experimentalGetStickerTargets(): Object3D[] {
    return [];
  }

  experimentalGetControlTargets(): Object3D[] {
    return this.#controlTargets;
  }

  #isValidMove(move: Move): boolean {
    try {
      this.kpuzzle.moveToTransformation(move);
      return true;
    } catch {
      return false;
    }
  }

  getClosestMoveToAxis(
    point: Vector3,
    transformations: {
      invert: boolean;
      depth?: "secondSlice" | "rotation" | "none";
    },
  ): { move: Move; order: number } | null {
    let closestMove: Move | null = null;
    let closestMoveDotProduct = 0;

    let modify: (move: Move) => Move = (m) => m;
    switch (transformations.depth) {
      case "secondSlice": {
        modify = (m: Move) => m.modified({ innerLayer: 2 });
        break;
      }
      case "rotation": {
        modify = (m: Move) => m.modified({ family: `${m.family}v` });
        break;
      }
    }

    for (const axis of this.stickerDat.axis) {
      const product = point.dot(new Vector3(...axis.coordinates));
      if (product > closestMoveDotProduct) {
        const modified = this.stickerDat.notationMapper.notationToExternal(
          modify(axis.quantumMove),
        );
        if (!modified || !this.#isValidMove(modified)) {
          continue;
        }
        closestMoveDotProduct = product;
        closestMove = modified;
      }
    }

    if (!closestMove) {
      return null;
    }
    if (transformations.invert) {
      closestMove = closestMove.invert();
    }
    const order = this.kpuzzle
      .moveToTransformation(closestMove)
      .repetitionOrder();
    return { move: closestMove, order };
  }

  setStickeringMask(stickeringMask: ExperimentalStickeringMask): void {
    // A picture cube needs a sticker to print on, which a solid piece of
    // plastic doesn't have. Leave the plastic in its own colors.
    for (const orbitDefinition of stickeringMask.specialBehaviour === "picture"
      ? []
      : this.kpuzzle.definition.orbits) {
      const { orbitName, numPieces, numOrientations } = orbitDefinition;
      const orbitFacelets = this.#facelets[orbitName];
      if (!orbitFacelets) {
        continue;
      }
      for (let ori = 0; ori < numOrientations; ori++) {
        for (let ord = 0; ord < numPieces; ord++) {
          const facelet = orbitFacelets[ori]?.[ord];
          if (!facelet) {
            continue;
          }
          facelet.mask = experimentalGetFaceletStickeringMask(
            stickeringMask,
            orbitName,
            ord,
            ori,
            false,
          );
          facelet.hintMask = experimentalGetFaceletStickeringMask(
            stickeringMask,
            orbitName,
            ord,
            ori,
            true,
          );
        }
      }
    }
    this.#pendingStickeringUpdate = true;
    if (this.#lastPosition) {
      this.onPositionChange(this.#lastPosition);
    }
  }

  /** @deprecated */
  experimentalUpdateOptions(options: {
    showMainStickers?: boolean;
    hintFacelets?: HintFaceletStyle;
    showFoundation?: boolean; // A stickerless piece is solid; there is nothing to show through it.
    hintStickerOpacity?: number;
    faceletScale?: "auto" | number;
  }): void {
    if (options.hintFacelets !== undefined) {
      this.#materials[HINT_MATERIAL_INDEX] =
        options.hintFacelets === "none"
          ? invisibleMaterial
          : this.#hintMaterial;
      this.scheduleRenderCallback();
    }
  }

  /** @deprecated */
  experimentalUpdateTexture(
    enabled: boolean,
    stickerTexture?: Texture | null,
    _hintTexture?: Texture | null,
  ): void {
    // Picture cubes need a sticker to print on, which a solid piece of plastic
    // doesn't have. A sprite that was set before the puzzle was built sends it
    // to `PG3D` instead (see `pg3dShim`); one set afterwards is too late.
    if (enabled && stickerTexture) {
      console.warn(
        "Sprites are not supported for stickerless pieces. For now, set the sprite before creating the TwistyPlayer.",
      );
    }
  }

  onPositionChange(position: PuzzlePosition): void {
    const { pattern } = position;
    if (
      this.#pendingStickeringUpdate ||
      !this.#lastPosition ||
      !this.#lastPosition.pattern.isIdentical(pattern)
    ) {
      this.#updateColors(position);
      this.#lastPosition = position;
      this.#pendingStickeringUpdate = false;
    }

    for (const piece of this.#turningPieces) {
      piece.mesh.matrix.copy(piece.home);
    }
    this.#turningPieces.length = 0;

    const turnMatrix = new Matrix4();
    for (const moveProgress of position.movesInProgress) {
      const move = moveProgress.move;
      const unswizzled = this.stickerDat.unswizzle(move);
      if (!unswizzled) {
        continue;
      }
      const axisInfo = this.#axesInfo[unswizzled.family];
      if (!axisInfo) {
        continue;
      }
      turnMatrix.makeRotationAxis(
        axisInfo.axis,
        (-smootherStep(moveProgress.fraction) *
          moveProgress.direction *
          unswizzled.amount *
          TAU) /
          axisInfo.order,
      );
      for (const piece of this.#piecesTurnedBy(move)) {
        piece.mesh.matrix.premultiply(turnMatrix);
        this.#turningPieces.push(piece);
      }
    }

    this.scheduleRenderCallback();
  }

  /**
   * The pieces a single quantum of `move` sweeps: the ones whose slot does not
   * map to itself.
   */
  #piecesTurnedBy(move: Move): Piece[] {
    const quantum = move.modified({ amount: 1 });
    const key = quantum.toString();
    const cached = this.#turnedPieces.get(key);
    if (cached) {
      return cached;
    }
    const pieces: Piece[] = [];
    const { transformationData } = this.#quantumTransformation(quantum);
    for (const orbitName in this.#facelets) {
      const orbitTransformation = transformationData[orbitName];
      if (!orbitTransformation) {
        continue;
      }
      const { permutation, orientationDelta } = orbitTransformation;
      // Every facelet of a piece moves with it, so the first orientation is
      // enough to reach each piece exactly once.
      const slots = this.#facelets[orbitName][0];
      for (let ord = 0; ord < permutation.length; ord++) {
        if (permutation[ord] !== ord || orientationDelta[ord] !== 0) {
          const slot = slots[ord];
          if (slot) {
            pieces.push(slot.piece);
          }
        }
      }
    }
    this.#turnedPieces.set(key, pieces);
    return pieces;
  }

  #quantumTransformation(quantum: Move): KTransformation {
    try {
      return this.kpuzzle.moveToTransformation(quantum);
    } catch (e) {
      // The external notation didn't have a quantum of its own. Try going
      // through the internal notation and back, which is what makes e.g. "x2"
      // work on puzzles whose rotations are only defined in one direction.
      const internal =
        this.stickerDat.notationMapper.notationToInternal(quantum);
      const external =
        internal &&
        this.stickerDat.notationMapper.notationToExternal(
          internal.modified({ amount: 1 }),
        );
      if (!external) {
        throw e;
      }
      return this.kpuzzle.moveToTransformation(external);
    }
  }

  /** Repaints every slot with the colors of whatever piece is now in it. */
  #updateColors(position: PuzzlePosition): void {
    for (const orbitName in this.#facelets) {
      const orbitFacelets = this.#facelets[orbitName];
      const orbitPattern = position.pattern.patternData[orbitName];
      const numOrientations = orbitFacelets.length;
      for (let ori = 0; ori < numOrientations; ori++) {
        const slots = orbitFacelets[ori];
        for (let ord = 0; ord < slots.length; ord++) {
          const slot = slots[ord];
          if (!slot) {
            continue;
          }
          // The piece in this slot shows the facelet that its own orientation
          // has brought around to this side.
          const sourceOri =
            numOrientations === 1
              ? 0
              : (ori + numOrientations - orbitPattern.orientation[ord]) %
                numOrientations;
          const source = orbitFacelets[sourceOri][orbitPattern.pieces[ord]];
          const key = faceletAppearanceKey(
            source.faceStyle,
            source.mask,
            source.hintMask,
          );
          if (key === slot.appearanceKey) {
            continue;
          }
          slot.appearanceKey = key;
          if (slot.body.length === 0 && slot.hint.length === 0) {
            continue;
          }
          const appearance = faceletAppearance(
            this.#appearances,
            this.plan.faceStyles,
            source.faceStyle,
            source.mask,
            source.hintMask,
          );
          writeColor(slot.piece.colors, slot.body, appearance);
          writeColor(slot.piece.colors, slot.hint, appearance, 4);
          this.#dirtyColors.add(slot.piece.colors);
        }
      }
    }
    for (const colors of this.#dirtyColors) {
      colors.needsUpdate = true;
    }
    this.#dirtyColors.clear();
  }
}
