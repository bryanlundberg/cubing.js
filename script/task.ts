#!/usr/bin/env -S bun run --

/**
 * Cross-platform task runner for this repo.
 *
 * Usage:
 *
 *     bun run task <task-name>…
 *     bun run task --list
 *
 * This replaces the `Makefile` that used to drive the project. Its recipes
 * assumed `make` plus a POSIX shell and coreutils (`rm -rf`, `cp -R`, `test -d`,
 * `command -v`, …), none of which exist on a stock Windows install. `bun` is
 * already a hard requirement of this repo (see `engines` in `package.json`), and
 * every real build step was already a `.ts` script, so the tasks below are
 * expressed in TypeScript instead of in shell.
 *
 * The `Makefile` is kept as a thin forwarder, so `make <task>` keeps working
 * wherever `make` happens to be installed.
 */

import { argv, env, exit, platform } from "node:process";
import { Path } from "path-class";
import { PrintableShellCommand } from "printable-shell-command";
import { needPath } from "./lib/needPath.js";

const WINDOWS = platform === "win32";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type Args = (string | Path)[];

interface RunOptions {
  cwd?: string | Path;
  env?: Record<string, string | undefined>;
}

async function run(
  command: string | Path,
  args: Args = [],
  options: RunOptions = {},
): Promise<void> {
  await new PrintableShellCommand(command, args).shellOut({
    cwd: options.cwd,
    env: options.env ? { ...env, ...options.env } : undefined,
  });
}

/** Equivalent to the old `${BUN_RUN}`. */
function bunRun(script: string, args: Args = []): Promise<void> {
  return run("bun", ["run", "--", script, ...args]);
}

/**
 * Resolves a binary provided by a dev dependency.
 *
 * The `Makefile` used to invoke these through `bun x -- bun-dx --package …`, but
 * `bun-dx` cannot run on Windows: its `bin` is a `.ts` file with a
 * `#!/usr/bin/env -S bun run --` shebang, and bun's Windows shim fails on the
 * `-S` with `interpreter executable "-S" not found in %PATH%`. The
 * `node_modules/.bin/…` shims themselves work fine on every platform, and every
 * package below is a declared dev dependency, so we use those directly.
 *
 * These shims run under `node`. For the tools that need bun's resolver instead,
 * see {@link bunBinRun}.
 */
async function localBin(name: string): Promise<Path> {
  const path = new Path("./node_modules/.bin").join(
    WINDOWS ? `${name}.exe` : name,
  );
  await needPath(path, "bun run task setup");
  return path;
}

function binRun(name: string, args: Args = []): Promise<void> {
  return localBin(name).then((bin) => run(bin, args));
}

/**
 * Runs a dev dependency's bin under `bun` instead of through its
 * `node_modules/.bin/…` shim (which `node` executes).
 *
 * Required in three cases:
 *
 * - the bin is itself TypeScript (`bun-dedupe`);
 * - the bin has a `#!/usr/bin/env -S bun run --` shebang, which bun's Windows
 *   shim cannot interpret (`@cubing/dev-config`);
 * - the tool loads a TypeScript config that uses extensionless intra-repo
 *   imports (`tsdown` loading `tsdown.config.ts`).
 *
 * `node` rejects all three. This is what `bun-dx` used to give us for every
 * tool. Every other bin here runs fine under `node` via {@link localBin}.
 */
async function bunBinRun(
  packageName: string,
  binName: string,
  args: Args = [],
): Promise<void> {
  const packageDir = new Path("./node_modules").join(packageName);
  const packageJSONPath = packageDir.join("package.json");
  await needPath(packageJSONPath, "bun run task setup");
  const { bin } = await packageJSONPath.readJSON<{
    bin: string | Record<string, string>;
  }>();
  const relativeBinPath = typeof bin === "string" ? bin : bin[binName]!;
  await run("bun", ["run", "--", packageDir.join(relativeBinPath), ...args]);
}

async function rmRF(...paths: string[]): Promise<void> {
  await Promise.all(paths.map((path) => new Path(path).rm_rf()));
}

