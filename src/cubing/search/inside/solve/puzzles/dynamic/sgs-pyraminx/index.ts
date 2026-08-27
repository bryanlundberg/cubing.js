import { LazyPromise } from "@cubing/lazy-promise";

export const searchDynamicSGSpyraminx = new LazyPromise(
  () => import("./search-dynamic-sgs-pyraminx"),
);
