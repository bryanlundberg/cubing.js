import { SimpleTwistyPropSource } from "../../TwistyProp";

// Some 2D SVGs (currently the Megaminx last-layer diagram) draw a ring outside
// the puzzle outline, colored with the face each side belongs to, as an
// orientation reference. This controls whether that ring is drawn.
export const faceColorBorderStyles = {
  auto: true, // default: drawn wherever the SVG provides one
  none: true,
};
export type FaceColorBorderStyle = keyof typeof faceColorBorderStyles;

export class FaceColorBorderProp extends SimpleTwistyPropSource<FaceColorBorderStyle> {
  getDefaultValue(): FaceColorBorderStyle {
    return "auto";
  }
}
