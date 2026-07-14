# Deferred Items — quick task 260715-2ih

## Pre-existing tsc error in mount.tsx (out of scope)

`pnpm --filter @khaveeai/wp-bundle typecheck` fails with:

```
src/mount.tsx(318,31): error TS2322: Type 'OpenAIRealtimeProvider' is not assignable to type 'RealtimeProvider'.
  The types returned by 'toggleMicrophone()' are incompatible between these types.
    Type 'Promise<boolean>' is not assignable to type 'boolean'.
```

This is pre-existing on HEAD (commit ea89549, "feat(wp-plugin): knowledge-base
search, backed by the Khavee Platform") and unrelated to FloatingWidget.tsx /
styles.css changes made in this plan. `mount.tsx` was not touched by this
plan and the error is not caused by any change here. `git diff --stat HEAD`
confirms only `FloatingWidget.tsx` and `styles.css` were modified.

The esbuild-based `pnpm --filter @khaveeai/wp-bundle build` (Task 3's actual
gate) does not run `tsc` and succeeds cleanly, including the STUDIO-02
safety assertion. Per the plan's scope guard ("packages/wp-bundle only" /
do not touch unrelated files) and the executor's scope-boundary rule, this
pre-existing type error is logged here rather than fixed.
