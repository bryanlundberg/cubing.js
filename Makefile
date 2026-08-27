# This project is driven by `./script/task.ts`, which runs anywhere `bun` runs —
# including Windows, where neither `make` nor the POSIX shell and coreutils that
# the recipes in this file used to assume are available.
#
# This file is kept as a thin forwarder, so that muscle memory and existing CI
# invocations keep working wherever `make` happens to be installed:
#
#     make build   ≡   bun run task build
#
# Run `bun run task --list` to see every task.

MAKEFLAGS += --no-builtin-rules --no-print-directory
.SUFFIXES:

.PHONY: default
default:
	@bun ./script/task.ts

# Forward every other target to the task runner. `FORCE` keeps these from being
# treated as up-to-date files.
.PHONY: FORCE
FORCE:

%: FORCE
	@bun ./script/task.ts $@

# Never try to remake this file via the pattern rule above.
Makefile: ;
