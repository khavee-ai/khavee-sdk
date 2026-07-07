---
phase: quick-260707-oyu
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - wordpress-plugin/includes/Admin/SettingsPage.php
  - packages/wp-bundle/src/preview/PreviewScene.tsx
  - packages/wp-bundle/src/mount.tsx
  - wordpress-plugin/build/khaveeai-preview.js
  - wordpress-plugin/build/khaveeai-preview.css
  - wordpress-plugin/build/khaveeai-bundle.js
  - wordpress-plugin/build/khaveeai-bundle.css
autonomous: false
requirements:
  - OYU-01  # Avatar section two-column preview layout
  - OYU-02  # Mock chat transcript containment
  - OYU-03  # Transparent-toggle bug genuine root-cause fix

must_haves:
  truths:
    - "Avatar section renders fields on the left and the live avatar preview on the right, in the same two-column layout as the Floating Widget section"
    - "At narrow admin viewports (<=1100px) the Avatar section two-column layout collapses to single column, preview below fields"
    - "Mock chat bubbles in the Floating Widget preview are visually contained inside a chat-box wrapper matching ChatBox.tsx's real class nesting (header + bounded scrollable transcript)"
    - "Unchecking 'Transparent floating background' restores the opaque background in the preview (no longer stuck transparent)"
    - "If the same root cause exists in the real front-end widget (mount.tsx AvatarScene), it is fixed there too"
  artifacts:
    - path: "wordpress-plugin/includes/Admin/SettingsPage.php"
      provides: "Avatar two-column layout + corrected mock-chat markup"
      contains: "khaveeai-settings__two-col"
    - path: "packages/wp-bundle/src/preview/PreviewScene.tsx"
      provides: "Fixed opaque-canvas background handling"
    - path: "packages/wp-bundle/build/khaveeai-preview.js"
      provides: "Rebuilt preview bundle including the fix"
  key_links:
    - from: "SettingsPage.php render_page() Avatar card"
      to: "render_avatar_section_preview_mount()"
      via: "khaveeai-settings__two-col + khaveeai-settings__preview-col wrappers"
      pattern: "khaveeai-settings__preview-col"
    - from: "PreviewScene.tsx Canvas gl prop"
      to: "WebGLRenderer alpha context"
      via: "explicit alpha:false on the opaque branch"
      pattern: "alpha"
---

<objective>
Three follow-up fixes to the Khavee WordPress admin Settings page after live re-test of quick task 260707-0u6:

1. Move the Avatar section's live preview to the right of its fields, mirroring the Floating Widget section's two-column layout exactly.
2. Fix mock chat transcript containment in the Floating Widget preview so bubbles nest inside a chat-box wrapper matching the real `ChatBox.tsx` structure.
3. Re-investigate and genuinely fix the transparent-toggle bug (unchecking "Transparent floating background" leaves the preview stuck transparent) — the first attempt (commit 5a39d51, Canvas `key`-prop remount) did NOT resolve it.

Purpose: The prior task left three live-verified defects. This closes them.
Output: Edited `SettingsPage.php`, edited `PreviewScene.tsx` (and `mount.tsx` if warranted), rebuilt `khaveeai-preview.*` / `khaveeai-bundle.*` artifacts.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@.planning/quick/260707-oyu-settings-page-follow-up-fixes/260707-oyu-CONTEXT.md
@.planning/quick/260707-0u6-settings-page-fixes-batch/260707-0u6-SUMMARY.md
@.planning/quick/260706-x6b-settings-page-redesign/260706-x6b-SUMMARY.md

# Two-column layout pattern (already in the file — reuse, do not reinvent):
#   SettingsPage.php render_page() lines ~1300-1326 (Floating Widget card)
#   render_settings_page_styles() lines ~1392-1410 defines
#     .khaveeai-settings__two-col (grid: minmax(0,1fr) 380px, gap 24px)
#     .khaveeai-settings__preview-col (sticky) + @media(max-width:1100px) collapse
#   Avatar card to restructure: render_page() lines ~1283-1292
#   render_avatar_section_preview_mount(): lines ~2050-2070
#   render_floating_preview_mount(): lines ~2097-2140
#   render_floating_preview_mock_chat(): lines ~2156-2175

@packages/wp-bundle/src/ui/ChatBox.tsx
@packages/wp-bundle/src/preview/PreviewScene.tsx
@packages/wp-bundle/src/mount.tsx
@packages/wp-bundle/src/preview/mountPreview.tsx

