---
phase: 08-frontend-bundle-shortcode-block
reviewed: 2026-06-24T22:51:49Z
depth: standard
files_reviewed: 25
files_reviewed_list:
  - packages/wp-bundle/build.mjs
  - packages/wp-bundle/package.json
  - packages/wp-bundle/src/index.ts
  - packages/wp-bundle/src/mount.tsx
  - packages/wp-bundle/src/ui/ClickToTalkOverlay.tsx
  - packages/wp-bundle/src/ui/ErrorOverlay.tsx
  - packages/wp-bundle/styles.css
  - packages/wp-bundle/tsconfig.json
  - wordpress-plugin/.gitignore
  - wordpress-plugin/assets/block.json
  - wordpress-plugin/assets/editor.asset.php
  - wordpress-plugin/assets/editor.js
  - wordpress-plugin/build/khaveeai-bundle.css
  - wordpress-plugin/build/khaveeai-bundle.js
  - wordpress-plugin/includes/Assets/AssetManager.php
  - wordpress-plugin/includes/Block/AvatarBlock.php
  - wordpress-plugin/includes/Block/block.json
  - wordpress-plugin/includes/Plugin.php
  - wordpress-plugin/includes/Render/AvatarRenderer.php
  - wordpress-plugin/includes/Rest/SessionController.php
  - wordpress-plugin/includes/Shortcode/AvatarShortcode.php
  - wordpress-plugin/khaveeai.php
  - wordpress-plugin/package-lock.json
  - wordpress-plugin/package.json
  - wordpress-plugin/src/block.json
  - wordpress-plugin/src/editor.js
  - wordpress-plugin/tests/bundle-isolation-check.mjs
  - wordpress-plugin/tests/render-logic-harness.php
  - wordpress-plugin/tests/rest-logic-harness.php
findings:
  critical: 0
  warning: 3
  info: 4
  total: 7
status: issues_found
---

# Phase 8: Code Review Report

**Reviewed:** 2026-06-24T22:51:49Z
**Depth:** standard
**Files Reviewed:** 25 (test/harness files inspected for context but not held to production-code bar)
**Status:** issues_found

## Summary

Reviewed the WordPress front-end bundle (`packages/wp-bundle`) and the shortcode/block render path (`wordpress-plugin/includes/{Render,Shortcode,Block,Assets}`), plus the REST session-minting controller (`includes/Rest/SessionController.php`) and the standalone PHP/Node test harnesses.

