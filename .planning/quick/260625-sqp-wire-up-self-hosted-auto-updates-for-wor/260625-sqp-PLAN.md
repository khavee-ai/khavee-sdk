# Plan: Self-Hosted Auto-Updates for wordpress-plugin via GitHub Releases

**Mode:** quick
**Author:** Claude (orchestrator)
**Status:** Pending

---

## Objective

Replace the manual "build a zip, upload via wp-admin" distribution flow with self-hosted auto-updates: integrate `yahnis-elsts/plugin-update-checker` into the plugin bootstrap so WordPress polls this GitHub repo's Releases feed and shows a native "Update available" notice, and add a tag-triggered GitHub Actions workflow that builds and publishes the release zip automatically.

## Context

- Repo: `khavee-ai/khavee-sdk` (from `git remote get-url origin` → `https://github.com/khavee-ai/khavee-sdk.git`)
- Plugin lives at `wordpress-plugin/` inside the monorepo (deliberately not split out — `build/khaveeai-bundle.js` depends on workspace package `packages/wp-bundle`)
- `wordpress-plugin/khaveeai.php` already has a defensive guard: if `vendor/autoload.php` is missing, it shows an admin notice and returns early instead of fataling (lines 29-40). The update checker ships inside `vendor/`, autoloaded the same way — no new guard needed, just confirm it loads through the existing one.
- `wordpress-plugin/includes/Plugin.php` is the composition root (`Plugin::boot()`, hooked on `plugins_loaded`) — this is where every other strategy/service gets wired (`WpOptionsConfigSource`, `OpenAiDirectTokenProvider`, `RateLimiter`, `SessionController`, `AvatarRenderer`, `AssetManager`, `AvatarShortcode`, `AvatarBlock`). The update checker should be wired here too, for consistency, even though it's infrastructure rather than a `Khavee\Plugin\*` strategy.
- `wordpress-plugin/composer.json` currently has zero deps (`require: {"php": ">=8.0"}`, empty `composer.lock` packages array). PSR-4 autoload root is `Khavee\Plugin\` → `includes/`.
- `wordpress-plugin/.gitignore` excludes `/vendor/` and `/node_modules/` — vendor is composer-regenerable, never committed to the repo.
- Reference zip layout (`wordpress-plugin/khaveeai-ai-avatar.zip`, unzipped) — top-level `khaveeai-ai-avatar/` directory containing exactly: `includes/`, `khaveeai.php`, `build/` (compiled JS/CSS bundle), `assets/` (block.json, editor assets), `vendor/` (composer-installed, bundled). It does NOT include `tests/`, `src/`, `node_modules/`, `package.json`, `package-lock.json`, or the zip itself.
- `.github/workflows/publish.yml` is the existing tag-triggered (`v*`) release convention for npm packages: checkout → setup runtime → install → build → test (best-effort) → publish → `actions/create-release@v1` for the GitHub Release. New workflow should mirror this style but trigger on `wordpress-plugin-v*` tags specifically, so it never collides with the npm-package `v*` tag pattern.
- Constraint: production runtime code needs the update-checker library (it's loaded unconditionally via `Plugin::boot()`), so it must be a `require` (production) composer dependency, NOT `require-dev` — `composer install --no-dev` in CI must still include it.

## Tasks

### Task 1: Add plugin-update-checker dependency and wire it into the plugin bootstrap

**Files:**
- `wordpress-plugin/composer.json` (edit — add dependency)
- `wordpress-plugin/includes/Plugin.php` (edit — wire update checker into `boot()`)

**Dependencies:** None

Steps:
1. Run `composer require yahnis-elsts/plugin-update-checker` inside `wordpress-plugin/` (production dependency — do NOT use `--dev`). This updates `composer.json`'s `require` block and regenerates `composer.lock`.
2. After install, inspect `wordpress-plugin/vendor/yahnis-elsts/plugin-update-checker/readme.txt` (or the package's main entry file, e.g. `plugin-update-checker.php` or `Puc/v5*/Factory.php` depending on installed version) to confirm the exact factory call signature for the installed major version. Do not guess — v5.x typically exposes `YahnisElsts\PluginUpdateChecker\v5\PucFactory::buildUpdateChecker($metadataUrl, $fullPath, $slug)`, but confirm the actual namespace/class path from the installed package before writing code.
3. In `wordpress-plugin/includes/Plugin.php`, inside `Plugin::boot()`, add update-checker wiring near the top of the method (before or alongside the other strategy construction — it's infrastructure, not a `ConfigSource`/`TokenProvider` strategy, so it doesn't need an interface seam). Use the confirmed factory call to:
   - Point at `https://github.com/khavee-ai/khavee-sdk/` as the metadata URL/repo.
   - Pass `KHAVEEAI_PLUGIN_FILE` (already defined in `khaveeai.php`) as the full plugin file path.
   - Set the slug to `khaveeai-ai-avatar` (matches the zip's top-level directory name and the existing zip filename) so WordPress matches the installed plugin folder correctly.
   - Enable GitHub release-asset mode (the v5 API exposes this via `getVcsApi()->enableReleaseAssets()`, or equivalently `useGitHubReleaseAssets` configuration depending on the exact installed version's API — confirm via step 2's inspection) so the checker downloads the attached zip asset from Releases rather than building a zip from the repo's raw source tree (which would have the wrong directory layout and include dev-only files).
   - Do NOT set a branch via `setBranch()` for release-based updates — that mode is for branch-following, not release-following; ensure the configured mode is "stable releases only" (the v5 default behavior once release assets are enabled, unless explicit testing of pre-releases is desired, which it isn't here).
4. Add a brief comment above the wiring explaining why it's needed (self-hosted updates instead of WordPress.org), following the file's existing comment style (see the `vendor/autoload.php` guard comment in `khaveeai.php:22-28` for tone/density reference).
5. No new defensive guard is needed in `khaveeai.php` — the existing `vendor/autoload.php` existence check already covers the case where this new dependency is missing (it's part of the same `vendor/` tree, autoloaded the same way).

**Verification:**
- `composer.json`'s `require` block (not `require-dev`) now lists `yahnis-elsts/plugin-update-checker`.
- `composer validate` passes inside `wordpress-plugin/`.
- `php -l wordpress-plugin/includes/Plugin.php` reports no syntax errors.
- Manually trace through `Plugin::boot()` to confirm the update checker is constructed unconditionally on every boot, using the actual installed package's confirmed API (not a guessed one).
- `wordpress-plugin/vendor/` remains gitignored — do not commit it.

### Task 2: Add tag-triggered GitHub Actions release workflow

**File:** `.github/workflows/wordpress-plugin-release.yml` (new)

**Dependencies:** Task 1 (the workflow's `composer install --no-dev` step must pull in the update-checker as a production dep, which only works once Task 1's `composer.json` change exists)

Create a new workflow that:
1. Triggers on `push: tags: ['wordpress-plugin-v*']` only — no path filter needed (tag-scoped, not push-scoped), and this pattern is disjoint from the existing `publish.yml`'s `v*` pattern so the two workflows never both fire on the same tag.
2. Steps, mirroring `publish.yml`'s style where it fits:
   - `actions/checkout@v4`
   - `shivammathur/setup-php@v2` (or equivalent standard action) with a PHP version matching `composer.json`'s `"php": ">=8.0"` constraint (use 8.1 or 8.2 for the build environment).
   - `composer install --no-dev --optimize-autoloader --working-dir=wordpress-plugin` — production deps only, so the update-checker library (required, not require-dev, per Task 1) IS included; this matches the constraint that production code needs it at runtime.
   - Build/stage the release directory: copy `wordpress-plugin/` contents into a temp directory under the exact top-level name `khaveeai-ai-avatar/` (not `wordpress-plugin/`), matching the reference zip layout confirmed via `unzip -l wordpress-plugin/khaveeai-ai-avatar.zip`. Include: `includes/`, `khaveeai.php`, `build/`, `assets/`, `vendor/` (freshly composer-installed in this job, not the gitignored local one), `composer.json`. Exclude: `tests/`, `src/`, `node_modules/`, `package.json`, `package-lock.json`, `.gitignore`, any `*.zip`.
   - Zip the staged `khaveeai-ai-avatar/` directory into `khaveeai-ai-avatar.zip` (top-level folder inside the zip must be `khaveeai-ai-avatar/`, matching what the update checker's release-asset mode expects to unpack over the existing plugin folder).
   - Create a GitHub Release for the pushed tag with the zip attached. Use `softprops/action-gh-release@v2` (preferred over `publish.yml`'s older `actions/create-release@v1` since that action doesn't support asset uploads in one step) with `files: khaveeai-ai-avatar.zip` and `tag_name: ${{ github.ref_name }}`.
3. Use `GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}` (default token, already available, same as `publish.yml`) — no new secret needed.
4. Job name/workflow name should clearly indicate scope (e.g. `name: Release WordPress Plugin`) so it's visually distinct from `publish.yml` ("Publish to NPM") in the Actions tab.

**Verification:**
- `yamllint .github/workflows/wordpress-plugin-release.yml` or a manual YAML syntax check passes (e.g. `python3 -c "import yaml,sys; yaml.safe_load(open(sys.argv[1]))" .github/workflows/wordpress-plugin-release.yml`).
- Tag pattern `wordpress-plugin-v*` does not overlap with `publish.yml`'s `v*` pattern for any realistic tag (e.g. `wordpress-plugin-v1.0.0` does not match a glob intended for `v1.0.0`-style tags — confirm by checking GitHub's tag-glob semantics, since `v*` could theoretically match `wordpress-plugin-v*` as a substring only if anchoring is wrong; GitHub tag refs use full-string glob so this is safe, but verify by reading the pattern logic, not assuming).
- Dry-run the zip-staging logic locally if feasible: build the same directory structure manually and `unzip -l` it, diff the file list against `wordpress-plugin/khaveeai-ai-avatar.zip`'s existing structure to confirm parity (same top-level dir name, same included/excluded paths).
- Confirm `composer install --no-dev` run locally inside `wordpress-plugin/` still includes `yahnis-elsts/plugin-update-checker` in `vendor/` (since it's a production `require`, not `require-dev`).

## Must-Have Requirements

- `yahnis-elsts/plugin-update-checker` is a production (`require`, not `require-dev`) composer dependency of `wordpress-plugin/composer.json`.
- `Plugin::boot()` constructs the update checker unconditionally, pointed at `https://github.com/khavee-ai/khavee-sdk/`, configured for GitHub release-asset mode, using the slug `khaveeai-ai-avatar`.
- The update checker's factory call signature is confirmed against the actually-installed package version (via its readme/entry file), not assumed from memory.
- No new defensive guard needed beyond the existing `vendor/autoload.php` check in `khaveeai.php` — confirmed this covers the new dependency.
- New workflow `.github/workflows/wordpress-plugin-release.yml` triggers only on `wordpress-plugin-v*` tags, never collides with `publish.yml`'s `v*` trigger.
- Workflow's `composer install --no-dev` step is run inside `wordpress-plugin/` and produces a `vendor/` that includes the update-checker library.
- Released zip has top-level directory `khaveeai-ai-avatar/` (not `wordpress-plugin/`), matching the existing reference zip's layout, and excludes `tests/`, `src/`, `node_modules/`, `package.json`, `package-lock.json`.
- Released zip includes `build/` and `vendor/` (both required at runtime).
- GitHub Release is created for the pushed tag with the zip attached as a downloadable asset (required for release-asset mode to find it).
- Existing root-level pnpm/Next.js CI and `publish.yml` are untouched and unaffected by the new workflow.
