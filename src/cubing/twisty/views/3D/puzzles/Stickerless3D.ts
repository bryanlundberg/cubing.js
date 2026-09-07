import { BackSide } from "three/src/constants.js";
import { BufferAttribute } from "three/src/core/BufferAttribute.js";
import { BufferGeometry } from "three/src/core/BufferGeometry.js";
import { Object3D } from "three/src/core/Object3D.js";
import type { Material } from "three/src/materials/Material.js";
import { MeshBasicMaterial } from "three/src/materials/MeshBasicMaterial.js";
import { Matrix4 } from "three/src/math/Matrix4.js";
import { Vector3 } from "three/src/math/Vector3.js";
import { BatchedMesh } from "three/src/objects/BatchedMesh.js";
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
import { newVertexColorBodyMaterial } from "./CubieStyle";
import {
  type FaceletAddress,
  type FaceletSurface,
  newLogoMesh,
  surfaceMatrix,
} from "./PuzzleLogo";
import type { VertexRange } from "./SolidPieceGeometry";
import {
  faceletAppearance,
  faceletAppearanceKey,
  type PieceMesh,
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

function newBatch(meshes: PieceMesh[], material: Material): BatchedMesh {
  let vertices = 0;
  let indices = 0;
  for (const { geometry } of meshes) {
    vertices += geometry.getAttribute("position").count;
    indices += geometry.getIndex()?.count ?? 0;
  }
  return new BatchedMesh(meshes.length, vertices, indices, material);
}

/** Copies one piece's geometry in, and returns where the batch put it. */
function addToBatch(
  batch: BatchedMesh,
  mesh: PieceMesh,
  home: Matrix4,
): { instance: number; vertexStart: number } {
  const geometryId = batch.addGeometry(mesh.geometry);
  const instance = batch.addInstance(geometryId);
  batch.setMatrixAt(instance, home);
  mesh.geometry.dispose();
  // `getGeometryRangeAt` reports more than the types admit to.
  const range = batch.getGeometryRangeAt(geometryId) as unknown as {
    vertexStart: number;
  };
  return { instance, vertexStart: range.vertexStart };
}

interface Piece {
  /** Where this piece sits in each batch. -1 when it has no hint facelet. */
  bodyInstance: number;
  hintInstance: number;
  home: Matrix4;
  /** Where it is right now, which is `home` unless a move is sweeping it. */
  matrix: Matrix4;
  turning: boolean;
}

/** Where one facelet of the puzzle lives, and what it is currently showing. */
interface FaceletSlot {
  piece: Piece;
  faceStyle: number;
  /** Vertices in the batch's own color attribute, not the piece's. */
  body: VertexRange[];
  hint: VertexRange[];
  /** Which face and masks the colors currently written here came from. */
  appearanceKey: number;
  /** The masks this facelet contributes when another slot displays it. */
  mask: FaceletMeshStickeringMask;
  hintMask: FaceletMeshStickeringMask;
  /** Where a logo shown in this slot sits, in the piece's own frame. */
  logo: FaceletSurface | null;
}

interface AxisInfo {
  axis: Vector3;
  order: number;
}

export interface Stickerless3DOptions {
  hintFacelets?: HintFaceletStyle;
  stickeringMask?: ExperimentalStickeringMask;
  /** The facelet {@link Stickerless3D.experimentalSetLogo} prints on. */
  logoFacelet?: FaceletAddress | null;
}

export class Stickerless3D extends Object3D implements Twisty3DPuzzle {
  #pieces: Piece[] = [];
  /**
   * One draw call for every piece of the puzzle, and one for every hint
   * facelet. A batch keeps a matrix per instance, so a move still moves the
   * pieces it sweeps and nothing else.
   */
  #bodyBatch: BatchedMesh;
  #hintBatch: BatchedMesh | null = null;
  #bodyColors: BufferAttribute;
  #hintColors: BufferAttribute | null = null;
  /** Indexed `[orbit][ori][ord]`, like the orbits of the `KPuzzle`. */
  #facelets: Record<string, FaceletSlot[][]> = {};
  #axesInfo: Record<string, AxisInfo> = {};
  #controlTargets: Object3D[] = [];
  #bodyMaterial: Material;
  #hintMaterial: Material;
  #appearances = new Map<number, Uint8Array>();
  /** Pieces rotated away from their home position by the last frame. */
  #turningPieces: Piece[] = [];
  /** Which pieces each quantum move sweeps, by the move's notation. */
  #turnedPieces = new Map<string, Piece[]>();
  /** The span of each color attribute that changed, so only it is uploaded. */
  #dirtyColors = new Map<BufferAttribute, { first: number; last: number }>();
  #lastPosition: PuzzlePosition | null = null;
  #pendingStickeringUpdate = false;
  /** The facelet a logo is printed on, and where it currently shows. */
  #logoFacelet: FaceletAddress | null = null;
  #logoMesh: Mesh | null = null;
  #logoSlot: FaceletSlot | null = null;
  #logoSurfaceMatrix = new Matrix4();

  constructor(
    private scheduleRenderCallback: () => void,
    private kpuzzle: KPuzzle,
    private stickerDat: StickerDat,
    private plan: PuzzlePlan,
    options: Stickerless3DOptions = {},
  ) {
    super();
    this.#logoFacelet = options.logoFacelet ?? null;
    this.#hintMaterial = new MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      // Hint facelets show the faces turned away from the camera, so they are
      // drawn from the inside out.
      side: BackSide,
    });
    this.#bodyMaterial = newVertexColorBodyMaterial();

    for (const axis of stickerDat.axis) {
      this.#axesInfo[axis.quantumMove.family] = {
        axis: new Vector3(...axis.coordinates),
        order: axis.order,
      };
    }

    this.#bodyBatch = newBatch(
      plan.pieces.map((piecePlan) => piecePlan.body),
      this.#bodyMaterial,
    );
    // Opaque and always on screen, so neither sorting nor culling per piece
    // buys anything, and skipping both lets the batch sit still between moves.
    this.#bodyBatch.sortObjects = false;
    this.#bodyBatch.perObjectFrustumCulled = false;
    this.add(this.#bodyBatch);

    const hints = plan.pieces
      .map((piecePlan) => piecePlan.hint)
      .filter((hint) => hint !== null);
    if (hints.length > 0) {
      this.#hintBatch = newBatch(hints, this.#hintMaterial);
      this.#hintBatch.perObjectFrustumCulled = false;
      this.add(this.#hintBatch);
    }
    for (const piecePlan of plan.pieces) {
      this.#addPiece(piecePlan);
    }
    // A batch has no buffers of its own until the first geometry goes in.
    this.#bodyColors = this.#bodyBatch.geometry.getAttribute(
      "color",
    ) as BufferAttribute;
    this.#hintColors =
      (this.#hintBatch?.geometry.getAttribute("color") as BufferAttribute) ??
      null;
    this.experimentalUpdateOptions({
      hintFacelets: options.hintFacelets ?? "floating",
    });

    for (const face of stickerDat.faces) {
      this.#addControlTarget(face);
    }
    this.scale.setScalar(plan.scale);

    if (options.stickeringMask) {
      this.setStickeringMask(options.stickeringMask);
    }
  }

  #addPiece(plan: PiecePlan): void {
    const bodyInstance = addToBatch(this.#bodyBatch, plan.body, plan.home);
    const hintInstance =
      plan.hint && this.#hintBatch
        ? addToBatch(this.#hintBatch, plan.hint, plan.home)
        : -1;
    const piece: Piece = {
      bodyInstance: bodyInstance.instance,
      hintInstance: hintInstance === -1 ? -1 : hintInstance.instance,
      home: plan.home,
      matrix: plan.home.clone(),
      turning: false,
    };
    this.#pieces.push(piece);

    // A facelet's vertices sit wherever the batch put the piece's geometry.
    const shift = (ranges: VertexRange[], offset: number) =>
      ranges.map((range) => ({
        start: range.start + offset,
        count: range.count,
      }));
    const orbitFacelets = (this.#facelets[plan.orbit] ??= []);
    for (const facelet of plan.facelets) {
      (orbitFacelets[facelet.ori] ??= [])[plan.ord] = {
        piece,
        faceStyle: facelet.faceStyle,
        body: shift(facelet.body, bodyInstance.vertexStart),
        hint:
          hintInstance === -1
            ? []
            : shift(facelet.hint, hintInstance.vertexStart),
        appearanceKey: -1,
        mask: "regular",
        hintMask: "regular",
        logo: facelet.logo,
      };
    }
  }

  #setMatrix(piece: Piece): void {
    this.#bodyBatch.setMatrixAt(piece.bodyInstance, piece.matrix);
    if (piece.hintInstance !== -1) {
      this.#hintBatch!.setMatrixAt(piece.hintInstance, piece.matrix);
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

  /**
   * Prints a logo on the piece this puzzle keeps one on, or takes it off again
   * when passed `null`.
   *
   * The image is stretched onto the square {@link PuzzlePlan} sized for that
   * facelet, so its own proportions don't matter. It follows the piece: the
   * logo is drawn wherever the piece currently is, including part-way through a
   * move. The one thing it does not follow is a piece turning in place — a
   * megaminx or skewb center whose facelets are all one square — which leaves
   * the logo upright rather than rotating it with the plastic.
   */
  experimentalSetLogo(texture: Texture | null): void {
    if (!texture || !this.#logoFacelet) {
      this.#disposeLogo();
      this.scheduleRenderCallback();
      return;
    }
    if (this.#logoMesh) {
      const material = this.#logoMesh.material as MeshBasicMaterial;
      material.map = texture;
      material.needsUpdate = true;
    } else {
      this.#logoMesh = newLogoMesh(texture);
      this.add(this.#logoMesh);
    }
    this.#updateLogoSlot();
    this.#placeLogo();
    this.scheduleRenderCallback();
  }

  #disposeLogo(): void {
    if (!this.#logoMesh) {
      return;
    }
    this.remove(this.#logoMesh);
    (this.#logoMesh.material as MeshBasicMaterial).dispose();
    this.#logoMesh = null;
    this.#logoSlot = null;
  }

  /** Which slot is showing the logo's facelet, as of the last position. */
  #updateLogoSlot(): void {
    this.#logoSlot = null;
    const address = this.#logoFacelet;
    const pattern = this.#lastPosition?.pattern;
    if (!address || !pattern) {
      return;
    }
    const orbitFacelets = this.#facelets[address.orbit];
    const orbitPattern = pattern.patternData[address.orbit];
    if (!orbitFacelets || !orbitPattern) {
      return;
    }
    const numOrientations = orbitFacelets.length;
    for (let ord = 0; ord < orbitPattern.pieces.length; ord++) {
      if (orbitPattern.pieces[ord] !== address.ord) {
        continue;
      }
      // The mirror of the lookup in `#updateColors`: a piece's own facelet
      // comes around to the slot facelet its orientation has carried it to.
      const ori =
        numOrientations === 1
          ? 0
          : (address.ori + orbitPattern.orientation[ord]) % numOrientations;
      this.#logoSlot = orbitFacelets[ori]?.[ord] ?? null;
      return;
    }
  }

  #placeLogo(): void {
    const mesh = this.#logoMesh;
    if (!mesh) {
      return;
    }
    const slot = this.#logoSlot;
    if (!slot?.logo) {
      mesh.visible = false;
      return;
    }
    mesh.visible = true;
    mesh.matrix.multiplyMatrices(
      slot.piece.matrix,
      surfaceMatrix(slot.logo, this.#logoSurfaceMatrix),
    );
    mesh.matrixWorldNeedsUpdate = true;
  }

  dispose(): void {
    this.#disposeLogo();
    this.#bodyBatch.dispose();
    this.#bodyBatch.geometry.dispose();
    this.#hintBatch?.dispose();
    this.#hintBatch?.geometry.dispose();
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
    if (options.hintFacelets !== undefined && this.#hintBatch) {
      this.#hintBatch.visible = options.hintFacelets !== "none";
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
      this.#updateLogoSlot();
    }

    const wereTurning = this.#turningPieces;
    for (const piece of wereTurning) {
      piece.turning = false;
    }
    this.#turningPieces = [];

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
        if (!piece.turning) {
          piece.turning = true;
          piece.matrix.copy(piece.home);
          this.#turningPieces.push(piece);
        }
        piece.matrix.premultiply(turnMatrix);
      }
    }

    for (const piece of wereTurning) {
      if (!piece.turning) {
        piece.matrix.copy(piece.home);
        this.#setMatrix(piece);
      }
    }
    for (const piece of this.#turningPieces) {
      this.#setMatrix(piece);
    }
    // After the matrices, since the logo rides on whichever piece is under it.
    this.#placeLogo();

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
          this.#paint(this.#bodyColors, slot.body, appearance, 0);
          if (this.#hintColors) {
            this.#paint(this.#hintColors, slot.hint, appearance, 4);
          }
        }
      }
    }
    for (const [colors, span] of this.#dirtyColors) {
      // In elements, not vertices, which is what `WebGLAttributes` slices by.
      colors.addUpdateRange(4 * span.first, 4 * (span.last - span.first + 1));
      colors.needsUpdate = true;
    }
    this.#dirtyColors.clear();
  }

  #paint(
    colors: BufferAttribute,
    ranges: VertexRange[],
    appearance: Uint8Array,
    offset: number,
  ): void {
    if (ranges.length === 0) {
      return;
    }
    writeColor(colors, ranges, appearance, offset);
    let span = this.#dirtyColors.get(colors);
    if (!span) {
      span = { first: Number.POSITIVE_INFINITY, last: 0 };
      this.#dirtyColors.set(colors, span);
    }
    for (const range of ranges) {
      span.first = Math.min(span.first, range.start);
      span.last = Math.max(span.last, range.start + range.count - 1);
    }
  }
}