async function glob(pattern: string, cwd = "."): Promise<string[]> {
  const matches: string[] = [];
  for await (const match of new Bun.Glob(pattern).scan({ cwd })) {
    // `Bun.Glob` yields native separators, but tools we pass these to reject
    // backslashes (`typedoc`: "Glob inputs to TypeDoc may not use Windows path
    // separators"). Forward slashes work on every platform.
    matches.push(match.replaceAll("\\", "/"));
  }
  return matches.sort();
}

/** Replacement for the `time` prefix the shebang tests used to use. */
async function timed(label: string, fn: () => Promise<void>): Promise<void> {
  const start = performance.now();
  try {
    await fn();
  } finally {
    console.log(
      `\n⏱  ${label}: ${((performance.now() - start) / 1000).toFixed(3)}s`,
    );
  }
}

/**
 * On POSIX we execute the built file directly, because exercising the `#!` line
 * is the whole point of these tests. Windows has no equivalent mechanism, so we
 * invoke `node` explicitly there — which still checks that the built binary
 * runs, just not that its shebang is correct.
 */
function runBuiltBin(file: string, args: Args): Promise<void> {
  return WINDOWS ? run("node", ["--", file, ...args]) : run(`./${file}`, args);
}

async function needSiblingRepo(path: string): Promise<Path> {
  const repo = new Path(path);
  if (!(await repo.existsAsDir())) {
    console.error(`\nThis task needs a sibling checkout at: ${repo}\n`);
    exit(1);
  }
  return repo;
}

/**
 * `fs.chmod` is a no-op on Windows, so `dist/bin/` entries built there would be
 * shipped without their executable bit and `scramble` would not run for anyone
 * installing the package on macOS/Linux.
 */
