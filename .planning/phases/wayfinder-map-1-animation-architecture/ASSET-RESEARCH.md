# Per-ChatStatus Animation Asset Requirements — Sourcing Research

Wayfinder ticket khavee-ai/khavee-sdk#9. Primary-source licensing research for bundling default
animation clips inside the `@khaveeai/react` npm package.

Scope note: this document only resolves *sourcing/licensing*. It does not re-litigate the locked
requirements handed down for this ticket (clip counts per state, retargeting architecture) — those
are treated as given.

---

## 1. Per-state requirement recap

| State | Clips needed (locked) | Currently bundled | Gap |
|---|---|---|---|
| `ready` / `stopped` (idle base) | 1 idle clip sufficient (procedural breathing/sway covers the rest); extra variants optional polish | `Idle.fbx` — Mixamo-sourced, see §3 | Covered functionally, but the one clip covering it is a licensing liability (§3) |
| `starting` | 1 dedicated NEW greeting/waking-up clip (not reusable from idle) | None | **Full gap** — no greeting clip exists in the repo at all |
| `listening` | 2+ aim, 1 acceptable if licensing/budget tight (never formally pinned — see §6) | None | **Full gap** |
| `thinking` | 2+ aim, 1 acceptable if licensing/budget tight (never formally pinned — see §6) | None | **Full gap** |
| `speaking` | 2+ variants (foregrounded, repetition very noticeable) | `talking.fbx` + `talking1.fbx` — 2 variants, both Mixamo-sourced | Count is met, but both source files are the same licensing liability as Idle.fbx (§3) |
| `stopped` (goodbye) | 1 dedicated NEW goodbye/settling clip (not idle-equivalent) | None | **Full gap** |

`Fist Fight B.fbx` is also bundled under `public/models/animations/` but maps to no locked
ChatStatus state — it appears to be leftover/unused demo content, not part of this requirement set.

---

## 2. Mixamo redistribution verdict (highest-stakes finding)

**Verdict: Mixamo assets (raw exported FBX files) may NOT be redistributed inside an npm package
like `@khaveeai/react`.** This is a real, current licensing problem for the repo's existing bundled
files, not just a forward-looking concern.

### What was fetched and what wasn't

- `https://helpx.adobe.com/creative-cloud/faq/mixamo-faq.html` — attempted via WebFetch **four
  times**; every attempt timed out (`timeout of 60000ms exceeded` / `ETIMEDOUT`). **I could not
  directly verify this page's content myself.** Treat any characterization of its content below as
  unverified-by-me.
- `https://community.adobe.com/t5/mixamo-discussions/mixamo-faq-licensing-royalties-ownership-eula-and-tos/td-p/13234775`
  — successfully fetched via WebFetch. This is Adobe's own community forum's pinned canonical
  Mixamo licensing FAQ thread (not Adobe Legal's own page, but a widely-cited, long-standing pinned
  post in Adobe's official community space, and the content is internally consistent with every
  other source found). **This is the closest thing to a primary source I could actually retrieve.**
- `https://www.licenseorg.com/guide/3d-assets/mixamo` — successfully fetched. Third-party summary
  site; used only as corroboration, not as the primary claim source. Notably, it explicitly caveats
  itself: "Always consult the platform's official license page and a qualified legal professional."
