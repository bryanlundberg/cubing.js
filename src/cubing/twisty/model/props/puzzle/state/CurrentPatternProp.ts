import type { KTransformation } from "../../../../../kpuzzle";
import type { KPattern } from "../../../../../kpuzzle/KPattern";
import { TwistyPropDerived } from "../../TwistyProp";

interface CurrentPatternPropInputs {
  currentTransformation: KTransformation;
}

export class CurrentPatternProp extends TwistyPropDerived<
  CurrentPatternPropInputs,
  KPattern
> {
  derive(inputs: CurrentPatternPropInputs): KPattern {
    return inputs.currentTransformation.toKPattern(); // kpuzzle todo
  }
}
