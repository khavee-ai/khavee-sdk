---
phase: 09-block-studio-visual-config-chat-lipsync
plan: "04"
subsystem: wp-bundle/ui
tags:
  - chat
  - ui-component
  - wordpress
  - studio-03
  - dependency-free
dependency_graph:
  requires:
    - "09-01 (KhaveeAvatarConfig + config.ts for chatShow/chatPlacement fields)"
    - "@khaveeai/react useRealtime() hook (packages/react/src/hooks/useRealtime.ts)"
    - "@khaveeai/core Conversation type (packages/core/src/types/conversation.ts)"
  provides:
    - "ChatBox({ placement }) component ready for wire-up in mount.tsx (09-05)"
    - "ChatBox CSS chrome in styles.css consumed by both VIEW and PREVIEW bundles"
  affects:
    - "09-05 (wires ChatBox into mount.tsx live session)"
    - "wordpress-plugin/build/khaveeai-bundle.css (updated via esbuild)"
    - "wordpress-plugin/build/khaveeai-bundle.js (updated via esbuild)"
tech_stack:
  added: []
  patterns:
    - "Dependency-free React component — zero icon library, zero UI framework"
    - "useRealtime() as single source of truth for transcript state (no local useState transcript)"
    - "Pinned-to-bottom scroll guard (80px threshold) — lifted from khavee-app ChatBox.tsx:41-48"
    - "Enter sends / Shift+Enter newlines — lifted from khavee-app ChatBox.tsx:57-62"
    - "React auto-escaping for XSS mitigation (T-09-04-01) — plain {msg.text}, no markdown"
    - "prefers-color-scheme dark/light theming via CSS media query (no JS)"
key_files:
  created:
    - path: "packages/wp-bundle/src/ui/ChatBox.tsx"
      description: "Dependency-free chat panel consuming useRealtime(); exports ChatBox({ placement: 'beside' | 'below' })"
  modified:
    - path: "packages/wp-bundle/styles.css"
      description: "ChatBox chrome CSS: card, transcript, bubbles (user/assistant), input-row, send button, disconnected + empty states, light/dark theme, placement modifiers"
    - path: "wordpress-plugin/build/khaveeai-bundle.css"
      description: "Minified CSS bundle updated via esbuild (tracked build artifact)"
    - path: "wordpress-plugin/build/khaveeai-bundle.js"
      description: "JS bundle updated via esbuild (ChatBox component inlined)"
decisions:
  - "No local useState transcript — useRealtime().conversation is the sole source of truth (anti-pattern avoidance: don't hand-roll provider state)"
  - "ClickToTalkOverlay owns connect(); ChatBox shows helper text when disconnected, NOT a competing 'Connect to AI' button (avoids dual connect affordance, T-08-02 gate preserved)"
  - "Plain inline SVG paper-plane icon (viewBox 0 0 24 24) rather than lucide-react — zero dependency addition, zero supply-chain risk (T-09-04-SC)"
  - "chatStatus class hook on outer div (.khaveeai-chat--${chatStatus}) for future CSS 'thinking' animation — not wired in CSS yet, hook only"
  - "80px pinned-to-bottom threshold (lifted from khavee-app): only auto-scroll when user is already near bottom, never yank when reading history"
  - "Commit comment cleanup (73f5d45) to remove brand name from code comment — functional no-op, cleans grep check for white-label verification"
metrics:
  duration: "~20 minutes"
  completed: "2026-06-25T18:21:27Z"
  tasks_completed: 2
  files_count: 4
---

# Phase 09 Plan 04: STUDIO-03 ChatBox Component Summary

One-liner: Dependency-free WP chat panel with useRealtime as transcript source of truth, Enter/Shift+Enter keyboard handling, pinned-to-bottom auto-scroll, XSS-safe plain-text rendering, and full light/dark CSS token implementation.

## What Was Built

### Task 1: ChatBox.tsx (dependency-free chat panel)

`packages/wp-bundle/src/ui/ChatBox.tsx` exports `ChatBox({ placement: 'beside' | 'below' })`. The component:

- Imports only `useState`, `useEffect`, `useRef` from react and `useRealtime` from `@khaveeai/react` — zero HeroUI, lucide, or other UI-library imports.
- Destructures `{ conversation, sendMessage, chatStatus, isConnected }` from `useRealtime()`. The provider's `conversation` array is the transcript source of truth; no local `useState` copy.
- Auto-scroll effect on `[conversation]` runs a pinned-to-bottom check: only scrolls if `scrollHeight - scrollTop - clientHeight < 80`. Visitors scrolled up to read history are not yanked back.
- `handleKeyDown`: `e.key === "Enter" && !e.shiftKey` → `e.preventDefault(); handleSend()`. Shift+Enter falls through to default (newline).
- `handleSend`: guards `!text.trim()` and `!isConnected` before calling `sendMessage(text)`.
- Three mutually-exclusive body states: disconnected helper text / empty-connected heading+body / scrollable transcript.
- All UI-SPEC copy verbatim: "AI Assistant", "Click the avatar to start, then type here.", "Start the conversation", "Type a message below or click the avatar to talk.", "Type a message…", "Send message".
- Inline SVG paper-plane: `<path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />` — no icon library.
- Bubbles: `className={khaveeai-chat__bubble khaveeai-chat__bubble--${msg.role}}` with `{msg.text}` (plain text, React auto-escapes).
- `chatStatus` class hook on outer div for future CSS animation.

