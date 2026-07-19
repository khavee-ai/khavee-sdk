# Animation Asset Research

Research notes on where to source animation files for the VRM avatar SDK, covering conversational states (**idle / talking / listening / thinking**), with 2+ variants per state. Findings verified July 2026.

---

## TL;DR Recommendation

For **conversational states** specifically, the VRMA ecosystem isn't ready yet — it's dominated by VTuber dance/pose content. The most pragmatic path today is **FBX**:

- **Idle + Thinking**: [Mixamo](https://www.mixamo.com) — **free**, multiple idle variants + a literal "Thinking" pose
- **Talking + Listening**: [MoCap Online "Conversations" pack](https://mocaponline.com/products/convo) — **$29.99**, 28 clips incl. `Convo_11_Listening` + talk variants across moods (Low Key / Upbeat / Animated / Gesturing), FBX confirmed

**Total: ~$30**, covers all four states with 2+ variants each. The SDK already has working FBX + Mixamo-retargeting infrastructure (`mixamoVRMRigMap.ts`).

---

## VRMA Sources (native VRM format — no retargeting needed)

> VRMA (VRM Animation) released Feb 2024. Same file works on any VRM model. Format is ideal but the content ecosystem is immature.

| Source | Cost | Contents | License | Notes |
|--------|------|----------|---------|-------|
| **[VRoid official 7-pack](https://vroid.booth.pm/items/5512385)** | Free | Greeting, peace-sign, spin, squat, shoot, model-pose, show-full-body | Commercial OK **with attribution** ("Character animation credits to pixiv Inc.'s VRoid Project"); **no redistribution in extractable form** | ⚠️ No idle/talk/listen/thinking. Redistribution clause **conflicts with bundling in an npm package**. |
| **[tk256ailab/vrm-viewer (GitHub)](https://github.com/tk256ailab/vrm-viewer/tree/main/VRMA)** | Free (MIT code) | `Thinking.vrma` + Angry/Blush/Clapping/Goodbye/Jump/LookAround/Relax/Sad/Sleepy/Surprised | README says "ensure you have appropriate rights" — **provenance unclear** | ⚠️ Not clearly redistributable. Emotion clips (Sad/Surprised) pair nicely with the emotion system but licensing must be cleared. |
| **[sashii CC0 packs (BOOTH)](https://booth.pm/en/items/7861818)** | Free (CC0) | Run / SlowRun / Walk only | CC0 — fully redistributable, no attribution | ✅ Ideal license for SDK bundling. ❌ Wrong content (locomotion only). |
| **[ROLOCK pose/animation library (BOOTH)](https://booth.pm/en/browse/3D%20Motion%20&%20Animation?tags%5B%5D=VRMA&sort=wish_lists)** | ¥400 (~$2.70) | Pose/animation library for VRM photography (most-wishlisted non-dance VRMA item, 199 wishes) | Per BOOTH item terms — read before use | Closest thing to a usable VRMA pack; aimed at photography, not conversation. |
| **BOOTH VRMA category (general)** | ¥0–¥1,200+ | Mostly **TikTok dances**; some gesture/pose sets | Varies by creator | Browse: search "VRMA" on [booth.pm](https://booth.pm), filter 3D Motion & Animation. Japanese-language marketplace. |

### Why VRMA isn't ready for conversational states
- No reputable paid VRMA pack covers idle/talk/listen/thinking in one purchase.
- The format only launched Feb 2024; the creator community is focused on VTuber dance/photography content.
- Free CC0 VRMA packs exist but cover locomotion (run/walk), not conversation.

---

## FBX Sources (requires retargeting — SDK already supports this)

| Source | Cost | Coverage | Formats | Notes |
|--------|------|----------|---------|-------|
| **[Mixamo](https://www.mixamo.com)** | Free (Adobe account) | Idles (several), "Thinking" pose, gestures, ~2,500 clips total | FBX | ⚠️ Independently-authored clips have large pose gaps → crossfade pops. Mitigated in code (D-12 eased + pose-distance-adaptive blend). |
| **[MoCap Online "Conversations"](https://mocaponline.com/products/convo)** | $29.99 | 28 clips: talking + `Convo_11_Listening` + moods (Low Key/Upbeat/Animated/Argument/Sad/Gesturing) | FBX + UE/iClone/Unity/BIP/Blender | ✅ Best fit for the use case. Explicitly conversational. |
| **[MoCap Online Free Sampler](https://mocaponline.com/products/free-mocap-animation-pack)** | Free | 16 clips incl. idle poses + social gestures | FBX + multiple | Curated preview of their paid style. |
| **[MoCap Central "Greet & Talk"](https://mocapcentral.com/products/mocap-studio-series-greet-talk-pack)** | $64.99 | 134 paired talker/listener animations, neutral/positive/negative tones, solo versions | FBX + UE/Unity | Deeper variety than the $30 option. |
| **[MoCap Central "Idles"](https://mocapcentral.com/products/mocap-studio-series-idles-pack)** | $54.99 | 238 idle variants across 22 themed sets | FBX + UE/Unity | Premium idle variety (vs. free Mixamo). |
| **[Human Basic Motions FREE (Unity Asset Store)](https://assetstore.unity.com/packages/3d/animations/human-basic-motions-free-154271)** | Free | 8 conversations (talking/question/exclamation), standing idles, waves, claps | Unity Humanoid (retarget needed) | Single creator → consistent base pose. |
| **[Quaternius Universal Animation Library 1 & 2](https://quaternius.itch.io/universal-animation-library)** | Free (CC0) | 120–130+ animations each | FBX, glTF | ⚠️ Couldn't confirm talking-specific content; check pack contents. |
| **[KayKit Character Animations](https://kaylousberg.itch.io/kaykit-character-animations)** | Free (CC0) | 161 animations | FBX, GLTF | Same caveat — verify conversational content. |
| **[ActorCore Free Motions](https://actorcore.reallusion.com/3d-motion/free)** | Free (registration) | "Talk & Listen" (121 motions) + "Idle" (104 motions) categories, FBX | FBX + engine presets | Purpose-built talk/listen set; up to 10 free downloads/day. |
| **[Rokoko Free Resources](https://www.rokoko.com/free-resources)** | Free | 150–263 mocap clips | FBX/BVH/CSV | General library, not talk-specific. |
| **[CMU Motion Capture Database](https://mocap.cs.cmu.edu/)** | Free (no commercial restriction) | Thousands of raw motions incl. conversational data | BVH (needs cleanup) | Raw academic data, no idle/talk categorization. Real cleanup work. |

### FBX technical note
These packs use their own rig bone names (Mixamo's `mixamorig:*`, Unity Humanoid, ActorCore's CC rig) — not VRM's directly. The SDK already has a Mixamo→VRM name map (`packages/react/src/utils/mixamoVRMRigMap.ts`); other rigs need a new mapping table built (same pattern, contained task).

---

## Comparison: VRMA vs FBX

| | VRMA | FBX |
|---|------|-----|
| **Bone compatibility** | Native to VRM — perfect, zero retargeting | Requires bone-name remapping |
| **Pose-gap pop on crossfade** | Less likely if clips share a creator's base pose | More likely (independently-authored clips) — mitigated by D-12 code |
| **Conversational content availability** | ❌ Essentially none (Jul 2026) | ✅ Multiple paid packs + free Mixamo |
| **Free options** | Locomotion only (CC0) | Mixamo idles/thinking + ActorCore free tier |
| **SDK infrastructure** | Would need new VRMA loader (`@pixiv/three-vrm-animation` already a dep) | Already working today |

---

## Code-side mitigations already built (this session)

Regardless of which clips are chosen, the SDK now has:

1. **D-12 Eased + adaptive crossfade**: replaces THREE's linear `fadeIn/fadeOut` with `easeInOutCubic`, and stretches fade duration (0.25s–0.8s) based on measured pose gap between from/to clips.
2. **D-13 Variant cycling**: name extra clips `idle2`, `speaking2`, etc. — the SDK randomly cycles between variants when the current one finishes a loop pass.
3. **D-13 Bundled defaults**: `VRMAvatar` works with zero `animations` prop via `DEFAULT_ANIMATIONS`.

These help most with FBX's pose-gap problem; they're less critical for VRMA but still apply.

---

## Open question for decision

- **Hold for VRMA maturity** and ship nothing as default, OR
- **Ship FBX defaults now** (requires hosting decision per `DEFAULT_ANIMATIONS` — see [asset-hosting decision](../11-bone-masked-upper-body-animation-layering/) notes: CDN vs. npm-package-ship vs. demo-app-only).

The cleanest content-licensing story for *bundled SDK defaults* would be **CC0 FBX** (Quaternius/KayKit if they have conversational content, confirmed during evaluation) — but their coverage of the four conversational states is unverified.
