# Phase 7: Admin Settings Page - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-23
**Phase:** 7-admin-settings-page
**Areas discussed:** Settings page tech approach, API key re-save behavior, Avatar upload scope & limits, "Invalid key" notice criteria (SET-06)

---

## Settings Page Tech Approach

| Option | Description | Selected |
|--------|-------------|----------|
| Plain PHP Settings API form | register_setting()/add_settings_field(), standard wp-admin form fields + wp.media JS picker for avatar. No bundler needed. | ✓ |
| React (wp-element) admin UI | Custom React screen using @wordpress/element, externalized against WP's own React. Only worth it for dynamic JS behavior. | |

**User's choice:** Plain PHP Settings API form

| Option | Description | Selected |
|--------|-------------|----------|
| Top-level menu item | "Khavee AI Avatar" own top-level admin menu icon. More discoverable. | ✓ |
| Submenu under Settings | Settings > Khavee AI Avatar. Less cluttered, more conventional, less discoverable. | |

**User's choice:** Top-level menu item

| Option | Description | Selected |
|--------|-------------|----------|
| Leave hardcoded, no UI field | Matches Phase 6's anti-bloat stance (D-04), keeps page at 4 fields. | ✓ |
| Add a model dropdown now | Scope addition beyond REQUIREMENTS.md's locked field list. | |

**User's choice:** Leave hardcoded, no UI field

| Option | Description | Selected |
|--------|-------------|----------|
| No — plain dropdown only | Voice preview would need a live OpenAI TTS call, out of scope per REQUIREMENTS.md. | ✓ |
| Yes — add a voice sample preview | New capability beyond what's scoped for Phase 7. | |

**User's choice:** No — plain dropdown only
**Notes:** Settings page confirmed as a static, bundle-free plain PHP form: top-level menu, 4 fields only (API key, instructions, voice, avatar), no model field, no live preview/test affordances.

---

## API Key Re-Save Behavior

| Option | Description | Selected |
|--------|-------------|----------|
| Preserve existing key | sanitize_callback detects masked placeholder unchanged, leaves stored api_key untouched. | ✓ |
| Require full retype every save | Any save overwrites api_key — known anti-pattern, breaks the key on unrelated saves. | |

**User's choice:** Preserve existing key

| Option | Description | Selected |
|--------|-------------|----------|
| Dedicated "Remove key" control | Separate deliberate checkbox/button action, avoids accidental key loss. | ✓ |
| Blanking the field clears it | Simpler, but risks accidental loss (autofill, stray backspace). | |

**User's choice:** Dedicated "Remove key" control

| Option | Description | Selected |
|--------|-------------|----------|
| sk-•••••• + last 4 chars | Matches SET-01's exact example (sk-••••••1234). | ✓ |
| Fully redacted, no chars shown | Stricter, but admin can't visually confirm which key without any chars shown. | |

**User's choice:** sk-•••••• + last 4 chars

| Option | Description | Selected |
|--------|-------------|----------|
| Light format check | Reject empty/doesn't-start-with-"sk-" with inline settings error before storing. | ✓ |
| No validation, accept anything | Feedback only later via REST route 502 (Phase 6 D-09/D-10). | |

**User's choice:** Light format check
**Notes:** Full decision set: save-without-touching-field preserves the key; clearing requires a dedicated control; mask is sk-•••••• + last 4; new-key entry gets a light "starts with sk-" format check.

---

## Avatar Upload Scope & Limits

| Option | Description | Selected |
|--------|-------------|----------|
| .glb and .vrm only | Both binary glTF, identical magic-byte check. PITFALLS.md recommends skipping plaintext .gltf. | ✓ |
| Also accept .gltf | Adds JSON-based variant; documented WP core fileinfo headache; scope addition. | |

**User's choice:** .glb and .vrm only

| Option | Description | Selected |
|--------|-------------|----------|
| 50MB | Matches PITFALLS.md's suggested ceiling. | ✓ |
| WordPress's default upload_max_filesize | Defers to host php.ini/WP defaults, inconsistent across hosts. | |

**User's choice:** 50MB

| Option | Description | Selected |
|--------|-------------|----------|
| Filename + uploaded-date text | Simple text readout, no new rendering code in wp-admin. | (final answer, after reconsideration) |
| Live 3D model preview | Render the actual VRM/GLB using three.js + @pixiv/three-vrm in wp-admin. | (initial answer) |

**User's choice:** Filename + uploaded-date text (after a follow-up clarification)
**Notes:** User initially chose "Live 3D model preview." Claude flagged that this requires its own JS bundle (standalone three.js+@pixiv/three-vrm viewer, or reusing @khaveeai/react's VRMAvatar/GLBAvatar) even though the page is otherwise a bundle-free plain PHP form (per the Settings Page Tech Approach decision above). Follow-up question offered: (a) small standalone preview bundle, (b) reuse @khaveeai/react's components, (c) downgrade to filename/thumbnail only. User chose (c) — downgrade to filename/upload-date text, no 3D preview, to keep the page bundle-free.

---

## "Invalid Key" Notice Criteria (SET-06)

| Option | Description | Selected |
|--------|-------------|----------|
| Empty/unset key only | "Invalid" (wrong/revoked) key only discoverable via REST route's runtime 502 (Phase 6 D-09). | ✓ |
| Empty key OR fails the light format check | Reuses the "must start with sk-" check to also flag malformed already-saved keys. | |

**User's choice:** Empty/unset key only

| Option | Description | Selected |
|--------|-------------|----------|
| Expose a helper on ConfigSourceInterface | Additive is_configured()-style method; Phase 8's render path doesn't need its own logic. | ✓ |
| Leave it entirely to Phase 8 | No interface change in Phase 7; Phase 8 decides independently. | |

**User's choice:** Expose a helper on ConfigSourceInterface

| Option | Description | Selected |
|--------|-------------|----------|
| Yes — simple status banner | WP admin-notice-styled banner at top of settings page when key is empty. | ✓ |
| No — settings page is silent either way | Only the frontend embed notice (Phase 8) surfaces "not configured." | |

**User's choice:** Yes — simple status banner
**Notes:** SET-06's embed notice fires only on empty key (no format-guessing); the check is exposed as a new ConfigSourceInterface method so both the settings page's own banner and Phase 8's embed notice share one source of truth.

---

## Claude's Discretion

- Exact settings page slug/option-group naming, field ID naming, PHP file/class name for the settings page (e.g. `Admin/SettingsPage.php`).
- Exact copy/wording for the "Remove key" control, format-validation error message, and "not configured" status banner.
- Whether `is_configured()` is a new interface method vs. a default/trait-based implementation.
- Admin menu icon choice for the top-level menu item.

## Deferred Ideas

- Live 3D model preview of the configured avatar in wp-admin — declined this phase due to the JS-bundle requirement conflicting with the plain-PHP-form approach; could be revisited as its own scoped addition later if there's real demand.
- Voice sample/preview playback on the settings page — declined, would need a live OpenAI TTS call; matches REQUIREMENTS.md's existing SETV2-02 deferral.
- Model selection as a settings field — declined, stays hardcoded.
- Format-based "looks invalid" detection feeding the frontend embed notice — declined; project pattern is to surface real failures via the REST route's runtime error path instead.
