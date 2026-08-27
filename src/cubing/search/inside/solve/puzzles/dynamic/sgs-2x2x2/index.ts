import { LazyPromise } from "@cubing/lazy-promise";

export const searchDynamicSGS2x2x2 = new LazyPromise(
  () => import("./search-dynamic-sgs-2x2x2"),
);