Overall this is solid, carefully-commented work — the click-to-connect gating, XSS-safe config serialization (`esc_attr(wp_json_encode(...))`), API-key non-disclosure (`public_safe()`), shortcode/block render-path convergence (`AvatarRenderer`), and bundle isolation (`build.mjs`'s IIFE-with-no-globalName) are all correctly implemented and exercised by the harnesses. No Critical/security-blocking issues were found in the reviewed files.

Three Warning-level issues and four Info-level issues were found: a byte-vs-character length mismatch in the instructions cap that will incorrectly truncate-reject legitimate multi-byte (e.g. Thai) input, duplicated/inert `block.json` copies that drift risk for future editors, and a few smaller robustness/quality nits.

## Warnings

### WR-01: `MAX_INSTRUCTIONS_LENGTH` cap uses byte length, not character length — silently rejects valid multi-byte (Thai) instructions overrides

**File:** `wordpress-plugin/includes/Rest/SessionController.php:162-164`
**Issue:** The per-instance `instructions` override cap is enforced with `strlen( $candidate_instructions ) <= self::MAX_INSTRUCTIONS_LENGTH`. `strlen()` in PHP counts bytes, not UTF-8 characters. For Thai text (3 bytes/char in UTF-8 is common, and this project's stated market includes Thai-language voice products per `CLAUDE.md`'s Thonburian Whisper context), a perfectly reasonable ~650-character Thai instructions string can already exceed 2000 *bytes* and be silently rejected, falling back to the admin's global instructions with no error surfaced to the page author (by design, per D-09-style fail-closed silence) — meaning the author has no way to discover why their override isn't taking effect. This is a functional regression for non-Latin-script content, not merely a cosmetic issue.
**Fix:**
```php
$instructions = ( '' !== $candidate_instructions && mb_strlen( $candidate_instructions, 'UTF-8' ) <= self::MAX_INSTRUCTIONS_LENGTH )
    ? $candidate_instructions
    : $runtime_config['instructions'];
```
Update the doc comment above `MAX_INSTRUCTIONS_LENGTH` (currently "Max length (chars)") to match — it already claims "chars" but the implementation enforces bytes, so the implementation is the one that needs to change, not the comment.

### WR-02: Three independent copies of `block.json` with no single source of truth — two are dead/inert but actively misleading

**File:** `wordpress-plugin/assets/block.json`, `wordpress-plugin/src/block.json`, `wordpress-plugin/includes/Block/block.json`
**Issue:** All three files declare the identical `khaveeai/avatar` block schema (attributes, editorScript path). Only `includes/Block/block.json` is load-bearing — `AvatarBlock::register()` calls `register_block_type( __DIR__, ... )` against `includes/Block/`. The copies in `assets/` and `src/` are not read by any PHP or build code path (`assets/block.json` is not referenced by `editor.asset.php`'s dependency array, and `src/block.json` is not imported by `src/editor.js`, which imports its own local `./block.json`... wait — `src/editor.js:38` does `import metadata from './block.json'`, so `src/block.json` IS read at build time by webpack, while `assets/block.json` appears to be a stray copy/leftover with no consumer at all). Any future edit to one copy (e.g. adding a new attribute) that isn't mirrored into the other two will silently desync the editor schema from the render-callback schema, and the relative `editorScript` path (`file:../../assets/editor.js`) in the two non-canonical copies resolves to the wrong location if either file were ever loaded directly by `register_block_type()`.
**Fix:** Keep exactly one source of truth (`includes/Block/block.json`, since that is what `register_block_type()` reads) and have `src/editor.js` import it via a relative path into that directory, or symlink/build-copy it instead of hand-duplicating. Delete `wordpress-plugin/assets/block.json` if nothing reads it (confirm via `grep -r "assets/block.json"` across the PHP and JS build config before deleting).

### WR-03: `ErrorOverlay`'s effect mutates a shared mutable field on the provider instance without re-checking it hasn't already been overwritten elsewhere

**File:** `packages/wp-bundle/src/ui/ErrorOverlay.tsx:25-37`
**Issue:** The effect reads `realtimeProvider.onError`, wraps it, assigns the wrapped function back onto the (mutable, shared-by-reference) provider instance, and restores the captured original on cleanup. This "chain via field capture" pattern is consistent with `useRealtime.ts`'s existing `onChatStatusChange` chaining, but it is fragile by construction: if any other code anywhere in the render tree (now or in a future change) also assigns directly to `realtimeProvider.onError` instead of chaining (e.g. `provider.onError = somethingElse` rather than capturing+chaining), this effect's cleanup will restore a stale reference and silently drop that other subscriber — there is no warning, error, or assertion when this happens, since plain field assignment on a fat interface gives no compile-time signal of "already subscribed." This is a pre-existing pattern risk in the codebase (not introduced fresh here) but `ErrorOverlay` is a new consumer adding a second simultaneous chain point (`onChatStatusChange` in `useRealtime`, now `onError` here), increasing the surface area where a future third subscriber could break silently.
**Fix:** No change required for this phase's scope, but flag for follow-up: consider a tiny pub/sub helper (e.g. an array of listeners called in sequence) for `RealtimeEvents` callback fields, or document the "always capture-and-chain, never overwrite directly" convention prominently in `RealtimeProvider`'s JSDoc so future contributors don't reintroduce a silent-drop bug.

## Info

### IN-01: `editor.asset.php` / `assets/editor.js` are committed build artifacts with no CI check that they match `src/editor.js`

**File:** `wordpress-plugin/assets/editor.js`, `wordpress-plugin/assets/editor.asset.php`
**Issue:** Both files are generated by `wp-scripts build` from `wordpress-plugin/src/editor.js`, then committed directly (no `.gitignore` entry excludes `assets/`). There is no test or CI step in this phase's files that verifies the committed `assets/editor.js` actually reflects the current `src/editor.js` — a future change to `src/editor.js` without re-running `npm run build` would silently ship stale editor behavior while the source of truth looks updated in review.
**Fix:** Add a lightweight check (e.g. in `tests/bundle-isolation-check.mjs`-style harness, or a CI step) that rebuilds and diffs `assets/editor.js` against the committed copy, failing the build if they differ.

### IN-02: `khaveeai-bundle.js` / `khaveeai-bundle.css` are committed minified build artifacts with the same drift risk as IN-01, at larger scale

**File:** `wordpress-plugin/build/khaveeai-bundle.js`, `wordpress-plugin/build/khaveeai-bundle.css`
**Issue:** Same class of issue as IN-01 but for the much larger (4952-line minified) front-end SPA bundle produced by `packages/wp-bundle/build.mjs`. Confirmed by manual inspection that the committed bundle currently reflects the reviewed source (spot-checked `"Click to talk"`, `"Couldn't connect"`, `khaveeaiMounted` markers), but nothing in the repo enforces this invariant going forward — a contributor who edits `packages/wp-bundle/src/*` and forgets `pnpm --filter @khaveeai/wp-bundle build` (or never runs it because it's not wired into a pre-commit hook or CI) will ship a stale plugin bundle with no signal that anything is wrong.
**Fix:** Same recommendation as IN-01 — add a CI/pre-commit check that rebuilds the bundle and asserts no diff against the committed copy, or moves the build step into the publish workflow so the committed artifact is always regenerated at release time rather than hand-maintained.

### IN-03: `KhaveeAvatarConfig.restUrl` typed optional even though the only producer (`AvatarRenderer::public_safe()`) always sets it

**File:** `packages/wp-bundle/src/mount.tsx:44`
**Issue:** `restUrl?: string` is optional in the TS type, but `AvatarRenderer::public_safe()` (PHP) unconditionally sets `'restUrl' => rest_url(...)` for every config object it emits — there is no code path that omits it. The optionality in the TS type therefore doesn't reflect a real possibility from the actual producer, and silently permits `mountAvatarInstance` to be called (e.g. from a future caller, or a test) with `restUrl` missing, in which case `OpenAIRealtimeProvider` falls through to "No authentication method provided" only after attempting `useProxy: true` with an `undefined` `proxyEndpoint` — a confusing runtime error far from the actual root cause (a malformed/incomplete server-rendered config attribute).
**Fix:** Either keep it optional and add an explicit guard in `mountAvatarInstance` (`if (!config.restUrl) { /* render an inline error instead of mounting a doomed provider */ }`), or document in the JSDoc above `KhaveeAvatarConfig` that `restUrl` is contractually always present from the server and the `?` is purely defensive against malformed JSON, not a real optionality.

### IN-04: `wordpress-plugin/package-lock.json` and the `wordpress-plugin/` npm toolchain are entirely separate from the root pnpm workspace, with no shared documentation cross-reference from the root

**File:** `wordpress-plugin/package.json:2`, `wordpress-plugin/package-lock.json`
**Issue:** This is explained well in-line (`"_comment"` field in `package.json`), but the root `CLAUDE.md`/`package.json` workspace globs (`packages/*`) give no indication that a second, fully independent npm toolchain exists at `wordpress-plugin/`. A contributor running `pnpm install` at the repo root and then `cd wordpress-plugin && npm run build` without first running `npm install` there will hit a missing-`node_modules` error with no obvious link back to "this is a separate package manager/lockfile by design."
**Fix:** Minor — consider a one-line note in the root `CLAUDE.md`'s Platform Requirements or a `wordpress-plugin/README.md` pointing out that this subtree uses `npm` (not `pnpm`) and must be installed/built independently. Not blocking; the existing inline `_comment` is reasonable for anyone who opens the file.

---

_Reviewed: 2026-06-24T22:51:49Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
