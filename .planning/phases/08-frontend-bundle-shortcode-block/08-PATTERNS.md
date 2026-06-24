# Phase 8: Frontend Bundle, Shortcode & Block - Pattern Map

**Mapped:** 2026-06-25
**Files analyzed:** 14 (10 PHP, 4 TypeScript/package files; bundle UI sub-components grouped)
**Analogs found:** 12 / 14

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `wordpress-plugin/includes/Render/AvatarRenderer.php` | service | request-response (HTML render) | `wordpress-plugin/includes/ConfigSource/WpOptionsConfigSource.php` (merge logic) + `Admin/SettingsPage.php::render_page()` (render-time composition) | role-match (new role: "render path", composed from existing patterns) |
| `wordpress-plugin/includes/Shortcode/AvatarShortcode.php` | controller (thin adapter) | request-response | `wordpress-plugin/includes/Rest/SessionController.php::register_routes()`/`create_session()` (registration + delegation pattern) | role-match |
| `wordpress-plugin/includes/Block/AvatarBlock.php` | controller (thin adapter) | request-response | `wordpress-plugin/includes/Rest/SessionController.php` (registration + delegation pattern); `wordpress-plugin/includes/Admin/SettingsPage.php::add_menu_page()` (hook registration style) | role-match |
| `wordpress-plugin/includes/Block/block.json` | config | n/a | none (no existing block.json in repo) | no analog — use RESEARCH.md Pattern 3 example verbatim |
| `wordpress-plugin/includes/Assets/AssetManager.php` | service (asset enqueue) | event-driven (WP hook-triggered) | `wordpress-plugin/includes/RateLimit/RateLimiter.php` (standalone WP-function-only utility, constructor-free, testable in bare-PHP harness) | role-match |
| `wordpress-plugin/includes/Rest/SessionController.php` (MODIFIED: `apply_trust_model()`) | controller / validator | request-response | itself — extend existing `apply_trust_model()` method; allowlist pattern copied from `Admin/SettingsPage.php::sanitize_settings()` voice validation (CR-01) | exact (same file, established sibling pattern) |
| `wordpress-plugin/includes/Plugin.php` (MODIFIED) | config (composition root) | n/a | itself — `Plugin::boot()` | exact |
| `wordpress-plugin/tests/render-logic-harness.php` | test | request-response (unit) | `wordpress-plugin/tests/rest-logic-harness.php` | exact |
| `wordpress-plugin/tests/bundle-isolation-check.mjs` | test | smoke | none (no Node-based test exists in `wordpress-plugin/tests/`) | no analog — use RESEARCH.md smoke-check guidance |
| `packages/wp-bundle/package.json` | config | n/a | `packages/providers/openai-realtime/package.json` (workspace package shape) | role-match (deviates: not published, no `tsc` build) |
| `packages/wp-bundle/build.mjs` | config (build script) | batch | none in-repo (no esbuild/Vite config exists anywhere in this monorepo) | no analog — use RESEARCH.md Code Examples verbatim |
| `packages/wp-bundle/src/index.ts` | utility (entry/bootstrap) | event-driven (DOM scan + mount) | `src/app/openai/page.tsx` (provider construction + `KhaveeProvider` wiring) | role-match |
| `packages/wp-bundle/src/mount.tsx` | component | request-response (render tree per instance) | `src/app/openai/page.tsx` (`OpenAIChat` component + `KhaveeProvider` wrap); `packages/react/src/KhaveeProvider.tsx` (provider/context consumption) | role-match |
| `packages/wp-bundle/src/ui/ClickToTalkOverlay.tsx` | component | request-response | `packages/react/src/VRMAvatar.tsx` (chatStatus-driven conditional render, lines 76-90) | role-match |

## Pattern Assignments

### `wordpress-plugin/includes/Render/AvatarRenderer.php` (service, request-response)

**Analog:** `wordpress-plugin/includes/ConfigSource/WpOptionsConfigSource.php` (merge/defaults logic) + `wordpress-plugin/includes/Admin/SettingsPage.php` (constructor-injection + render-time output style)