<interfaces>
<!-- Real ChatBox.tsx DOM structure (the target nesting for the mock chat) -->
<!-- <div class="khaveeai-chat khaveeai-chat--{placement} khaveeai-chat--{status}">
       <div class="khaveeai-chat__header">AI Assistant</div>
       <div class="khaveeai-chat__transcript">   <!-- flex:1; min-height:0; overflow-y:auto -->
         <div class="khaveeai-chat__bubble khaveeai-chat__bubble--assistant">…</div>
         <div class="khaveeai-chat__bubble khaveeai-chat__bubble--user">…</div>
       </div>
       <!-- input-row omitted in mock (no send affordance) -->
     </div> -->

<!-- styles.css key facts:
     .khaveeai-chat        display:flex; flex-direction:column; background:#fff;
                           border-radius:24px; min-height:0; overflow:hidden
     .khaveeai-chat--below width:calc(100% - 32px); max-height:400px; margin:16px
     .khaveeai-chat__transcript  flex:1; min-height:0; overflow-y:auto;
                           display:flex; flex-direction:column; gap:12px;
                           padding:0 24px 24px
     NOTE: the current mock passes inline style="width:360px;max-height:none"
     which overrides --below's bounded/flex behavior and drops the __header —
     this is the containment defect. -->

<!-- PreviewScene.tsx / mount.tsx transparent-bg code paths (prime suspect):
     canvasGl = config.bgTransparent ? { alpha: true } : undefined
     <Canvas key={bgTransparent ? "gl-alpha" : "gl-opaque"} gl={canvasGl} />
     The opaque branch passes gl=UNDEFINED. R3F's <Canvas> default alpha is
     true, so a remounted "gl-opaque" canvas can still create a TRANSPARENT
     WebGL context — the container's bgColor sits behind it but a transparent
     canvas shows the page through, matching the "stuck transparent" symptom.
     Secondary suspect (per CONTEXT): containerStyle.background flow via the
     MutationObserver in mountPreview.tsx. Investigate both live before fixing. -->
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Avatar section two-column preview layout (OYU-01)</name>
  <files>wordpress-plugin/includes/Admin/SettingsPage.php</files>
  <action>
Restructure the Avatar card in `render_page()` (~lines 1283-1292) to mirror the Floating Widget card's two-column layout EXACTLY (per locked decision D — "same CSS classes, widths, responsive breakpoints"). Wrap the card body in `<div class="khaveeai-settings__two-col">`, put the existing `form-table` (the Avatar field row) in the left column, and place `render_avatar_section_preview_mount()` inside `<div class="khaveeai-settings__preview-col">` as the right column — matching the exact wrapper pattern used for the Floating Widget card at lines ~1302-1325. Do NOT define any new CSS class or adjust proportions; reuse `.khaveeai-settings__two-col` / `.khaveeai-settings__preview-col` already defined in `render_settings_page_styles()`.

Do NOT change the `#khaveeai-avatar-preview` mount id, its `class`, or its `data-khaveeai-preview-config` attribute (JS/observer contract — see the "DO NOT CHANGE THESE IDS" block at ~line 1235). Inside `render_avatar_section_preview_mount()` you MAY drop the now-redundant "Live preview" heading's `margin-top:16px` if it looks off in the column, but keep the mount div's id/class/data-attribute untouched. The preview column's grid width (380px) matches the Floating card, so the 280x340 mount will sit comfortably; leave its dimensions as-is unless the executor confirms a visual mismatch during the Task 4 checkpoint.
  </action>
  <verify>
    <automated>php -l wordpress-plugin/includes/Admin/SettingsPage.php && grep -c "khaveeai-settings__two-col" wordpress-plugin/includes/Admin/SettingsPage.php | grep -qv '^1$' && echo "two-col used in 2+ cards"</automated>
  </verify>
  <done>`php -l` clean; the Avatar card wraps its field table and preview mount in `.khaveeai-settings__two-col` / `.khaveeai-settings__preview-col`; `#khaveeai-avatar-preview` id/class/data-attribute unchanged.</done>
</task>

<task type="auto">
  <name>Task 2: Mock chat transcript containment (OYU-02)</name>
  <files>wordpress-plugin/includes/Admin/SettingsPage.php</files>
  <action>
Rewrite `render_floating_preview_mock_chat()` (~lines 2156-2175) so the static mock transcript nests inside a chat-box wrapper matching `ChatBox.tsx`'s real structure (see `<interfaces>`). Specifically:

- Keep the outer `<div class="khaveeai-chat khaveeai-chat--below">` but REMOVE the inline `max-height:none` and `width:360px` overrides that currently defeat the `.khaveeai-chat--below` CSS (which supplies `max-height:400px` and a bounded, `overflow:hidden` flex column). If a width constraint is needed to sit under the 360px preview, prefer `width:360px` WITHOUT clobbering the flex/max-height behavior — but first confirm the CSS `--below` sizing already fits; the container column is ~360px wide.
- Add the `<div class="khaveeai-chat__header">` with "AI Assistant" (esc_html__) above the transcript, matching the real ChatBox header, so the bubbles read as a contained chat box, not floating loose.
- Keep the `<div class="khaveeai-chat__transcript">` wrapping the three `khaveeai-chat__bubble khaveeai-chat__bubble--{assistant,user}` bubbles (this is what makes them scroll/contain inside the box).
- Do NOT add an input row / send button (this is a passive mock, per the existing method's contract).
- Reuse ONLY the existing compiled `.khaveeai-chat*` classes from `khaveeai-preview.css` — add no new CSS and no JS.

Exact final markup/nesting is the implementer's call (CONTEXT: Claude's Discretion) as long as it matches ChatBox.tsx's header → bounded transcript → bubbles nesting and the bubbles are visibly contained inside the white chat card.
  </action>
  <verify>
    <automated>php -l wordpress-plugin/includes/Admin/SettingsPage.php && grep -q "khaveeai-chat__header" wordpress-plugin/includes/Admin/SettingsPage.php && ! grep -q "max-height:none" wordpress-plugin/includes/Admin/SettingsPage.php && echo "header added, max-height:none removed"</automated>
  </verify>
  <done>`php -l` clean; mock chat emits `khaveeai-chat` > `khaveeai-chat__header` + `khaveeai-chat__transcript` > bubbles; the `max-height:none` override is gone; no new CSS/JS added.</done>
</task>

<task type="auto">
  <name>Task 3: Transparent-toggle bug — investigate + genuinely fix (OYU-03)</name>
  <files>packages/wp-bundle/src/preview/PreviewScene.tsx, packages/wp-bundle/src/mount.tsx, wordpress-plugin/build/khaveeai-preview.js, wordpress-plugin/build/khaveeai-preview.css, wordpress-plugin/build/khaveeai-bundle.js, wordpress-plugin/build/khaveeai-bundle.css</files>
  <action>
INVESTIGATION-FIRST — do NOT repeat the untested Canvas/WebGL `key`-prop guess from commit 5a39d51. Trace the actual code path before editing:

PRIME SUSPECT (verify first): In `PreviewScene.tsx` the opaque branch computes `canvasGl = config.bgTransparent ? { alpha: true } : undefined`, then `<Canvas gl={canvasGl}>`. R3F's `<Canvas>` defaults `alpha` to true, so passing `gl={undefined}` on the "gl-opaque" remount can STILL create a transparent WebGL context — matching the "stuck transparent" symptom even though the `key` correctly forces a remount. Candidate fix: make the opaque branch explicit — `gl={{ alpha: false }}` (never `undefined`) so the remounted renderer is genuinely opaque. `mount.tsx`'s `AvatarScene` (~line 109) has the IDENTICAL `gl={config.bgTransparent === true ? { alpha: true } : undefined}` pattern; per locked decision, apply the same fix there.

SECONDARY SUSPECT (per CONTEXT specifics): confirm `containerStyle.background` (PreviewScene.tsx ~lines 229-237, mount.tsx ~lines 220-228) actually transitions transparent→bgColor when `bgTransparent` flips false. Also check `mountPreview.tsx`'s `PreviewHost` MutationObserver for a stale-closure / missed config-key issue in how the unchecked value reaches the Canvas vs the container. Confirm the Settings-page inline `rebuild()` JS actually writes `bgTransparent:false` into `data-khaveeai-preview-config` on uncheck (grep SettingsPage.php ~lines 332-469). Note whichever of these is the true cause in the SUMMARY.

Live reproduction is REQUIRED before finalizing the fix (CONTEXT + constraint) — the Task 4 checkpoint performs the live confirmation in wp-env. Reason through the code trace above, apply the smallest fix that addresses the confirmed root cause, and only touch `mount.tsx` if the same root cause is present there.

