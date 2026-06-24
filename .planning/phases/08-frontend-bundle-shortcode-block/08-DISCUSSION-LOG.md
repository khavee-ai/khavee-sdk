# Phase 8: Frontend Bundle, Shortcode & Block - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-25
**Phase:** 8-frontend-bundle-shortcode-block
**Areas discussed:** Idle/connect visual state, Per-instance override UX, Not-configured/error placeholder, Build & distribution

---

## Idle/connect visual state

| Option | Description | Selected |
|--------|-------------|----------|
| Static VRM/GLB render + "Click to talk" overlay | Mount the 3D model in an idle pose immediately, with a button/overlay prompting the click that triggers mic permission + token mint. Matches the existing demo app's VRMAvatar component. | ✓ |
| Placeholder image + button only | Static 2D preview image with a "Start" button; 3D engine loads only after click. | |

**User's choice:** Static VRM/GLB render + "Click to talk" overlay (Recommended option accepted)
**Notes:** None.

| Option | Description | Selected |
|--------|-------------|----------|
| Subtle loading indicator on the avatar itself | Small spinner/pulse overlay, button shows "Connecting...", avatar stays visible, no layout shift. | ✓ |
| Replace avatar with a loading screen | Full-widget loading state replaces 3D view until connected. | |

**User's choice:** Subtle loading indicator on the avatar itself (Recommended option accepted)
**Notes:** None.

---

## Per-instance override UX

| Option | Description | Selected |
|--------|-------------|----------|
| `[khaveeai_avatar voice="echo" instructions="..." avatar="123"]` | Plain shortcode attributes matching settings-page field names; avatar takes a Media Library attachment ID. | ✓ |
| Single JSON-encoded attribute | One attribute holding a JSON blob — more flexible, less friendly for manual typing. | |

**User's choice:** Plain shortcode attributes (Recommended option accepted)
**Notes:** None.

| Option | Description | Selected |
|--------|-------------|----------|
| Mirror the settings page exactly | Same voice `<select>`, same instructions `<textarea>`, same `wp.media` avatar picker, with "(using global default)" placeholders. | ✓ |
| Simplified — toggle + minimal fields | Single override toggle revealing fields only when enabled. | |

**User's choice:** Mirror the settings page exactly (Recommended option accepted)
**Notes:** None.

| Option | Description | Selected |
|--------|-------------|----------|
| Route accepts a validated override param | Whitelisted voice enum, instructions length cap, avatar must be a real attachment ID — validated server-side, additive to Phase 6's existing protection. | ✓ |
| Bundle has no override path — cosmetic only | Per-instance override stays cosmetic; session always uses global config; Phase 6 D-07 untouched. | |

**User's choice:** Route accepts a validated override param (Recommended option accepted)
**Notes:** This was flagged as the most load-bearing decision in the phase — it directly reconciles Phase 6's deliberate "ignore client-sent voice/instructions" security decision (D-07 in `06-CONTEXT.md`) with EMBED-02's per-instance override requirement. The user confirmed the validated, whitelist-based approach rather than leaving the override purely cosmetic.

---

## Not-configured/error placeholder

| Option | Description | Selected |
|--------|-------------|----------|
| Inline banner inside the widget mount point | WP-admin-notice-styled box with a settings-page link, rendered server-side only for `manage_options` users — never shipped to logged-out visitors at all. | ✓ |
| Floating corner badge | Dismissible badge in page corner — less discoverable, separate UI element. | |

**User's choice:** Inline banner inside the widget mount point (Recommended option accepted)
**Notes:** None.

| Option | Description | Selected |
|--------|-------------|----------|
| Static avatar silhouette, no interaction | Generic/silhouette placeholder image, no live model, no button, no error text. | ✓ |
| Mount point renders nothing at all | No visible markup when not configured. | |

**User's choice:** Static avatar silhouette, no interaction (Recommended option accepted)
**Notes:** None.

---

## Build & distribution

| Option | Description | Selected |
|--------|-------------|----------|
| `packages/wp-bundle` | New workspace package alongside `packages/core`/`react`/`providers/*`, resolves `@khaveeai/react` via pnpm workspace. | ✓ |
| `wordpress-plugin/bundler` (nested) | Self-contained inside `wordpress-plugin/`, outside the pnpm workspace. | |

**User's choice:** `packages/wp-bundle` (Recommended option accepted)
**Notes:** None.

| Option | Description | Selected |
|--------|-------------|----------|
| Committed to git, rebuilt on every source change | Site owners need a working build with no Node/pnpm toolchain on their server. | ✓ |
| Gitignored, built only via a packaging script | Like `wordpress-plugin/vendor/` — cleaner repo, but every distribution path needs the build step remembered. | |

**User's choice:** Committed to git, rebuilt on every source change (Recommended option accepted)
**Notes:** None.

| Option | Description | Selected |
|--------|-------------|----------|
| Full isolation — bundle React 19 inside, no window globals leaked | Self-contained IIFE, never assigns `window.React`/`window.ReactDOM`, no dependency on WP-core's registered React handles. Larger bundle, zero collision risk. | ✓ |
| Externalize against WP-core's React | Smaller bundle, but requires confirming WP core's bundled React version supports React 19 APIs — research could not verify this. | |

**User's choice:** Full isolation (Recommended option accepted)
**Notes:** Directly resolves PITFALLS.md Pitfall 4, which flagged this exact risk as unverified during milestone research.

---

## Claude's Discretion

- Exact PHP class/file names beyond ARCHITECTURE.md's recommended structure
- Exact copy/wording for buttons, labels, banner link text, silhouette placeholder design
- Whether D-05's override validation lives inline in `SessionController` or as a separate helper class
- Exact `has_shortcode()`/`has_block()` enqueue-conditional implementation in `AssetManager.php`

## Deferred Ideas

- WP.org public distribution readiness (readme.txt disclosure, unminified source link) — not a confirmed goal for this milestone, deferred until/if distribution there is decided.
- Live, click-triggered 3D preview inside the Gutenberg editor (beyond the required static inert preview) — not raised, would be new scope if wanted later.
