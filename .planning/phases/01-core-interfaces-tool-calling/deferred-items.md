# Deferred Items — Phase 01

Out-of-scope discoveries logged during plan execution. Not fixed; tracked for awareness only.

## 01-01: pnpm install rewrote tracked `node_modules/.bin` symlinks under `packages/providers/qdrant`

**Found during:** Task 1 (`pnpm install` after adding vitest devDependencies to `@khaveeai/core`)

**Issue:** `packages/providers/qdrant/node_modules/.bin/*` (acorn, browserslist, esbuild, eslint, jest, jiti, openai, tsc, tsserver, tsup, tsup-node) are tracked in git as symlinks. Running `pnpm install` at the repo root re-resolved/changed these symlink targets, showing as modified files unrelated to this task's `@khaveeai/core` package.json/vitest.config.ts changes.

**Action:** Left untouched — out of scope for this task (scope boundary: only auto-fix issues directly caused by current task's changes). `pnpm-lock.yaml` was committed since it legitimately reflects the new `vitest`/`@vitest/coverage-v8` devDependencies added to `@khaveeai/core`.

**Recommendation:** `node_modules/` should likely not be tracked in git at all for `packages/providers/qdrant` — candidate for a separate cleanup task (add to `.gitignore`, `git rm --cached` the tracked `node_modules` tree).
