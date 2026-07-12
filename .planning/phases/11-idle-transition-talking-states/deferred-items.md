# Deferred Items — Phase 11

Pre-existing, out-of-scope issues discovered during execution but not fixed
per the Scope Boundary rule (only auto-fix issues directly caused by the
current task's changes).

## 11-01

- `pnpm --filter @khaveeai/react build` reports `TS2307: Cannot find module
  'vitest'` in `packages/react/src/animation/AnimationStateEngine.test.ts`
  and `packages/react/src/animation/crossfade.test.ts`. Pre-existing (last
  touched in commit `d304eee`, unrelated to this plan's files); `vitest` is
  not resolvable from the local node_modules in this worktree/build
  environment. Not caused by, and not fixed by, plan 11-01's changes to
  `packages/react/src/animation/types.ts`, `VRMAvatar.tsx`, or
  `GLBAvatar.tsx` — those files now compile with zero errors.
