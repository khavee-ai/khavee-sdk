# Deferred Items — Phase 15

Out-of-scope issues discovered during execution but not fixed (per executor scope boundary:
only auto-fix issues directly caused by the current task's changes).

## Plan 15-04

- **Pre-existing `tsc --noEmit` failure, unrelated to this plan:**
  `apps/playground/src/app/generic-demo/__tests__/roundtrip-audio-contract.test.ts(16,49):
  error TS2307: Cannot find module 'vitest' or its corresponding type declarations.`
  This file is an opt-in integration test (Phase 4 generic-demo round-trip, requires
  `thonburian-stt`/`jai-tts` running locally) last touched in commit `c1a9756` ("refactor: move
  Next demo out of repo root into apps/playground"), long before Phase 15. `apps/playground`'s
  own `package.json` does not list `vitest` as a dependency at all, so the type declarations are
  not resolvable via the package's own dependency tree — a workspace-hoisting gap, not something
  introduced by any file this plan touched. `git status`/`git diff --stat` confirm zero changes to
  `apps/playground/src/app/generic-demo/` in this plan. Verified via
  `pnpm --filter @khaveeai/playground exec tsc --noEmit 2>&1 | grep -v roundtrip-audio-contract`
  that this is the ONLY `tsc` error in the whole package — no error is introduced by Task 1 or
  Task 2's changes to `mtoon-spike/page.tsx` or `vrm-avatar-test/page.tsx`.

- **Pre-existing `pnpm --filter @khaveeai/playground lint` environment failure, unrelated to this
  plan's file changes:** ESLint fails to even load its config, before touching any file:
  `Error: Failed to load parser './parser.js' declared in
  'eslint-config-next/core-web-vitals' ... Cannot find module
  'next/dist/compiled/babel/eslint-parser'`. Root cause: `eslint-config-next`'s installed copy
  under the pnpm virtual store (`node_modules/.pnpm/eslint-config-next@15.5.3.../node_modules/
  eslint-config-next`) has no local `next` resolvable from its own `node_modules` — a pnpm
  peer-dependency hoisting gap, confirmed independently via `node -e
  "require.resolve('next/dist/compiled/babel/eslint-parser', {paths:[...eslint-config-next path]})"`
  which fails identically with zero playground files involved. Not fixable without a `pnpm install`
  / dependency-tree repair, which is out of scope per this session's disk-space constraint
  (~800MB free) and per Rule 3's package-install exclusion. `tsc --noEmit` (the other automated
  check) passes clean modulo the unrelated vitest-typings issue above, so this is reported as an
  environment blocker on `lint` only, not a code defect in Task 1 or Task 2's files.