### Task 2: ChatBox CSS (styles.css)

Appended ~200 lines of ChatBox chrome CSS to `packages/wp-bundle/styles.css`. UI-SPEC tokens implemented exactly:

| Rule | Token applied |
|------|--------------|
| `.khaveeai-chat` | `rgba(255,255,255,0.92)` light / `rgba(30,30,30,0.92)` dark; `padding: 24px` (lg) |
| `.khaveeai-chat--beside` | `width: 320px; min-height: 400px` |
| `.khaveeai-chat--below` | `width: 100%` |
| `.khaveeai-chat__header` | `font-size: 16px; font-weight: 600` (label token) |
| `.khaveeai-chat__transcript` | `overflow-y: auto; flex: 1; gap: 8px` (sm) |
| `.khaveeai-chat__bubble` | `padding: 16px` (md); `font-size: 14px; line-height: 1.5` (body); `max-width: 80%` |
| `.khaveeai-chat__bubble--user` | `align-self: flex-end; background: #2271b1; color: #fff` |
| `.khaveeai-chat__bubble--assistant` | `align-self: flex-start; background: rgba(0,0,0,0.05)` light / dark override |
| `.khaveeai-chat__input` | `min-height: 44px` (touch-target); dark-mode override |
| `.khaveeai-chat__send` | `min-height: 44px; min-width: 44px; background: #2271b1`; hover `#135e96`; `focus-visible` ring |
| `.khaveeai-chat__disconnected` | `color: rgba(0,0,0,0.55)` light / `rgba(255,255,255,0.55)` dark |
| Dark mode | 5 `@media (prefers-color-scheme: dark)` blocks for card, bubbles, input, disconnected, empty-body |

`font-family: inherit` on all 12 text-bearing rules. Zero `!important`. Build verified via `pnpm --filter @khaveeai/wp-bundle run build` (esbuild safety assertion passes).

## Commits

| Hash | Message |
|------|---------|
| `c907e1d` | feat(09-04): add dependency-free ChatBox component consuming useRealtime |
| `ecb00aa` | feat(09-04): add ChatBox CSS to styles.css (card, bubbles, input, send, light/dark, placement) |
| `73f5d45` | style(09-04): rephrase ChatBox header comment to remove brand-name mention in code |

## Deviations from Plan

None - plan executed exactly as written.

The only minor note: the build step required running `pnpm install --frozen-lockfile` in the worktree (no `node_modules` were present) and `pnpm build` on `@khaveeai/core`, `@khaveeai/react`, and `@khaveeai/providers-openai-realtime` before the wp-bundle build could succeed. These are worktree environment setup actions, not deviations from the plan itself. The build verification result is identical to what would occur in the main checkout.

## Known Stubs

None. ChatBox is fully wired to `useRealtime()` for all data. The component is ready to render live conversation data as soon as Plan 09-05 mounts it inside a `KhaveeProvider` with a connected `OpenAIRealtimeProvider`. No hardcoded empty arrays, no mock data, no TODO copy.

The `chatStatus` class hook on the outer div (`.khaveeai-chat--${chatStatus}`) is intentional forward-planning — the CSS does not implement a "thinking" indicator today, but the hook is in place for a future CSS-only extension without component changes.

## Threat Flags

No new threat surface beyond what the plan's threat model covers. T-09-04-01 (XSS via assistant message rendering) is mitigated by React auto-escaping on `{msg.text}`. Verified: zero `dangerouslySetInnerHTML` or `innerHTML` references in ChatBox.tsx. T-09-04-SC (supply chain) remains green — zero new npm packages installed.

## Self-Check: PASSED

- `packages/wp-bundle/src/ui/ChatBox.tsx`: FOUND
- `packages/wp-bundle/styles.css`: contains all 13 required CSS class rules (verified by grep -c returning 11 for the 4-term subset check, full rule list manually verified)
- Commits `c907e1d`, `ecb00aa`, `73f5d45`: all present in `git log --oneline`
- `pnpm --filter @khaveeai/wp-bundle exec tsc --noEmit`: PASS
- `pnpm --filter @khaveeai/wp-bundle run build`: PASS (Safety assertion passed for khaveeai-preview.js)