function assertExecutableBitSupport(): void {
  if (WINDOWS) {
    console.error(
      "\nRefusing to pack/publish from Windows: the executable bit cannot be set on `dist/bin/` entries there, which would ship a `scramble` binary that is not executable on macOS/Linux.\n\nPublish from macOS, Linux, or WSL instead.\n",
    );
    exit(1);
  }
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

interface Task {
  /** Shown by `bun run task --list`. */
  description?: string;
  /** Run to completion, in order, before `run`. */
  deps?: string[];
  run?: () => Promise<void>;
}

const VENDORED_TWIPS_GIT_VERSION_TXT =
  "./src/cubing/vendor/mpl/twips/vendored-twips-git-version.txt";

const tasks: Record<string, Task> = {
  default: {
    description: "Print this help.",
    run: async () => {
      console.log(`To work on the project, run:

    bun run task dev

To build the project, run:

    bun run task build

To see available tests, run:

    bun run task test-info

To list every task, run:

    bun run task --list
`);
    },
  },

  check: {
    description: "Run every check in the project.",
    deps: ["lint", "test-all", "build", "check-package.json"],
  },

  // ── Build ────────────────────────────────────────────────────────────────

  // By convention, we'd normally place `build-bin` first, but `build-lib` is the
  // main target and it can be less confusing to build first (especially if the
  // build aborts with an error).
  build: {
    description: "Build the library, the binaries, and the sites.",
    deps: ["build-lib", "build-bin", "build-sites"],
  },
  "build-lib": { deps: ["build-lib-js", "build-lib-types"] },
  "build-lib-js": {
    deps: ["update-dependencies"],
    run: () => bunRun("./script/build/lib/build-lib-js.ts"),
  },
  "build-lib-types": {
    deps: ["update-dependencies"],
    run: async () => {
      await bunBinRun("tsdown", "tsdown");
      await bunRun("./script/build/types/fix-web-bluetooth-reference.ts");
    },
  },
  "build-bin": {
    deps: ["build-lib-js"],
    run: () => bunRun("./script/build/bin/build-bin.ts"),
  },
  "build-sites": { deps: ["build-site-twizzle", "build-site-experiments"] },
  "build-site-twizzle": {
    deps: ["update-dependencies"],
    run: () => bunRun("./script/build/sites/build-site-twizzle.ts"),
  },
  "build-site-experiments": {
    deps: ["update-dependencies"],
    run: () => bunRun("./script/build/sites/build-site-experiments.ts"),
  },
  "build-site-docs": {
    deps: ["update-dependencies"],
    run: async () => {
      await rmRF("./dist/sites/js.cubing.net/");
      await binRun("typedoc", await glob("src/cubing/*/index.ts"));
      await new Path("./src/docs/js.cubing.net/").cp(
        "./dist/sites/js.cubing.net/",
        { recursive: true },
      );
      console.log(
        "\n\nNote: The js.cubing.net docs are deployed to GitHub Pages using GitHub Actions when a commit is pushed to the `main` branch:\nhttps://github.com/cubing/cubing.js/actions/workflows/pages.yaml",
      );
    },
  },

  dev: {
    description: "Run the dev server.",
    deps: ["update-dependencies"],
    run: () => bunRun("./script/build/sites/dev.ts", argv.slice(3)),
  },
  link: {
    deps: ["build"],
    run: () => run("bun", ["link"]),
  },

  // ── Cleanup ──────────────────────────────────────────────────────────────

  clean: {
    description: "Remove build output.",
    run: async () => {
      await bunRun("./script/cleanup/clean-legacy-path-based-type-exports.ts");
      await rmRF("./dist/", "./.temp/", "./package-lock.json");
    },
  },
  reset: {
    description: "Remove build output and dependencies.",
    deps: ["clean"],
    run: async () => {
      await rmRF("./node_modules/");
      console.log(`
To reinstall dependencies, run:

    bun run task setup
`);
    },
  },

  // ── Setup ────────────────────────────────────────────────────────────────

  setup: {
    description: "Install dependencies (including Playwright browsers).",
    deps: ["setup-without-playwright", "install-playwright"],
  },
  "setup-without-playwright": { deps: ["bun-required", "update-dependencies"] },
  "bun-required": {
    run: async () => {
      // This runner is itself launched by `bun`, so reaching this point already
      // implies `bun` is present. The check stays for the case where someone
      // runs the file with another runtime.
      if (typeof Bun === "undefined") {
        console.error(`Please install \`bun\` to work on this project:

    # from npm
    npm install --global bun

    # macOS (Homebrew)
    brew install oven-sh/bun/bun

    # Windows (WinGet)
    winget install --id Oven-sh.Bun

    # For other options, see: https://bun.sh/
`);
        exit(1);
      }
    },
  },
  "update-dependencies": {
    deps: ["bun-required"],
    run: async () => {
      await run("bun", ["install", "--frozen-lockfile"]);
      await bunRun("./script/check-engine-versions.ts");
    },
  },
  "install-playwright": {
    deps: ["update-dependencies"],
    run: () => binRun("playwright", ["install"]),
  },

  // ── Tests ────────────────────────────────────────────────────────────────

  test: { deps: ["test-info"] },
  "test-info": {
    description: "List the available test tasks.",
    run: async () => {
      console.log(`Run one of the following.
(Time estimates are based on a fast computer.)

    bun run task test-src   (≈3s)
    bun run task test-build (≈14s)
    bun run task test-dist  (≈10s)

    bun run task test-all (≈27s, includes all of the above)

Also, if you want to run all possible checks in the project, run:

    bun run task check (≈46s, includes all of the above)

If you want the best "bang for your buck" without running everything, run:

    bun run task check-fast (≈2.5s, includes a subset of the above)
`);
    },
  },

  // The following deps are in a custom order so that the more "useful" tests are
  // first. In case of failure, this is likely to be more helpful.
  "check-fast": {
    description: "The best bang for your buck without running everything.",
    deps: [
      "update-dependencies",
      "build-lib-js",
      "test-ts-bun-fast",
      "build-bin",
      "build-sites",
      "lint-biome",
      "lint-import-restrictions",
      "test-dist-lib-node-import",
      "test-dist-lib-plain-esbuild-compat",
      "test-dist-bin-shebang",
    ],
  },

  "test-all": { deps: ["test-src", "test-build", "test-dist"] },
  "test-src": { deps: ["test-ts"] },
  "test-ts": { deps: ["test-ts-bun", "test-ts-dom"] },
  "test-ts-bun": {
    deps: ["update-dependencies"],
    run: () => run("bun", ["test"]),
  },
  "test-ts-bun-fast": {
    deps: ["update-dependencies"],
    run: () =>
      run("bun", ["test"], { env: { CUBING_JS_SKIP_SLOW_TESTS: "true" } }),
  },
  "test-ts-bun-with-coverage": {
    deps: ["update-dependencies", "install-playwright"],
    run: () => run("bun", ["test"]),
  },
  "test-ts-dom": {
    deps: ["update-dependencies", "install-playwright"],
    run: () => binRun("web-test-runner"),
  },
  "test-ts-dom-with-coverage": {
    deps: ["update-dependencies", "install-playwright"],
    run: () => binRun("web-test-runner", ["--coverage"]),
  },

  // keep CI.yaml in sync with this
  "test-build": {
    deps: [
      "build-lib-js",
      "build-bin",
      "build-lib-types",
      "build-sites",
      "build-site-docs",
    ],
  },

  "test-dist": { deps: ["test-dist-lib", "test-dist-bin"] },
  // keep CI.yaml in sync with this
  "test-dist-lib": {
    deps: [
      "test-dist-lib-node-import",
      "test-dist-lib-node-scramble",
      "test-dist-lib-node-scramble-all-events",
      "test-dist-lib-perf",
      "test-dist-lib-plain-esbuild-compat",
      "test-dist-lib-build-size",
      "test-dist-sites-twizzle",
    ],
  },
  "test-dist-lib-node-import": {
    deps: ["build-lib-js"],
    run: () =>
      run("node", ["--", "script/test/dist/lib/cubing/node/import/main.js"]),
  },
  "test-dist-lib-node-scramble": {
    deps: ["build-lib-js"],
    run: () =>
      run("node", ["--", "script/test/dist/lib/cubing/node/scramble/main.js"]),
  },
  "test-dist-lib-node-scramble-all-events": {
    deps: ["build-lib-js"],
    run: () =>
      run("bun", [
        "script/test/dist/lib/cubing/node/scramble-all-events/main.js",
      ]),
  },
  "test-dist-lib-perf": {
    deps: ["build-lib-js"],
    run: async () => {
      const dir = "script/test/dist/lib/cubing/perf";
      const files = (await glob("*.js", dir)).map((file) => `${dir}/${file}`);
      await run("bun", files);
    },
  },
  "test-dist-lib-plain-esbuild-compat": {
    deps: ["build-lib-js"],
    run: () =>
      bunRun("script/test/dist/lib/cubing/plain-esbuild-compat/main.ts"),
  },
  "test-dist-lib-build-size": {
    deps: ["build-lib-js"],
    run: () => bunRun("./script/test/dist/lib/cubing/build-size/main.ts"),
  },
  "test-dist-sites-twizzle": {
    deps: ["install-playwright", "build-sites"],
    run: () => bunRun("./script/test/dist/sites/alpha.twizzle.net/main.ts"),
  },

  "test-dist-bin": {
    deps: ["test-dist-bin-shebang", "test-dist-bin-npm-exec"],
  },
  "test-dist-bin-shebang": {
    deps: [
      "test-dist-bin-shebang-order",
      "test-dist-bin-shebang-puzzle-geometry",
      "test-dist-bin-shebang-scramble",
    ],
  },
  "test-dist-bin-shebang-order": {
    deps: ["build-bin"],
    run: () =>
      timed("order", () =>
        runBuiltBin("dist/bin/order.js", ["3x3x3", "R U R'"]),
      ),
  },
  "test-dist-bin-shebang-puzzle-geometry": {
    deps: ["build-bin"],
    run: () =>
      timed("puzzle-geometry", () =>
        runBuiltBin("dist/bin/puzzle-geometry-bin.js", ["--svg", "2x2x2"]),
      ),
  },
  "test-dist-bin-shebang-scramble": {
    deps: ["build-bin"],
    run: () =>
      timed("scramble", () => runBuiltBin("dist/bin/scramble.js", ["222"])),
  },
  "test-dist-bin-npm-exec": {
    deps: ["build-bin"],
    run: () =>
      timed("npm exec scramble", () =>
        run("npm", ["exec", "scramble", "--", "222"]),
      ),
  },

  // ── Lint ─────────────────────────────────────────────────────────────────

  lint: {
    description: "Run every linter.",
    deps: [
      "lint-biome",
      "lint-import-restrictions",
      "lint-tsc",
      "check-schemas",
      "check-for-duplicate-dependencies",
    ],
  },
  format: {
    description: "Auto-format the project.",
    deps: ["update-dependencies"],
    run: () => binRun("biome", ["check", "--write"]),
  },
  "lint-biome": {
    deps: ["update-dependencies"],
    run: () => binRun("biome", ["check"]),
  },
  "lint-ci": {
    deps: ["update-dependencies"],
    run: () => binRun("biome", ["ci"]),
  },
  "lint-import-restrictions": {
    deps: ["update-dependencies"],
    run: () => bunRun("./script/lint/import-restrictions/main.ts"),
  },
  "lint-tsc": {
    deps: [
      "lint-tsc-main",
      "lint-tsc-lib",
      "lint-tsc-lib-no-dom",
      "lint-tsc-bin",
    ],
  },
  "lint-tsc-main": {
    deps: ["update-dependencies"],
    run: () => binRun("tsgo", ["--project", "./tsconfig.json"]),
  },
  "lint-tsc-lib": {
    deps: ["update-dependencies"],
    run: () => binRun("tsgo", ["--project", "./tsconfig.lib.jsonc"]),
  },
  "lint-tsc-lib-no-dom": {
    deps: ["update-dependencies"],
    run: () => binRun("tsgo", ["--project", "./tsconfig.lib.no-dom.jsonc"]),
  },
  "lint-tsc-bin": {
    deps: ["update-dependencies"],
    run: () => binRun("tsgo", ["--project", "./src/bin/tsconfig.json"]),
  },
  "check-schemas": {
    deps: ["update-dependencies"],
    // TODO: https://github.com/YousefED/typescript-json-schema/issues/633
    // run: () => bunRun("./script/schema/check.ts"),
  },
  "update-schemas": {
    deps: ["update-dependencies"],
    // TODO: https://github.com/YousefED/typescript-json-schema/issues/633
    run: () => bunRun("./script/schema/update.ts"),
  },
  "check-package.json": {
    deps: ["build-lib-js", "build-lib-types", "build-bin"],
    run: async () => {
      if (WINDOWS) {
        // `@cubing/dev-config` unpacks the tarball into a temp dir and then
        // calls `Path.resolve(…, extractedRoot)`, but `path-class` does not
        // consider a Windows path (`C:\…`) absolute, so it throws. CI runs this
        // check on Linux, where it works.
        console.warn(
          "⚠️  Skipping `check-package.json` on Windows: `@cubing/dev-config` cannot resolve Windows paths. Run it on macOS, Linux, or WSL.",
        );
        return;
      }
      await bunBinRun("@cubing/dev-config", "package.json", ["check"]);
    },
  },
  "check-for-duplicate-dependencies": {
    deps: ["update-dependencies"],
    run: () => bunBinRun("bun-dedupe", "dedupe", ["--check"]),
  },
  "fix-duplicate-dependencies": {
    deps: ["update-dependencies"],
    run: () => bunBinRun("bun-dedupe", "dedupe"),
  },

  // ── Publishing ───────────────────────────────────────────────────────────

  prepack: {
    deps: [
      "clean",
      "build",
      "test-dist-lib-node-import",
      "test-dist-lib-node-scramble",
      "test-dist-lib-plain-esbuild-compat",
    ],
  },
  prepublishOnly: {
    deps: ["update-dependencies"],
    run: async () => {
      assertExecutableBitSupport();
      await runTask("clean");
      await runTask("check");
      await runTask("build");
    },
  },
  postpublish: {
    deps: ["update-cdn", "update-create-cubing-app", "deploy"],
  },
  "postpublish-clear-bun-cache": {
    run: () =>
      // Ensure that we get the newly published `cubing` version in other
      // `postpublish` steps.
      run("bun", ["pm", "cache", "rm"]),
  },
  publish: {
    run: async () => {
      assertExecutableBitSupport();
      const home = env["HOME"];
      await run("npm", [
        "publish",
        `--globalconfig=${home}/.config/npm/cubing-publish.npmrc`,
      ]);
    },
  },
  pack: {
    run: async () => {
      assertExecutableBitSupport();
      // Note that we need to use `./dist/` rather than `./dist/pack/`, because
      // `prepack` removes the entire `./dist/` folder (but creates a new
      // `./dist/` folder). This prevents us from creating a `./dist/pack/`
      // folder (or similarly, `./.temp/pack/` folder) that will stick around
      // long enough for `npm pack` to use. The simplest is just to place the
      // result directly in `./dist/`.
      await run("npm", ["pack", "--pack-destination", "./dist/"]);
    },
  },

  // ── Deploy ───────────────────────────────────────────────────────────────

  deploy: { deps: ["deploy-twizzle", "deploy-experiments"] },
  "deploy-twizzle": {
    deps: ["build-site-twizzle"],
    run: () => bunRun("script/deploy/twizzle.ts"),
  },
  "deploy-experiments": {
    deps: ["build-site-experiments"],
    run: () => binRun("deploy"),
  },
  "update-cdn": {
    deps: ["postpublish-clear-bun-cache"],
    run: async () => {
      console.log(`--------------------------------
Updating CDN to the latest \`cubing.js\` release, per:
https://github.com/cubing/cdn.cubing.net/blob/main/docs/maintenance.md#updating-cdncubingnet-to-a-new-cubing-version
`);
      const repo = await needSiblingRepo("../cdn.cubing.net/");
      await run("make", ["roll-cubing"], { cwd: repo });
    },
  },
  "update-create-cubing-app": {
    deps: ["postpublish-clear-bun-cache"],
    run: async () => {
      const repo = await needSiblingRepo("../create-cubing-app/");
      await run("make", ["auto-publish"], { cwd: repo });
    },
  },

  "roll-vendored-twips": {
    run: async () => {
      const twips = await needSiblingRepo("../twips/");
      await twips.join("dist/wasm/").rm_rf();
      await run("make", ["build-rust-wasm"], { cwd: twips });

      const vendorDir = new Path("./src/cubing/vendor/mpl/twips/");
      await vendorDir.rm_rf();
      await vendorDir.mkdir();
      await twips.join("dist/wasm/").cp(vendorDir, { recursive: true });

      const versionTXT = new Path(VENDORED_TWIPS_GIT_VERSION_TXT);
      const repoVersion = await new PrintableShellCommand("bun", [
        "x",
        "--",
        "bun-dx",
        "--package",
        "@lgarron-bin/repo",
        "repo",
        "--",
        "version",
        "get",
      ]).text({ cwd: twips, trimTrailingNewlines: "single-required" });
      const commitHash = await new PrintableShellCommand("git", [
        ["-C", twips.path],
        ["rev-parse", "HEAD"],
      ]).text({ trimTrailingNewlines: "single-required" });
      await versionTXT.write(
        `# ${repoVersion}\nhttps://github.com/cubing/twips/tree/${commitHash}\n`,
      );

      await bunRun("script/fix-vendored-twips.ts");
    },
  },
};

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

const started = new Map<string, Promise<void>>();

async function runTask(name: string): Promise<void> {
  const existing = started.get(name);
  if (existing) {
    return existing;
  }
  // Register before running, so that a task shared by several dependents only
  // runs once.
  const promise = Promise.resolve().then(async () => {
    const task = tasks[name];
    if (!task) {
      console.error(`\nUnknown task: ${name}\n`);
      const close = Object.keys(tasks).filter((candidate) =>
        candidate.includes(name),
      );
      if (close.length > 0) {
        console.error(
          `Did you mean one of these?\n\n${close.map((c) => `    ${c}`).join("\n")}\n`,
        );
      }
      console.error("Run `bun run task --list` to see every task.\n");
      exit(1);
    }
    for (const dep of task.deps ?? []) {
      await runTask(dep);
    }
    await task.run?.();
  });
  started.set(name, promise);
  return promise;
}

function listTasks(): void {
  console.log("Available tasks:\n");
  for (const [name, task] of Object.entries(tasks)) {
    console.log(
      task.description
        ? `    ${name.padEnd(38)}${task.description}`
        : `    ${name}`,
    );
  }
  console.log("");
}

const requestedTasks = argv.slice(2);

if (requestedTasks[0] === "--list" || requestedTasks[0] === "-l") {
  listTasks();
} else if (requestedTasks.length === 0) {
  await runTask("default");
} else if (requestedTasks[0] === "dev") {
  // `dev` forwards its remaining args (e.g. a port) to the dev server.
  await runTask("dev");
} else {
  for (const name of requestedTasks) {
    await runTask(name);
  }
}
