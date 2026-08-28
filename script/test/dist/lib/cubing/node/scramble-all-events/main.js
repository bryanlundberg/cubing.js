import { Path } from "path-class";
import { needPath } from "../../../../../../lib/needPath.js";

await needPath(
  Path.resolve(
    "../../../../../../../dist/lib/cubing/scramble",
    import.meta.url,
  ),
  "make build-lib-js",
);

import "@rednaxela101/cubing/alg";
import "@rednaxela101/cubing/bluetooth";
import "@rednaxela101/cubing/kpuzzle";
import "@rednaxela101/cubing/notation";
import "@rednaxela101/cubing/protocol";
import "@rednaxela101/cubing/puzzle-geometry";
import "@rednaxela101/cubing/puzzles";
import "@rednaxela101/cubing/scramble";
import "@rednaxela101/cubing/search";
import "@rednaxela101/cubing/stream";
import "@rednaxela101/cubing/twisty";

import { setSearchDebug } from "@rednaxela101/cubing/search";

setSearchDebug({ scramblePrefetchLevel: "none" });

import { randomScrambleForEvent } from "@rednaxela101/cubing/scramble";

const eventsOrdered = [
  "444",
  "444bf",
  "fto",
  "333",
  "222",
  "555",
  "666",
  "777",
  "333bf",
  "333fm",
  "333oh",
  "clock",
  "minx",
  "pyram",
  "skewb",
  "sq1",
  "555bf",
  "333mbf",
];

const eventsParallel = [];
const DEFAULT_TIMEOUT_MS = 30_000; // TODO: Use `Temporal.Duration.from(…)` once `Temporal` is available in `bun`: https://github.com/oven-sh/bun/issues/15853

function withTimeout(promiseFn, { abortSignal, timeoutMS } = {}) {
  const { promise: wrappedPromise, resolve, reject } = Promise.withResolvers();

  const timeout = setTimeout(() => {
    abortSignal?.();
    reject(new Error(`Timed out for event: ${event}`));
  }, timeoutMS ?? DEFAULT_TIMEOUT_MS);

  void (async () => {
    await promiseFn();
    // Types are a bit borked, so `timeout.unref()` isn't recognized as valid.
    // Fortunately the DOM API is still valid in `node`, so we call that instead.
    clearTimeout(timeout);
    resolve();
  })();

  return wrappedPromise;
}

async function testEvent(event) {
  await withTimeout(async () =>
    (await randomScrambleForEvent(event)).log(event),
  );
}

await (async () => {
  setSearchDebug({ forceNewWorkerForEveryScramble: true });
  const parallelPromise = Promise.all(eventsParallel.map(testEvent));
  setSearchDebug({ forceNewWorkerForEveryScramble: false });
  for (const event of eventsOrdered) {
    console.log(`Generating scramble for event: ${event}... `);
    await testEvent(event);
  }
  await parallelPromise;

  console.log("Success!");
})();
