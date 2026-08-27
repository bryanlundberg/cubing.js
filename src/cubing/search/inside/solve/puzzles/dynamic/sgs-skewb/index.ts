import { LazyPromise } from "@cubing/lazy-promise";

export const searchDynamicSGSskewb = new LazyPromise(
  () => import("./search-dynamic-sgs-skewb"),
);