**Constructor-injection pattern** (from `WpOptionsConfigSource`'s consumer, `SettingsPage.php` lines 217-219):
```php
public function __construct( ConfigSourceInterface $config_source ) {
    $this->config_source = $config_source;
}
```
Apply identically to `AvatarRenderer`: constructor takes `ConfigSourceInterface $config_source` and the new `AssetManager $assets` (per RESEARCH.md Pattern 1) — no concrete class is ever instantiated inside `AvatarRenderer` itself; `Plugin.php` wires both.

**Defaults-merge pattern** (`WpOptionsConfigSource.php` lines 58-78):
```php
$instructions  = isset( $settings['instructions'] ) ? (string) $settings['instructions'] : '';
$voice         = isset( $settings['voice'] ) ? (string) $settings['voice'] : '';
$attachment_id = isset( $settings['avatar_attachment_id'] ) ? (int) $settings['avatar_attachment_id'] : 0;
$avatar_url    = $attachment_id > 0 ? wp_get_attachment_url( $attachment_id ) : '';
$avatar_url    = is_string( $avatar_url ) ? $avatar_url : ''; // coerce false -> ''
return [
    'instructions' => '' !== $instructions ? $instructions : self::DEFAULT_INSTRUCTIONS,
    'voice'        => '' !== $voice ? $voice : self::DEFAULT_VOICE,
    'avatar_url'   => $avatar_url,
    'model'        => '' !== $model ? $model : self::DEFAULT_MODEL,
];
```
`AvatarRenderer::render( array $atts )` follows the identical "isset → cast → fallback to default" shape, but merges instance `$atts` OVER `$this->config_source->get_runtime_config()` (instance wins, not global) — use `wp_parse_args( $atts, $defaults )` per RESEARCH.md Pattern 1, then run the SAME isset/cast/fallback per-field as above for any field present in neither.

**is_configured() / admin notice consumption** (D-06, contract from `ConfigSourceInterface.php` lines 42-55 + `SettingsPage.php` render_page() lines 796-802):
```php
if ( ! $this->config_source->is_configured() ) {
    echo '<div class="notice notice-warning"><p>' .
        esc_html__( 'Khavee AI Avatar is not yet configured — enter an OpenAI API key below.', 'khaveeai' ) .
        '</p></div>';
}
```
`AvatarRenderer::render()` reuses `is_configured()` exactly this way, but the D-06 admin notice must ALSO gate on `current_user_can( 'manage_options' )` (it does not in the `SettingsPage` example because that whole page is already gated) — combine both:
```php
if ( ! $this->config_source->is_configured() ) {
    if ( current_user_can( 'manage_options' ) ) {
        // D-06: admin-only banner, rendered server-side ONLY for this user — never emitted for anyone else.
    } else {
        // D-07: visitor placeholder (inert silhouette), no notice text at all.
    }
}
```

**XSS-safe mount-point output** (RESEARCH.md Pattern 1, already verified against this codebase's `esc_attr`/`wp_json_encode` conventions used throughout `SettingsPage.php`, e.g. line 842-845):
```php
return sprintf(
    '<div id="%s" class="khaveeai-root" data-khaveeai-config="%s"></div>',
    esc_attr( $id ),
    esc_attr( wp_json_encode( $this->public_safe( $merged ) ) )
);
```
`public_safe()` must strip anything not in `ConfigSourceInterface::get_runtime_config()`'s public-safe contract (NEVER the API key — same invariant `ConfigSourceInterface.php` lines 30-39 documents for `get_api_key()`).

---

### `wordpress-plugin/includes/Shortcode/AvatarShortcode.php` (controller/thin-adapter, request-response)

**Analog:** `wordpress-plugin/includes/Rest/SessionController.php` (constructor-injection + `register_routes()` hook-registration style)

**Constructor + registration pattern** (`SessionController.php` lines 46-59, 75-85):
```php
public function __construct(
    ConfigSourceInterface $config_source,
    TokenProviderInterface $token_provider,
    RateLimiter $rate_limiter
) {
    $this->config_source  = $config_source;
    // ...
}

public function register_routes(): void {
    register_rest_route( /* ... */ );
}
```
`AvatarShortcode` takes a single `AvatarRenderer $renderer` constructor dependency (RESEARCH.md Pattern 1's exact PHP example) and a `register(): void` method calling `add_shortcode( 'khaveeai_avatar', array( $this, 'render' ) )` — same constructor-injection-then-hook-registration two-step `SessionController` and `SettingsPage::register_hooks()` both use.

**Attribute normalization** (RESEARCH.md Code Examples — shortcode_atts + array_filter to avoid empty-string atts overriding globals):
```php
$atts = shortcode_atts(
    array( 'voice' => '', 'instructions' => '', 'avatar' => '' ),
    (array) $atts,
    'khaveeai_avatar'
);
$atts = array_filter( $atts, static fn( $v ) => '' !== $v );
return $this->renderer->render( $atts );
```

---

### `wordpress-plugin/includes/Block/AvatarBlock.php` (controller/thin-adapter, request-response)

**Analog:** `wordpress-plugin/includes/Rest/SessionController.php` (registration pattern) — same constructor-injection-then-`add_action`/`register_block_type` two-step.

**Core pattern** (RESEARCH.md Pattern 3 + Code Examples):
```php
// render.php — called both by ServerSideRender (editor preview) and the front end
echo khaveeai_avatar_renderer()->render( $attributes );
```
`AvatarBlock::render_callback( array $attributes ): string` is a one-line delegation to `$this->renderer->render( $attributes )` — block attributes arrive already-typed per `block.json`'s schema (no `shortcode_atts()`-style normalization needed, unlike `AvatarShortcode`), but MUST still filter empty-string/zero attribute values the same way before merge, per EMBED-04's "must not drift" requirement — this is the literal seam that proves shortcode and block produce identical output for identical inputs (see `render-logic-harness.php` test plan in RESEARCH.md).

**Critical:** Do NOT add `"viewScript"` to `block.json` (see Shared Patterns > Gutenberg dynamic-block enqueue below) — `AssetManager::enqueue()` is called from inside `AvatarRenderer::render()`, which both `AvatarShortcode::render()` and `AvatarBlock::render_callback()` already call, so the block needs no separate asset-loading declaration.

---

### `wordpress-plugin/includes/Assets/AssetManager.php` (service, event-driven)

**Analog:** `wordpress-plugin/includes/RateLimit/RateLimiter.php` (standalone, constructor-free utility class, all WP-function calls narrow enough to stub in the bare-PHP harness)

**Class shape pattern** (`RateLimiter.php` lines 25-46):
```php
final class RateLimiter {
    const DEFAULT_PER_IP_LIMIT = 5;
    private const PER_IP_KEY_PREFIX = 'khaveeai_rl_';
    // all-public-API, no constructor dependencies — directly `new`-able in Plugin.php
}
```
`AssetManager` follows the same `final class`, no-constructor-dependency shape (constants for handles, one public `enqueue(): void` method) — directly from RESEARCH.md Pattern 2's own code example:
```php
final class AssetManager {
    private const HANDLE = 'khaveeai-bundle';
    private const STYLE_HANDLE = 'khaveeai-bundle-style';

    public function enqueue(): void {
        if ( wp_script_is( self::HANDLE, 'enqueued' ) ) {
            return; // idempotent
        }
        $bundle_path = plugin_dir_path( KHAVEEAI_PLUGIN_FILE ) . 'build/khaveeai-bundle.js';
        $version = file_exists( $bundle_path ) ? (string) filemtime( $bundle_path ) : KHAVEEAI_VERSION;
        wp_enqueue_script( self::HANDLE, plugins_url( 'build/khaveeai-bundle.js', KHAVEEAI_PLUGIN_FILE ), array(), $version, array( 'in_footer' => true ) );
    }
}
```
Note the deliberately empty `array()` deps argument — D-10's full-isolation requirement means this is the ONE enqueue call in the whole plugin that must NOT list `wp-element`/`react` as a dependency, unlike a hypothetical WP-core-React-sharing script.

---

### `wordpress-plugin/includes/Rest/SessionController.php` (MODIFIED: `apply_trust_model()`)

**Analog:** itself (existing method, lines 99-121) + `wordpress-plugin/includes/Admin/SettingsPage.php::sanitize_settings()` voice-allowlist logic (CR-01 precedent, lines 634-640)

**Existing trust-model pattern to extend** (`SessionController.php` lines 99-121):
```php
private function apply_trust_model( array $session_config ): array {
    $runtime_config = $this->config_source->get_runtime_config();
    $session_config['instructions'] = $runtime_config['instructions'];
    unset( $session_config['voice'] );
    // ... force audio.output.voice = $runtime_config['voice'] unconditionally
    return $session_config;
}
```

**Allowlist-or-fallback pattern to copy** (`SettingsPage.php` lines 634-640, CR-01/CR-01-NEW — re-validates the FALLBACK value too, not just the submission):
```php
$existing_voice = isset( $existing_option['voice'] ) && in_array( $existing_option['voice'], self::VOICES, true )
    ? $existing_option['voice']
    : self::VOICES[0];

$sanitized['voice'] = in_array( $submitted_voice, self::VOICES, true )
    ? sanitize_text_field( $submitted_voice )
    : $existing_voice;
```

**Combined D-05 implementation** (signature change: `apply_trust_model( array $session_config, array $instance_overrides = array() )`, per RESEARCH.md Code Examples, exact text to use):
```php
private const ALLOWED_VOICES = [
    'alloy', 'ash', 'ballad', 'coral', 'echo', 'sage', 'shimmer', 'verse', 'marin', 'cedar',
];
private const MAX_INSTRUCTIONS_LENGTH = 2000;

private function apply_trust_model( array $session_config, array $instance_overrides = array() ): array {
    $runtime_config = $this->config_source->get_runtime_config();

    $override_voice = $instance_overrides['voice'] ?? '';
    $voice = in_array( $override_voice, self::ALLOWED_VOICES, true )
        ? $override_voice
        : $runtime_config['voice'];

    $override_instructions = $instance_overrides['instructions'] ?? '';
    $instructions = ( '' !== $override_instructions && strlen( $override_instructions ) <= self::MAX_INSTRUCTIONS_LENGTH )
        ? $override_instructions
        : $runtime_config['instructions'];

    $session_config['instructions'] = $instructions;
    unset( $session_config['voice'] );
    $session_config['audio']['output']['voice'] = $voice;

    return $session_config;
}
```
`avatar` override validation (Media Library attachment existence check) is NOT in this excerpt — add a third branch following the identical "validate-or-fallback" shape: `get_post( $id )` must return a real post with `post_type === 'attachment'` before the override is honored, else fall back to `$runtime_config['avatar_url']` silently (no error detail echoed, per Error Handling convention below).

**Error-handling convention (fail-closed, no detail leak)** — matches existing `create_session()` body (lines 162-164, 175-178): never echo WHY a voice/instructions/avatar value was rejected; just silently substitute the fallback. This is distinct from `SettingsPage::sanitize_api_key()`'s admin-facing `add_settings_error()` (an authenticated admin form, different trust tier) — the REST route is anonymous/public, so it must stay silent per `Common Pitfalls Pitfall 4` in RESEARCH.md.

---

### `wordpress-plugin/includes/Plugin.php` (MODIFIED — composition root)

**Analog:** itself (`Plugin::boot()`, lines 38-53)

**Wiring pattern to extend** (exact style to replicate for the four new classes):
```php
$config_source  = new WpOptionsConfigSource();
// ...
$session_controller = new SessionController( $config_source, $token_provider, $rate_limiter );
add_action( 'rest_api_init', array( $session_controller, 'register_routes' ) );

$settings_page = new SettingsPage( $config_source );
$settings_page->register_hooks();
```
Add, in the same `boot()` method, reusing the SAME `$config_source` instance (never construct a second `WpOptionsConfigSource` — same comment convention as lines 47-50):
```php
$assets   = new AssetManager();
$renderer = new AvatarRenderer( $config_source, $assets );

$shortcode = new AvatarShortcode( $renderer );
$shortcode->register();

$block = new AvatarBlock( $renderer );
add_action( 'init', array( $block, 'register' ) );
```

---

### `wordpress-plugin/tests/render-logic-harness.php` (test, unit)

**Analog:** `wordpress-plugin/tests/rest-logic-harness.php` (entire file — same in-memory-stub harness style)

**Harness structure to copy** (lines 1-15, 106-201, 295-331):
```php
// Minimal WP stubs section (transients/filters as needed for AvatarRenderer's
// get_option()/wp_get_attachment_url()/current_user_can() dependencies)

class FixtureConfigSource implements ConfigSourceInterface { /* same fixture shape, lines 301-331 */ }

function run_case( string $name, callable $fn ): void {
    global $failures;
    try {
        $result = $fn();
        if ( true === $result ) { echo "PASS: {$name}\n"; }
        else { echo "FAIL: {$name}\n"; ++$failures; }
    } catch ( \Throwable $e ) { echo "FAIL: {$name} (unexpected exception: {$e->getMessage()})\n"; ++$failures; }
}
```
New cases needed (per RESEARCH.md's Phase Requirements → Test Map): EMBED-02 (override falls back to global when omitted, allowlist-rejects invalid voice), EMBED-04 (shortcode-shaped vs block-shaped input produce IDENTICAL merged output), D-05 (invalid/malicious voice override never reaches `mint_session()` — extend `rest-logic-harness.php`'s existing Case 5 pattern, lines 374-406, with an `$instance_overrides` argument).

**Exit/reporting convention** (lines 566-573) — identical, copy verbatim:
```php
if ( $failures > 0 ) {
    echo "\n{$failures} case(s) FAILED.\n";
    exit( 1 );
}
echo "\nAll cases PASSED.\n";
exit( 0 );
```

---

### `packages/wp-bundle/package.json` (config)

**Analog:** `packages/providers/openai-realtime/package.json`

**Workspace package shape to follow** (full file read):
```json
{
  "name": "@khaveeai/wp-bundle",
  "private": true,
  "dependencies": {
    "@khaveeai/core": "workspace:*",
    "@khaveeai/react": "workspace:*",
    "@khaveeai/providers-openai-realtime": "workspace:*",
    "react": "^19.1.0",
    "react-dom": "^19.1.0"
  },
  "devDependencies": {
    "esbuild": "^0.28.1",
    "typescript": "^5.0.0"
  },
  "scripts": {
    "build": "node build.mjs",
    "dev": "node build.mjs --watch"
  }
}
```
**Deviation from the analog (deliberate, per D-08/D-10):** `react`/`react-dom` must be regular `dependencies` here, NOT `peerDependencies` as in every other package (`openai-realtime`'s `"peerDependencies": { "react": "^18.0.0 || ^19.0.0" }`) — this package is the one place in the monorepo that bundles and ships its own React copy rather than expecting a host app to provide it. Also omit `"main"/"types"/"exports"` entirely (unlike every other package) since this package is never imported by another package — it only produces a build artifact consumed by `wordpress-plugin/build/`.

---

### `packages/wp-bundle/src/index.ts` (utility/entry, event-driven)

**Analog:** `src/app/openai/page.tsx` (provider construction pattern, lines 1-11)

**Provider construction + config pattern** (`page.tsx` lines 1-11):
```typescript
'use client';
import { OpenAIRealtimeProvider } from '@khaveeai/providers-openai-realtime';
import { KhaveeProvider, useRealtime } from '@khaveeai/react';

const openaiProvider = new OpenAIRealtimeProvider({
  useProxy: true,
  proxyEndpoint: '/api/negotiate',
  voice: 'shimmer',
  instructions: 'You are a helpful AI assistant. Be conversational and friendly.',
});
```
The bundle's entry point follows this exact shape but reads `voice`/`instructions`/`proxyEndpoint` from each mount point's `data-khaveeai-config` JSON (server-rendered by `AvatarRenderer::render()`) instead of a hardcoded literal — one `OpenAIRealtimeProvider` instance per mount point (not a module-level singleton like `page.tsx`'s `openaiProvider`, since N shortcode/block instances can exist on one page).

**Scan-and-mount loop** (RESEARCH.md Code Examples, exact text to use):
```typescript
import { createRoot } from 'react-dom/client';
import { mountAvatarInstance } from './mount';

function mountAll(): void {
  const roots = document.querySelectorAll<HTMLElement>('[data-khaveeai-config]');
  roots.forEach((el) => {
    if (el.dataset.khaveeaiMounted === 'true') return;
    el.dataset.khaveeaiMounted = 'true';
    const config = JSON.parse(el.dataset.khaveeaiConfig ?? '{}');
    const root = createRoot(el);
    mountAvatarInstance(root, config);
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mountAll);
} else {
  mountAll();
}
```

---

### `packages/wp-bundle/src/mount.tsx` (component, request-response render tree)

**Analog:** `src/app/openai/page.tsx`'s `OpenAIChat` component + `KhaveeProvider` wrap (lines 13-86); `packages/react/src/KhaveeProvider.tsx`'s context consumption pattern

**Provider-wrap + hook-consumption pattern** (`page.tsx` lines 80-86):
```typescript
export default function OpenAI() {
  return (
    <KhaveeProvider config={{ realtime: openaiProvider }}>
      <OpenAIChat />
    </KhaveeProvider>
  );
}
```
`mountAvatarInstance(root, config)` renders the equivalent tree (`<KhaveeProvider config={{ realtime: provider }}><VRMAvatar src={config.avatarUrl} /><ClickToTalkOverlay /></KhaveeProvider>`) into the React root created by `index.ts`. Per D-01/D-02, `ClickToTalkOverlay` (not the demo app's `connect`/`disconnect` buttons, which auto-render regardless of state) gates the FIRST `connect()` call behind an explicit click — see `VRMAvatar.tsx`'s `chatStatus`-driven render below for the idle/connecting/speaking visual states this overlay must read.

**`useRealtime` hook surface to consume** (`packages/react/src/hooks/useRealtime.ts` lines 22-23, 130-135, 223-233 — confirmed exported state/actions):
```typescript
const { connect, disconnect, chatStatus, isConnected } = useRealtime();
// chatStatus: "stopped" | "starting" | ... | "speaking" (ChatStatus union)
```

---

### `packages/wp-bundle/src/ui/ClickToTalkOverlay.tsx` (component, request-response)

**Analog:** `packages/react/src/VRMAvatar.tsx` (chatStatus-driven conditional behavior, documented at lines 76-90: "TALKING ANIMATIONS: When the AI speaks (chatStatus === 'speaking')...")

**chatStatus-driven conditional pattern** (referenced doc comment, `VRMAvatar.tsx` lines 88-90):
```typescript
// chatStatus === 'speaking' drives automatic behavior changes in VRMAvatar
```
`ClickToTalkOverlay` reads the same `chatStatus` value (via `useRealtime()`, not a prop drilled from `VRMAvatar` — these are sibling consumers of the same `KhaveeProvider` context) to decide its own visual state per D-01/D-02:
- `chatStatus === "stopped"` → render "Click to talk" button, call `connect()` on click (first user gesture — mic permission prompt fires here, never earlier)
- `chatStatus === "starting"` → render disabled/"Connecting..." button + pulse overlay, avatar underneath stays visible (no layout shift, no full-widget swap)
- any other status → hide the overlay entirely (avatar is live)

---

## Shared Patterns

### Constructor injection, no DI container (PHP)
**Source:** `wordpress-plugin/includes/Plugin.php` lines 38-53, `wordpress-plugin/includes/Rest/SessionController.php` lines 51-59
**Apply to:** `AvatarRenderer`, `AvatarShortcode`, `AvatarBlock` — every new PHP class takes its dependencies as typed constructor parameters; `Plugin::boot()` is the only place concretes are `new`-ed.
```php
public function __construct( ConfigSourceInterface $config_source, TokenProviderInterface $token_provider, RateLimiter $rate_limiter ) {
    $this->config_source  = $config_source;
    $this->token_provider = $token_provider;
    $this->rate_limiter   = $rate_limiter;
}
```

### Fail-closed allowlist validation (PHP)
**Source:** `wordpress-plugin/includes/Admin/SettingsPage.php` lines 634-640 (CR-01/CR-01-NEW), `wordpress-plugin/includes/Admin/SettingsPage.php` lines 692-709 (`sanitize_avatar_attachment_id`)
**Apply to:** `SessionController::apply_trust_model()`'s D-05 override validation, and any new validator helper class if the planner chooses to extract one.
```php
$sanitized['voice'] = in_array( $submitted_voice, self::VOICES, true )
    ? sanitize_text_field( $submitted_voice )
    : $existing_voice; // existing_voice ITSELF re-validated against the allowlist, not blindly trusted
```
Never use a blocklist or format heuristic — strict `in_array(..., true)` only, per ASVS V5 in RESEARCH.md.

### `esc_attr( wp_json_encode( ... ) )` for data attributes (PHP)
**Source:** `wordpress-plugin/includes/Admin/SettingsPage.php` lines 842-845 (analogous escaping for a different attribute, same `esc_attr()` discipline)
**Apply to:** `AvatarRenderer::render()`'s mount-point `data-khaveeai-config` attribute — every new PHP file that emits user-influenced data into HTML attributes.

### `is_configured()` single source of truth
**Source:** `wordpress-plugin/includes/ConfigSource/ConfigSourceInterface.php` lines 42-55, consumed at `wordpress-plugin/includes/Admin/SettingsPage.php` line 798
**Apply to:** `AvatarRenderer::render()`'s D-06/D-07 branch — call `$this->config_source->is_configured()`, never re-derive "configured" from `get_api_key()` directly in the new code.

### Generic, no-detail error bodies
**Source:** `wordpress-plugin/includes/Rest/SessionController.php` lines 162-164, 175-178 (`khaveeai_not_configured`, `session_unavailable`)
**Apply to:** D-05's override validation — rejected voice/instructions/avatar values are silently substituted with the fallback, never surfaced as a distinct error code or message body field.

### `'use client'` + provider-construction-then-`KhaveeProvider`-wrap (TypeScript)
**Source:** `src/app/openai/page.tsx` lines 1-11, 80-86
**Apply to:** `packages/wp-bundle/src/mount.tsx` (and indirectly `index.ts`, which calls it) — this is the ONE existing reference for "construct a `RealtimeProvider`, wrap it in `KhaveeProvider`, render avatar + chat UI," even though the demo app is a Next.js page and the bundle is a WP-embeddable IIFE.

### Backend proxy assumption — never embed a real API key
**Source:** CLAUDE.md "Architectural Constraints" + `packages/providers/openai-realtime/src/OpenAIRealtimeProvider.ts` lines 134-226 (`useProxy`/`proxyEndpoint` branch)
**Apply to:** `packages/wp-bundle/src/index.ts`/`mount.tsx` — the bundle ALWAYS constructs `OpenAIRealtimeProvider` with `useProxy: true` and `proxyEndpoint` pointing at the REST route; never with `apiKey`.

### Gutenberg dynamic-block enqueue — render-path-triggered, not `viewScript`
**Source:** `.planning/phases/08-frontend-bundle-shortcode-block/08-RESEARCH.md` Pattern 2/3, Pitfall 1 (this phase's own research, not prior codebase code — flagged because it is a "looks correct but is wrong" trap)
**Apply to:** `AvatarBlock.php`, `AssetManager.php`, `block.json` — do not declare `"viewScript"` in `block.json`; `AssetManager::enqueue()` is called from `AvatarRenderer::render()`, reached by both `AvatarShortcode::render()` and `AvatarBlock::render_callback()`.

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `wordpress-plugin/includes/Block/block.json` | config | n/a | No `block.json` exists anywhere in this repo yet (Gutenberg blocks are net-new this phase) — use RESEARCH.md's Pattern 3 example verbatim as the template, not a codebase analog |
| `packages/wp-bundle/build.mjs` | config (build script) | batch | No esbuild/Vite/Rollup/webpack config exists anywhere in this monorepo (`tsc` is the only build tool used by every existing package) — use RESEARCH.md's "esbuild IIFE build script" Code Example verbatim |
| `wordpress-plugin/tests/bundle-isolation-check.mjs` | test | smoke | No Node-based test/smoke-check exists in `wordpress-plugin/tests/` (all three existing harnesses are bare-PHP) — write fresh per RESEARCH.md's Pitfall 5 guidance: load the built bundle in a sandboxed/jsdom context, assert `typeof globalThis.React === 'undefined'` |

## Metadata

**Analog search scope:** `wordpress-plugin/includes/**/*.php`, `wordpress-plugin/tests/*.php`, `packages/core/src/types/*.ts`, `packages/react/src/*.tsx`, `packages/react/src/hooks/*.ts`, `packages/providers/openai-realtime/src/*.ts`, `src/app/**/*.tsx`, all workspace `package.json` files
**Files scanned:** 13 read directly (full or targeted ranges): `SessionController.php`, `SettingsPage.php`, `Plugin.php`, `ConfigSourceInterface.php`, `WpOptionsConfigSource.php`, `RateLimiter.php` (partial), `rest-logic-harness.php`, `khaveeai.php`, `src/app/openai/page.tsx`, `KhaveeProvider.tsx`, `VRMAvatar.tsx` (partial), `realtime.ts`, `OpenAIRealtimeProvider.ts` (partial), plus 4 `package.json`/config files and `tsconfig.packages.json`
**Pattern extraction date:** 2026-06-25
