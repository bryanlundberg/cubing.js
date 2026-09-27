import type { KTransformation } from "../../../../../kpuzzle";
import type { AlgIndexer } from "../../../../controllers/indexer/AlgIndexer";
import { TwistyPropDerived } from "../../TwistyProp";
import type { CurrentLeavesSimplified } from "./CurrentLeavesSimplified";

interface CurrentTransformationPropInputs {
  anchoredStart: KTransformation; // kpuzzle todo: KPattern?
  currentLeavesSimplified: CurrentLeavesSimplified;
  indexer: AlgIndexer;
}

// TODO: Make this so we don't have to handle the finishing moves?
export class CurrentTransformationProp extends TwistyPropDerived<
  CurrentTransformationPropInputs,
  KTransformation
> {
  derive(inputs: CurrentTransformationPropInputs): KTransformation {
    let transformation: KTransformation = inputs.indexer.transformationAtIndex(
      inputs.currentLeavesSimplified.patternIndex,
    );
    transformation = inputs.anchoredStart.applyTransformation(transformation);

    // TODO: handle non-commutative finished/finishing/current moves.
    for (const finishingMove of inputs.currentLeavesSimplified.movesFinishing) {
      transformation = transformation.applyMove(finishingMove);
    }
    for (const finishedMove of inputs.currentLeavesSimplified.movesFinished) {
      transformation = transformation.applyMove(finishedMove);
    }
    return transformation;
  }
}