After editing source, rebuild the bundle so the compiled artifacts the WP plugin loads reflect the fix:
`pnpm --filter @khaveeai/wp-bundle build`
Confirm `wordpress-plugin/build/khaveeai-preview.js`, `khaveeai-preview.css`, `khaveeai-bundle.js`, `khaveeai-bundle.css` are regenerated. Preserve the existing STUDIO-02 safety guarantees (no `useRealtime`, no provider construction in the preview path) and the existing pitfall/traceability comments; extend the transparent-bg comment to record the real root cause found (not the disproven `key`-only hypothesis).
  </action>
  <verify>
    <automated>pnpm --filter @khaveeai/wp-bundle build && test -f wordpress-plugin/build/khaveeai-preview.js && test -f wordpress-plugin/build/khaveeai-bundle.js && echo "bundle rebuilt"</automated>
  </verify>
  <done>Root cause identified via code trace (documented in comments + SUMMARY); fix applied to `PreviewScene.tsx` (and `mount.tsx` if the same cause is present); `pnpm --filter @khaveeai/wp-bundle build` succeeds; all four `build/khaveeai-*` artifacts regenerated. Final live confirmation deferred to Task 4.</done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <what-built>
Three fixes to the Settings page: (1) Avatar section preview moved to a right-hand column mirroring the Floating Widget layout; (2) mock chat bubbles now nested inside a contained chat-box wrapper (header + bounded transcript); (3) the transparent-toggle bug re-investigated and fixed in the rebuilt preview bundle.
  </what-built>
  <how-to-verify>
In wp-env at http://localhost:8888/wp-admin/admin.php?page=khaveeai-settings (hard-refresh to bypass cached bundle):

1. AVATAR LAYOUT: Confirm the Avatar section shows its field(s) on the LEFT and the live avatar preview on the RIGHT, matching the Floating Widget section's two-column look. Resize the browser narrower than ~1100px and confirm it collapses to single column (fields, then preview below).
2. MOCK CHAT: In the Floating Widget preview, confirm the three mock chat bubbles sit INSIDE a white chat-box card (with an "AI Assistant" header), properly contained — not loose/overflowing.
3. TRANSPARENT TOGGLE: In the Floating Widget section, CHECK "Transparent floating background" — preview should go transparent. Then UNCHECK it — the preview MUST return to the opaque background color (this is the bug being fixed; it previously stayed stuck transparent). Toggle a few times to confirm it tracks the checkbox reliably.
4. REGRESSION: Confirm color picker, offset/scale/camera-angle sliders, and orbit-drag still update the Floating preview live (prior 260706 wiring must survive).
  </how-to-verify>
  <resume-signal>Type "approved" if all three fixes verify and no regression, or describe what is still wrong (especially if the transparent toggle still sticks — Task 3 would then need a second root-cause pass).</resume-signal>
</task>

</tasks>

<verification>
- `php -l wordpress-plugin/includes/Admin/SettingsPage.php` clean
- Existing PHP harnesses (`platform-config-harness.php`, `render-logic-harness.php`) pass; `settings-page-harness.php` shows only the one documented pre-existing unrelated failure (no NEW failures)
- `pnpm --filter @khaveeai/wp-bundle build` clean; `build/khaveeai-preview.*` and `build/khaveeai-bundle.*` regenerated
- All protected JS-read element ids unchanged (`#khaveeai-avatar-preview`, `#khaveeai-floating-preview`, `#khaveeai_floating_bg_transparent`, etc.)
- Live human-verify checkpoint (Task 4) confirms all three fixes + no regression
</verification>

<success_criteria>
- Avatar section renders fields-left / preview-right in the same two-column layout as the Floating Widget section, collapsing to single column below ~1100px
- Mock chat bubbles are visibly contained inside a chat-box wrapper matching ChatBox.tsx's nesting
- Unchecking "Transparent floating background" restores the opaque background in the preview (bug fixed), with the real root cause documented
- If the same root cause was present in `mount.tsx`, it is fixed there too
- No existing element id/name/JS contract broken; no new PHP harness failures
</success_criteria>

<output>
Create `.planning/quick/260707-oyu-settings-page-follow-up-fixes/260707-oyu-SUMMARY.md` when done, recording: the two-column Avatar restructure, the mock-chat nesting fix, and — importantly — the ACTUAL root cause found for the transparent-toggle bug (vs. the disproven `key`-only hypothesis) and exactly which files were changed to fix it.
</output>
