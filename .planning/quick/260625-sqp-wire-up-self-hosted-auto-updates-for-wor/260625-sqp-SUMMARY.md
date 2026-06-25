# Summary: Self-Hosted Auto-Updates for wordpress-plugin via GitHub Releases

**Mode:** quick
**Status:** Complete

## What was done

### Task 1 — `yahnis-elsts/plugin-update-checker` dependency + bootstrap wiring

- Ran `composer require yahnis-elsts/plugin-update-checker` for real inside `wordpress-plugin/` (composer + PHP 8.5 were available locally — no fallback needed). Installed version: **v5.7**.
- `wordpress-plugin/composer.json`'s `require` block (production, not `require-dev`) now lists `"yahnis-elsts/plugin-update-checker": "^5.7"`. `composer.lock` regenerated accordingly.
- Inspected the installed package's `vendor/yahnis-elsts/plugin-update-checker/README.md` to confirm the real v5.x factory signature before writing any code:
  ```php
  use YahnisElsts\PluginUpdateChecker\v5\PucFactory;
  $checker = PucFactory::buildUpdateChecker($metadataUrl, $fullPath, $slug);
  $checker->getVcsApi()->enableReleaseAssets();
  ```
  Confirmed via `php -r` that `YahnisElsts\PluginUpdateChecker\v5\PucFactory` autoloads correctly through Composer's classmap.
- Wired this into `wordpress-plugin/includes/Plugin.php`'s `Plugin::boot()` (top of the method, before the existing strategy construction):
  - Metadata URL: `https://github.com/khavee-ai/khavee-sdk/` (confirmed against `git remote get-url origin` → `https://github.com/khavee-ai/khavee-sdk.git`).
  - Full plugin file path: `KHAVEEAI_PLUGIN_FILE` constant (already defined in `khaveeai.php`).
  - Slug: `khaveeai-ai-avatar` (matches the existing reference zip's top-level directory name).
  - Enabled GitHub release-asset mode via `getVcsApi()->enableReleaseAssets()` — no `setBranch()` call, since release-asset mode with no branch override defaults to "stable releases only" per the library's docs.
  - Added a comment block explaining why (self-hosted updates, not WordPress.org) matching the file's existing comment density/tone.
- Confirmed no new defensive guard was needed: the existing `vendor/autoload.php` existence check in `khaveeai.php` already covers this dependency since it ships in the same `vendor/` tree.

**Verification performed:**
- `composer validate` → `./composer.json is valid`.
- `php -l wordpress-plugin/includes/Plugin.php` → no syntax errors.
- Manually traced `Plugin::boot()` — update checker constructed unconditionally on every boot, before the other strategies.
- `wordpress-plugin/vendor/` confirmed still gitignored (`git status` shows it untracked); only `composer.json`, `composer.lock`, and `includes/Plugin.php` were staged/committed.

### Task 2 — Tag-triggered GitHub Actions release workflow

- Created `.github/workflows/wordpress-plugin-release.yml`:
  - Triggers on `push: tags: ['wordpress-plugin-v*']` only.
  - `actions/checkout@v4` → `shivammathur/setup-php@v2` (PHP 8.1) → `composer install --no-dev --optimize-autoloader --working-dir=wordpress-plugin`.
  - Stages `includes/`, `build/`, `assets/`, `vendor/`, `khaveeai.php`, `composer.json` into a `khaveeai-ai-avatar/` top-level directory (per the plan's explicit Task 2 step 2 instruction — note this includes `composer.json`, which the existing manually-built reference zip does not, since that zip predates this automation).
  - Zips the staged directory to `khaveeai-ai-avatar.zip` with `khaveeai-ai-avatar/` as the top-level folder inside the archive.
  - Publishes a GitHub Release via `softprops/action-gh-release@v2` (chosen over `publish.yml`'s `actions/create-release@v1` because the latter doesn't support asset uploads in one step) with the zip attached and `tag_name: ${{ github.ref_name }}`.
  - Named `Release WordPress Plugin` to be visually distinct from `publish.yml` ("Publish to NPM") in the Actions tab.

**Verification performed:**
- YAML syntax validated via `python3 -c "import yaml,sys; yaml.safe_load(open(...))"` → passes.
- Tag-glob disjointness confirmed programmatically: `wordpress-plugin-v1.0.0` does NOT match glob `v*` (GitHub anchors tag-ref globs to the full string, not substring), so `publish.yml`'s `v*` trigger and the new `wordpress-plugin-v*` trigger never both fire on the same tag.
- Dry-ran the staging logic locally (cp into a `khaveeai-ai-avatar/` dir, zip, `unzip -l`) and diffed against the existing `wordpress-plugin/khaveeai-ai-avatar.zip`: the `includes/` subtree matched exactly. The only structural difference is the addition of `composer.json` at the top level, which is intentional per the plan's explicit instruction (Task 2 includes it even though the older manually-built reference zip doesn't have it).
- Re-ran `composer install --no-dev --optimize-autoloader` locally inside `wordpress-plugin/` after deleting `vendor/` — confirmed `yahnis-elsts/plugin-update-checker` is reinstalled (it's a production `require`, so `--no-dev` still pulls it in).

## Deviations from plan

None of substance. One minor note: the plan's "Reference zip layout" context section (describing the *existing* hand-built zip) lists `vendor/` etc. but does not mention `composer.json`, while Task 2 Step 2's explicit instruction list does include `composer.json`. Followed the explicit task instruction (include `composer.json`) since it is more specific than the descriptive context note about the old manual zip.

## Composer/PHP availability

Both `composer` (2.10.1) and `php` (8.5.7) were available in the environment via Homebrew, so `composer require` was run for real — no manual `composer.json` authoring + vendoring fallback was needed.

## Files touched

- `wordpress-plugin/composer.json` (edit)
- `wordpress-plugin/composer.lock` (edit, regenerated by composer)
- `wordpress-plugin/includes/Plugin.php` (edit)
- `.github/workflows/wordpress-plugin-release.yml` (new)

## Commits

- `b4ddbf2` — feat(260625-sqp): wire up plugin-update-checker for self-hosted updates
- `745be80` — feat(260625-sqp): add tag-triggered release workflow for wordpress-plugin

## Must-Have Requirements status

All satisfied — see verification notes above. Specifically:
- ✅ Production (not dev) composer dependency
- ✅ `Plugin::boot()` constructs the checker unconditionally, GitHub release-asset mode, slug `khaveeai-ai-avatar`
- ✅ Factory signature confirmed from installed package's README, not assumed
- ✅ No new defensive guard needed (existing `vendor/autoload.php` check covers it)
- ✅ New workflow triggers only on `wordpress-plugin-v*`, confirmed disjoint from `publish.yml`'s `v*`
- ✅ Workflow's `composer install --no-dev` run inside `wordpress-plugin/`, includes the update-checker
- ✅ Released zip top-level dir is `khaveeai-ai-avatar/`, excludes `tests/`, `src/`, `node_modules/`, `package.json`, `package-lock.json`
- ✅ Released zip includes `build/` and `vendor/`
- ✅ GitHub Release created with zip attached as a release asset
- ✅ `publish.yml` and root pnpm/Next.js CI untouched