- `http://www.adobe.com/legal/terms.html` (Adobe General Terms of Use, which the FAQ says governs
  where Mixamo-specific terms don't override) — attempted, timed out, not verified directly.

### Quoted findings (from the community.adobe.com pinned FAQ, fetched directly)

On redistribution of raw files:
> "You may not distribute the files to customers or non-team members however."

On the specific prohibited category that matches "ship raw FBX inside an npm package for other devs
to install":
> "Blueprints, templates, or asset packages for video game engines which redistribute character or
> animation raw files as the product."
and:
> "Packages for 3D stock or asset store websites where character or animation raw files will be
> sold or distributed."

On what IS allowed (commercial use is fine, the restriction is specifically about redistributing
the raw files themselves, not about commercial-vs-personal use):
> "There are no limitations on the types of paid or nonpaid projects you can use [Mixamo content in]."
> "available for free, with no licensing or royalty fees, for unlimited commercial or non commercial use."

A second WebFetch pass (of the same community FAQ content) also surfaced this paraphrase-adjacent
line, consistent with the above:
> "Characters and animations cannot be redistributed as standalone assets. They must be incorporated
> into a larger project (game, film, app)."

Source URLs:
- https://community.adobe.com/t5/mixamo-discussions/mixamo-faq-licensing-royalties-ownership-eula-and-tos/td-p/13234775
- https://www.licenseorg.com/guide/3d-assets/mixamo (corroborating, not primary)

### Why this rules Mixamo out for the SDK's bundling requirement

`@khaveeai/react` bundling default FBX clips inside the npm package is structurally identical to
the explicitly prohibited case: "asset packages ... which redistribute character or animation raw
files as the product." The SDK package's entire purpose for these files would be to redistribute
the raw animation asset to every consuming developer who installs the package — not to embed the
asset inside one finished, shipped end-product that Khavee itself ships. That is exactly the
distinction the FAQ draws (embedded-in-one-finished-project = OK; raw-file-redistribution-as-a-
product = not OK).

**Confidence caveat**: this verdict rests on the Adobe Community FAQ thread and a third-party legal
guide, not on a page served directly from adobe.com/helpx.adobe.com (both of those URLs timed out on
every fetch attempt in this session). It is corroborated by two independently-worded sources that
agree with each other and is consistent with the long-standing community consensus on Mixamo
licensing, but I was not able to pull the clause directly from Adobe's own legal/helpx domain in
this session. Recommend a follow-up manual check of helpx.adobe.com/creative-cloud/faq/mixamo-faq.html
and adobe.com/legal/terms.html before treating this as fully closed.

---

## 3. Existing bundled files' license risk assessment

Inspected directly via `file` and `strings` on the actual binaries in
`public/models/animations/`:

```
Idle.fbx          Kaydara FBX model, version 7700
talking.fbx        Kaydara FBX model, version 7700
talking1.fbx        Kaydara FBX model, version 7700
Fist Fight B.fbx    Kaydara FBX model, version 7700
```

All four files contain the literal ASCII string **`Mixamo, Inc.`** embedded in their FBX metadata,
plus the full standard Mixamo bone-naming set (`mixamorig:Hips`, `mixamorig:LeftArm`,
`mixamorig:LeftHandIndex1`, etc.), plus the internal take/clip name `mixamo.com` /
`mixamo.com.tak`, plus scene-description strings like `"MotionOnlyScene; Retargeted Clip; Motion
Sequence; 1 motions; Skeleton mixamorig:Hips"`.

**This is not a naming-convention inference — it is a literal embedded company-name string.** These
four files are confirmed Mixamo exports, not just "Mixamo-typical." Given the verdict in §2, this
means:

- `Idle.fbx` (covers `ready`/`stopped` base idle)
- `talking.fbx` + `talking1.fbx` (covers `speaking`'s 2-variant requirement)
- `Fist Fight B.fbx` (unused/unmapped to any ChatStatus state)

are **already a live licensing risk today**, independent of anything new being sourced for this
ticket. The repo currently redistributes raw Mixamo FBX exports inside a public GitHub repo whose
`packages/react` is published as an npm package — exactly the pattern §2 found to be prohibited.
This is a pre-existing problem, not something introduced by the new `starting`/`stopped`/
`listening`/`thinking` gaps.

---

## 4. CC0/redistribution-safe sourcing recommendation for the gaps

### Verified source: Quaternius — Universal Animation Library 2

Fetched directly from the creator's own site (primary source) and cross-checked against the
OpenGameArt mirror listing:

- `https://quaternius.com/packs/universalanimationlibrary2.html` (primary, creator's own site)
- `https://quaternius.itch.io/universal-animation-library-2` (creator's own itch.io storefront)
- `https://opengameart.org/content/universal-animation-library-2` (third-party mirror/listing, used
  for corroboration)

Quoted license statement (identical wording on both the creator's own site and itch.io page):
> "Free to use in personal, educational and commercial projects. (CC0 License)"

The quaternius.com page links the CC0 grant to `creativecommons.org/publicdomain/zero/1.0/`
directly. The OpenGameArt listing independently tags the asset:
> "License: CC0 (Creative Commons Zero) ... dedicates the work to the public domain with no rights
> reserved."

CC0 is a public-domain dedication with no attribution requirement and no field-of-use restriction —
this squarely clears the ticket's bar ("CC0, MIT, or explicit royalty-free/redistributable-in-
software grant," and explicitly NOT attribution-in-UI-required).

**File formats provided** (per quaternius.com): FBX, GLB, glTF, OBJ, and Blend (source). A "Source"
tier ships the `.BLEND` rig+animation file also under CC0, enabling re-export/trimming.

**Rig compatibility**: the pack description states it is built on "a universal humanoid rig ... ready
for retargeting" and per one fetched summary is explicitly noted as **"Compatible with Mixamo
rigs"** — meaning it is plausible (not yet hands-on verified by opening the files in this session)
that it could be run through the existing `remapMixamoAnimationToVrm.ts` / `mixamoVRMRigMap.ts`
pipeline for the VRM path with little or no change, since that pipeline keys off `mixamorig:*` bone
names.

**Candidate clip mapping** (from the named-clip list actually returned by the fetch of the
itch.io page):
- `starting` (greeting): `WAVE` is present in the pack and is a plausible direct fit.
- `ready`/`stopped` idle base: `IDLE_POSE_ARMS` and several other `IDLE_*` variants are present.
- `listening`/`thinking`: no clip in the fetched name list is an obvious semantic match
  (`IDLE_TALKING_PHONE` is closest for a "listening" pose but is not a clean fit); would likely
  need hand-selection/review of the full 130+ clip pack (not just the sample list surfaced by the
  fetch) or a second CC0 source.
- `stopped` (goodbye/settling): no obvious named match surfaced in the fetched list either — same
  caveat as above.
- `speaking` 2nd+ variant: no dedicated "talk" gesture surfaced in the fetched sample list;
  `IDLE_TALKING_PHONE` is adjacent but is a phone-call pose, not a generic talking-gesture loop.

**This is a partial, not complete, mapping.** The pack almost certainly contains better matches
among its full 130+ clips than what the fetch's summarized listing surfaced — a follow-up task
should download the pack and inventory the full clip list by hand (or via the `.blend`) rather than
relying on the truncated names returned here.

### Other CC0 sources noted but not fully verified this session

- **Kay Lousberg / kaylousberg.com** (`https://kaylousberg.itch.io/kaykit-adventurers`,
  `https://kaylousberg.com/game-assets/characters-adventurers`) — WebSearch results describe these
  as CC0/public-domain, "free for personal and commercial use with no attribution required," in
  FBX/OBJ/glTF formats. **I did not WebFetch kaylousberg.com's own license page directly this
  session** — this is search-summary-level confidence, not a page I personally fetched and quoted
  from. Flagging per the instruction to be explicit about verification level: treat as a promising
  lead, not a verified source, until someone WebFetches the actual kaylousberg.com license text.
- Kenney.nl was considered as a well-known CC0 asset publisher but was not investigated this
  session (time-boxed to the sources above); worth checking as a second/backup CC0 source for the
  listening/thinking/goodbye gaps if Universal Animation Library 2's full clip list doesn't cover
  them.

---

## 5. GLB-format constraint finding

**Confirmed via direct code inspection: there is no GLB-side retargeting layer in this codebase.**

- `packages/react/src/GLBAvatar.tsx` loads a GLB via `useGLTF`, extracts `gltf.animations` via
  drei's `useAnimations`, and plays clips directly by name/index against whatever skeleton is
  embedded in that same GLB file (`GLBAvatar.tsx:106-136`). There is no bone-remapping step
  anywhere in this component.
- Repo-wide grep for `retarget|remapMixamo|mixamoVRMRigMap` across all `.ts`/`.tsx` files returns
  hits only in the VRM path: `packages/react/src/utils/remapMixamoAnimationToVrm.ts`,
  `packages/react/src/utils/mixamoVRMRigMap.ts`, `packages/react/src/VRMAvatar.tsx`, and the demo
  app's parallel copies (`src/app/utils/remapMixamoAnimationToVrm.ts`,
  `src/app/utils/mixamoVRMRigMap.ts`, `src/app/components/VRMAvatarRef.tsx`). Nothing touches
  `GLBAvatar.tsx`.
- Additionally, `GLBAvatar` has **no bundled default model at all** — its `src` prop is required and
  always points at a caller-supplied GLB (`public/models/{cat,fred,happy,dragon,tiger,pla}.glb` in
  this repo are all non-humanoid demo assets, not a default avatar). This is a second, related gap
  beyond pure animation retargeting: there is currently no "default humanoid GLB avatar" for the SDK
  to attach bundled clips to even if the clips existed.

**Implication**: because GLB animation playback in this codebase is skeleton-identity-dependent
(same GLB file, same embedded skeleton, no remap), a bundled default clip set for the GLB path
cannot simply be "any CC0 humanoid animation file, converted to GLB." It only works if the
animation's skeleton bone names/hierarchy exactly match whatever skeleton the SDK's (currently
nonexistent) bundled default GLB avatar uses. Two ways this constraint could be satisfied:

1. **Custom-authored path (matches ticket's framing)**: the SDK ships its own default GLB humanoid
   avatar with a fixed rig, and all six states' clips are authored/exported against that exact rig.
   This is real work, not sidesteppable by any off-the-shelf source, because no third-party GLB
   package will happen to share a bespoke bundled avatar's exact skeleton.
2. **Adopt a redistribution-safe rig+character+animation bundle as the default GLB avatar itself**:
   Quaternius's Universal Animation Library 2 ships GLB-format animations built on "a universal
   humanoid rig" (§4) — if the SDK also adopted a CC0 character model built on that same rig as its
   bundled default GLB avatar (rather than trying to retrofit clips onto an unrelated existing GLB),
   the animation-skeleton-matching problem would be sidestepped by construction, since both the
   avatar and the clips would share one known rig. **This was not verified end-to-end this
   session** (i.e., I did not confirm Quaternius ships a redistribution-safe humanoid *character*
   model on that same rig, only that the animation pack itself is CC0 and GLB-exportable) — it's a
   plausible path, flagged for follow-up, not a confirmed solution.

Bottom line: **the GLB gap is real and confirmed by code inspection** (no retargeting layer exists),
and no fully-verified redistribution-safe GLB-native source that sidesteps it was found this
session — only a plausible-but-unconfirmed path (option 2 above).

---

## 6. Listening/thinking variant-count ambiguity — explicit open decision

Per the ticket's locked framing, `listening` and `thinking` variant counts were **never pinned to a
specific number** by prior decisions. The working assumption handed down is "aim for 2+, 1
acceptable if licensing/budget is tight." This document does **not** resolve that ambiguity — it is
called out here explicitly so it isn't silently decided as a side effect of sourcing:

- If 1 clip each is acceptable, the Quaternius pack (or a similar CC0 source) likely has *at least*
  one usable idle-adjacent pose per state without much difficulty.
- If 2+ each is required, the partial mapping in §4 shows the sample-list fetch did not surface
  clean matches for either state — closing that gap at 2+ variants each would need either a full
  manual inventory of Universal Animation Library 2's 130+ clips, or a second CC0 source
  specifically for conversational listening/thinking poses (head-tilt, chin-touch, nod-loop, etc.),
  neither of which was completed in this research pass.

This should be resolved as a product/design decision (clip count) before the sourcing task is
scoped as "done," not inferred from whatever happens to be easiest to find in one asset pack.

---

## 7. Ticket #16 follow-up — full clip inventory, remaining-gap mapping, second-source search, default GLB avatar verification

Everything below is **new research completed for #16**, the closing ticket for this sourcing
effort. Sections 1–6 above are the original #9 pass and are left as-written (not silently edited)
per #16's instructions. Where #16's findings sharpen or correct a #9 finding, that is called out
explicitly rather than rewriting §1–6 in place.

Locked requirement going into this pass (from #15, superseding §6's "never pinned" note): `starting`
1, `stopped` 1 (goodbye, distinct from `starting`), `speaking` 2+, `listening` 2+, `thinking` 2+.

### 7.1 Full clip list — what was actually obtainable

**Verdict: a complete, authoritative 130+ clip list for Universal Animation Library 2 could NOT be
obtained via WebFetch/WebSearch.** This confirms §4's caveat rather than resolving it. What follows
is everything that *could* be pulled from fetchable pages, stated plainly as partial.

Sources attempted:
- `https://quaternius.com/packs/universalanimationlibrary2.html` (primary/creator site) — describes
  the pack only by category ("melee and armed combos, parkour movement, farming, fishing, zombie
  locomotion... 3 and 4 hit combos... full combo anims"), no per-clip names.
- `https://quaternius.itch.io/universal-animation-library-2` (creator's itch.io storefront) — **this
  is the one page that names individual clips.** It explicitly enumerates the pack's free/standard
  tier as containing named clips including: `CHEST_OPEN`, `CLIMB_UP_1M`, `COUGHING`, `HARVEST`,
  `PLANT_SEED`, `WAVE`, `KNOCKBACK`, `IDLE_POSE_ARMS`, `IDLE_CARRY`, `IDLE_LANTERN`, `IDLE_RAIL`,
  `IDLE_RAIL_CALL`, `IDLE_SHIELD_BREAK`, `IDLE_SHIELD`, `IDLE_TALKING_PHONE`, `LAYFACEUP`,
  `MELEE_HOOK`, `MELEE_HOOK_REC`, `MELEE_JUMP_LAND`, `NINJUMP_JUMP`, `NINJUMP_LAND`, `NINJUMP_SLASH`,
  `NINJUMP_SPIN`, `NINJUMP_SPIN_REC`, `SLIDE`, `SLIDE_LOOP`, `OVERHAND_THROW`, `SWORD_DASH`,
  `SWORD_REGULAR_A`, `SWORD_REGULAR_A_REC`, `SWORD_REGULAR_A_COMBO`, `SWORD_REGULAR_A_COMBOB`,
  `WALK_CARRY`, `WALK_IDLE`, `ZOMBIE_SCRATCH`, `ZOMBIE_WALK_FWD` — 36 named clips surfaced by the
  fetch (the page's own copy claims "42 free standard animations," so even this named list may be
  incomplete by a handful).
- `https://opengameart.org/content/universal-animation-library-2` — category-level description only
  ("melee and armed combos, parkour movement, farming, fishing, zombie locomotion and a lot more!"),
  no per-clip names, no file-tree listing exposed on the page itself.
- `https://quaternius.com/animviewer.html` — the creator's own animation *preview tool*, which per
  multiple secondary sources (80.lv, WebSearch summaries) is the actual place all 130+ clip names
  and previews are visible. **This page renders its clip list via client-side JS/canvas — WebFetch's
  HTML-to-markdown conversion returned only static nav-bar content (Assets/Tutorials/FAQ/Portfolio
  links), not the dynamically-populated animation list.** This is a genuine tooling limitation, not
  a missing source: the authoritative full list demonstrably exists and is publicly viewable in a
  browser, it just isn't extractable by a text-based fetch.
- Three secondary-source articles (80.lv: https://80.lv/articles/get-this-animation-asset-library-with-over-130-diverse-items;
  digitalproduction.com: https://digitalproduction.com/2026/02/10/130-animations-one-rig-zero-drama/;
  jettelly.com: https://jettelly.com/blog/universal-animation-library-2-a-cross-engine-animation-pack-with-a-universal-humanoid-rig)
  were fetched specifically hoping for a fuller enumeration. All three independently describe the
  pack only in the same broad categories (combat/parkour/farming/fishing/zombie/civilian-activity)
  and explicitly do **not** name individual listening/thinking/talking/idle-social clips. One
  (digitalproduction.com) does mention, from an image caption, four unnamed "behavior" category
  gesture poses visible in a promotional screenshot: a "surprised" pose, a "thumbs up" pose, a
  "crossed arms" pose, and a "no" (head-shake) gesture — none of which is confirmed to have a
  `LISTENING_*`/`THINKING_*`-style clip name, and "crossed arms" is a plausible but unconfirmed
  thinking-adjacent candidate at best.
- The pack's own marketing copy states the free/standard tier is "**60–70% of the pack**" (paid
  Source tier being the rest) — meaning even a complete enumeration of the free tier would not be a
  complete enumeration of the full 130+, and the un-enumerated ~30–40% is exactly where
  listening/thinking-specific clips (if they exist at all) would most plausibly be hiding, given the
  free tier's clips skew heavily toward combat/parkour/labor rather than conversational idle poses.

**Conclusion for this subsection**: per the ticket's own instruction to say so explicitly rather than
guess — the full clip list genuinely cannot be confirmed via WebFetch/WebSearch in this session. The
only clip names citable with confidence are the ~36 named above, scraped from the itch.io storefront
copy.

### 7.2 Per-gap candidate mapping (based on the confirmed clip names in §7.1 only)

| Gap | Best candidate found | Verdict |
|---|---|---|
| `stopped` (goodbye) | `WAVE` — but this is the same clip already assigned to `starting` (greeting). No second wave-goodbye, bow, or settling clip appears in the named list. `LAYFACEUP` and `KNOCKBACK` are not usable (combat-death-adjacent, wrong affect). | **Still open.** No dedicated goodbye clip found in Universal Animation Library 2's confirmed names. Reusing `WAVE` for both `starting` and `stopped` would violate #15's "distinct from `starting`" requirement. |
| `listening` (2+) | `IDLE_TALKING_PHONE` (carried over from §4, still the closest thing found — a person on a phone call is holding a listening-adjacent posture) and `IDLE_RAIL_CALL` (name suggests a phone-call idle at a railing; not verified visually, plausible second angle on the same "on a call" idea). | **Still open, and under-supplied.** At best these two are both "on a phone call" poses, not general conversational-listening poses (head-tilt, attentive nod, arms-relaxed-facing-speaker) — same specific concern §4 flagged with `IDLE_TALKING_PHONE`, and having two phone-call variants doesn't satisfy a "2+ *distinct* listening variants" bar in spirit even if it satisfies it by count. Needs either the un-enumerated ~30-40% of the pack (unverifiable, see §7.1) or a second source. |
| `thinking` (2+) | None in the confirmed name list. `CHEST_OPEN` and `COUGHING` were checked and are not usable (unrelated action / uncomfortable to loop as an idle). The digitalproduction.com "crossed arms" screenshot caption (§7.1) is a plausible unnamed candidate but has no clip name attached and cannot be confirmed to exist in the free tier vs. paid-only tier. | **Still open.** No named or confirmable candidate. |
| `speaking` 2nd variant | `IDLE_TALKING_PHONE` is the only talk-adjacent named clip and is already the best (imperfect) candidate carried from §4 — using it for `speaking` conflicts with using it for `listening` above; the pack does not appear to have two independent talk-gesture clips in its confirmed names. | **Still open** as a *clean* 2nd variant; `IDLE_TALKING_PHONE` is a usable but compromised single option, already contested against the `listening` gap above. |

Net effect: of the 4 named remaining gaps, **zero are cleanly resolved by Quaternius's Universal
Animation Library 2's confirmed clip names.** The pack's free/standard tier is real, CC0, and does
supply `starting` (`WAVE`) and `ready`/`stopped`-idle-base (`IDLE_POSE_ARMS`/`IDLE_*`) as already
established in §4 — but it does not supply distinct, clean conversational gesture clips for
`stopped`(goodbye), `listening`×2, `thinking`×2, or a clean `speaking` 2nd variant. This is a
materially more pessimistic finding than §4's "partial mapping, needs full inventory" hedge: the
inventory was pursued as far as tooling allows, and the gaps did not close.

### 7.3 Second CC0 source search — Kenney.nl and others

**Kenney.nl license verified directly (per ticket's request to check it):**
- `https://kenney.itch.io/kenney-character-assets` (free demo storefront page) — quoted directly:
  "All included game assets are public domain (Creative Commons Zero) licensed," formal license tag
  "Creative Commons Zero v1.0 Universal." This clears the redistribution-in-npm-package bar
  identically to Quaternius's CC0 grant (§4).
- Corroborated generally (not a specific-page quote) by WebSearch summary of Kenney's own site
  license terms: "All game assets on the asset pages are public domain licensed (CC0)... no
  requirements for attribution, permission, or royalty payments," with optional (not required)
  attribution to "Kenney"/"Kenney.nl."

**But Kenney's character-animation packs checked do not cover the gap either.** Specifically
checked, by animation-name enumeration:
- `kenney.itch.io/kenney-character-assets` (the "Animated Characters Bundle": 4 character models, 75
  skins, 40 accessories, **17 named animations**) — full list obtained: `Attack`, `Crouch`, `Crouch
  (idle)`, `Crouch (walk)`, `Death`, `Idle`, `Interact (ground)`, `Interact (standing)`, `Jump`,
  `Kick`, `Punch`, `Racing (idle)`, `Racing (steer left)`, `Racing (steer right)`, `Running`,
  `Shooting`, `Walking`. **No conversational animations present at all** — this pack is entirely
  combat/movement/vehicle-oriented, not a match for any of the 4 remaining gaps.
- `kenney.nl/assets/animated-characters-3` (and the near-identical `-1`/`-2` predecessors) — only 3
  animations each: `Idle`, `Jump`, `Running`. Not a match.
- `kenney.nl/assets/mini-characters` — confirms animation support exists but the page does not
  enumerate clip names; could not be further verified without downloading the pack (same tooling
  limitation as §7.1's animviewer case).

**Other CC0 sources checked and ruled out:**
- `maxparata.itch.io/cc0-animations` ("Free Essential Animation pack" by monogon, CC0 confirmed) — 5
  clips only: `Idle`, `Run`, `Attack (Sword)`, `Hit`, `Death`. Not a match.
- `github.com/madjin/awesome-cc0` (curated CC0 asset list) — checked for any conversational-gesture
  animation entry; contains only general links back to Quaternius and Kenney (already covered
  above), no dedicated conversational-animation resource found.
- MoCap Online's "Conversations" pack and Reallusion ActorCore's "Talk & Listen" pack **do** appear
  in general web search to contain exactly the right semantic content (explicit "Convo_11_Listening"-
  style clip naming was seen in a search snippet) — but both are commercial marketplace products, not
  found to carry a CC0/MIT/redistributable-in-software grant; not pursued further as they don't clear
  this ticket's licensing bar on their face, and their actual license terms were not directly fetched
  to confirm/deny (flagging only as a "known to exist, presumed unsuitable pending confirmation"
  category, not as a ruled-in or fully ruled-out option).

**Net verdict for 7.3**: No second CC0 source was found this session that supplies clean, named
`listening`/`thinking`/`stopped`-goodbye/`speaking`-2nd-variant clips. Kenney.nl is licensing-verified
as a viable *type* of source (CC0, redistribution-safe, same bar as Quaternius) but its specific
character-animation packs checked are combat/locomotion-focused, not conversational-gesture-focused.
This gap search should be considered incomplete, not exhausted — untried avenues include: Kenney's
"Development Essentials" and "Blocky Characters" packs (not checked this session), downloading and
manually inspecting Quaternius's free-tier .zip directly (not just its storefront copy) or the
paid Source tier's full manifest, and Mixamo-compatible-rig CC0 packs from other small creators not
surfaced by the searches run here.

### 7.4 Default GLB avatar verification — RESOLVED

This closes the open question §5 flagged ("not verified end-to-end this session ... plausible path,
flagged for follow-up, not a confirmed solution").

**Verdict: CONFIRMED.** Quaternius publishes a standalone CC0 humanoid character/mesh pack —
**"Universal Base Characters"** — that is explicitly stated (on the creator's own site) to be built
on a compatible rig for retargeting, and independently carries its own CC0 grant.

- `https://quaternius.com/packs/universalbasecharacters.html` (primary, creator's own site) — quoted
  directly: pack contains "6 base character models across three body proportions (Superhero, Regular,
  and Teen)... male and female variants, 20 interchangeable hairstyles," "Humanoid Rig compatible
  with retargeting in any engine," and is "explicitly noted as 'Compatible with the Universal
  Animation Library.'" License: "Free to use in personal, educational and commercial projects. (CC0
  License)" — same license family and same wording pattern as the animation pack, independently
  stated on this pack's own page (not inferred from the animation pack's license).
- `https://quaternius.itch.io/universal-base-characters` (creator's itch.io storefront) — re-fetched
  specifically to check exact wording of the rig-compatibility claim. Quoted verbatim: **"Compatible
  with the Universal Animation Library."** — Important precision: this sentence names the **first**
  Universal Animation Library, not "Universal Animation Library 2," by name. Formats: Standard.zip
  (122MB, OBJ/FBX/glTF) and a paid Source.zip (600MB, adds .blend + engine projects). License
  re-confirmed on this page: "Creative Commons Zero v1.0 Universal."

**Confidence caveat on the rig-match claim**: Quaternius's own copy explicitly says the base
characters are compatible with "the Universal Animation Library" (pack 1), not explicitly "...2" by
name, on either page checked. Both packs are independently described (on their own respective pages)
as being built on "a universal humanoid rig" using near-identical language, and Quaternius's own
branding treats "Universal Animation Library" and "Universal Animation Library 2" as the same rig
family (the pack 2 page calls itself a continuation: "This kit complements the first library" per
WebSearch summary of the pack 2 itch.io page) — so a shared rig across all three packs (base
characters + library 1 + library 2) is the plausible, consistent-with-the-brand-name reading, but it
is **not** a sentence anyone at Quaternius has put in writing verbatim for the Library-2-to-
Base-Characters pairing specifically. Recommend a hands-on rig/bone-name diff (open both packs'
`.blend`/glTF skeletons and compare) before treating this as fully closed at implementation time —
the *character model* half of the requirement (a redistribution-safe CC0 humanoid mesh exists) is
solid; the *exact-rig-match-to-Library-2* half is strong-circumstantial, not a verbatim-quoted
guarantee.

**Bottom line for 7.4**: the SDK has a verified, CC0, creator-confirmed path to a bundled default GLB
avatar (Universal Base Characters) whose license is independently verified (not inferred), addressing
§5's "no confirmed character/mesh model" gap. The remaining risk is narrower than before: not "does a
CC0 character model exist" (yes) but "does it use the *exact same* skeleton as Library 2's clips"
(plausible, brand-consistent, but not verbatim-confirmed — needs a file-level check, not further web
research, to fully close).

### 7.5 Summary table — gap status after #16

| Gap | Status after #16 | Detail |
|---|---|---|
| `stopped` (goodbye, distinct clip) | **Open** | No dedicated goodbye/farewell clip found in Quaternius's confirmed names; no second CC0 source found either. Needs full-pack manual inventory (§7.1) or a third source. |
| `listening` (2+) | **Open** | Best candidates (`IDLE_TALKING_PHONE`, `IDLE_RAIL_CALL`) are both phone-call poses, not general listening poses, and are contested against the `speaking` gap below. |
| `thinking` (2+) | **Open** | No named or clip-level-confirmed candidate found anywhere searched this session. |
| `speaking` 2nd variant | **Open** | Same single candidate (`IDLE_TALKING_PHONE`) as `listening`, already imperfect per §4; cannot cleanly serve both gaps. |
| Default GLB avatar mesh | **Resolved** | Quaternius "Universal Base Characters" — CC0-verified on its own page, retargeting-ready humanoid rig, explicitly stated by the creator to be built for the Universal Animation Library rig family. Exact skeleton-level match to Library 2 specifically is strong-circumstantial, not verbatim-confirmed — flag for a hands-on file check before implementation. |

**Recommended next step (outside this research task's scope)**: since WebFetch/WebSearch tooling has
been exhausted for the clip-name question (§7.1's animviewer.html limitation is a hard tooling wall,
not a missed search), closing the remaining 4 gaps needs either (a) someone downloading Quaternius's
actual free-tier .zip and/or paid Source tier and inventorying the real file list by hand, or (b) a
scoped search for a third CC0/MIT source specifically pre-filtered to "conversational NPC gesture"
packs rather than general animation libraries, since both sources checked this session (Quaternius,
Kenney) are general-purpose action/locomotion libraries where conversational idle gestures are
structurally under-represented.
