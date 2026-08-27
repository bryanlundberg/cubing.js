import { LazyPromise } from "@cubing/lazy-promise";

export const searchDynamicSGSmegaminx = new LazyPromise(
  () => import("./search-dynamic-sgs-megaminx"),
);
