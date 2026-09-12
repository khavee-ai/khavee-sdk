---
spike: 004
name: backdrop-plane-dof
type: standard
validates: "Given real customer background images at several aspect ratios, when a backdrop plane is placed in-canvas behind the avatar and DOF is enabled, then `background-size: cover` equivalence holds across viewport resizes and DOF separates background from subject without blurring the avatar"
verdict: VALIDATED
related: [005, 006, 007]
tags: [lighting, dof, background, composition]
---

# Spike 004: Backdrop Plane + Depth of Field

## What This Validates

**Given** real customer background images at several aspect ratios,
**when** a backdrop plane is placed in-canvas behind the avatar and depth of field is enabled,
**then** `background-size: cover` equivalence holds across viewport resizes, and DOF separates
the background from the subject without blurring the avatar.

This is the spike Phase 16's CONTEXT D-08 mandates. It carries the most risk in the phase:
D-07 makes the in-canvas backdrop **default-on when a background source is supplied**, so there
is no opt-in flag to hide an unfinished implementation behind. If this spike fails, the
in-canvas path must not ship at all.

## Research

`@react-three/postprocessing@3.0.4` exposes `DepthOfField` backed by `postprocessing`'s
`DepthOfFieldEffect`. Two ways to aim it:

| Approach | Props | Pros | Cons |
|---|---|---|---|
| World-space focus | `worldFocusDistance`, `worldFocusRange` | Focus expressed in scene units — directly comparable to the avatar's real distance from camera | Needs the avatar's camera distance to be known/stable |
| Screen-space focus | `focusDistance`, `focalLength`, `focusRange` | Matches the classic postprocessing API | Normalised 0-1 depth values, opaque to reason about and camera-dependent |
| Focus target | `target: Vector3` | Auto-tracks a moving subject | Extra coupling; unnecessary while the avatar is stationary |

**Chosen:** world-space (`worldFocusDistance` / `worldFocusRange`) plus `bokehScale`. It is the
only option where the spike's own numbers (backdrop distance, focus distance) are in the same
units, which is what makes "is the avatar in focus and the backdrop out of it" a checkable
statement rather than a vibe.

**Aspect-cover:** no library helper. drei has no `Backdrop`-with-cover in this version, so the
crop is done directly through `texture.repeat` / `texture.offset`, which is the standard
three.js idiom. Two separate pieces of arithmetic are involved and conflating them is the usual
bug:
1. **Plane size** — a plane that fills a perspective camera at distance `d` has height
   `2*d*tan(fov/2)` and width `height * cameraAspect`. `PerspectiveCamera.fov` is the
   **vertical** FOV, so height must be derived first. Deriving width first looks right at 16:9
   and breaks on portrait.
2. **Texture crop** — given that plane and an image of a different aspect, crop the image's
   long axis and centre the remainder.

**Gotcha found while writing:** the texture must use `ClampToEdgeWrapping`. Cover samples a
sub-rectangle, and under the default `RepeatWrapping` the cropped edge wraps around and
reappears on the opposite side.

**Gotcha 2:** the backdrop must use `meshBasicMaterial` with `toneMapped={false}`, not
`meshStandardMaterial`. A backdrop is an image, not a surface in the scene — lighting it with
the avatar's rig makes it stop matching its source, and tone-mapping it a second time
double-applies the curve Phase 15 just finished choosing.

## How to Run

```bash
pnpm dev        # user runs this themselves
# then open http://localhost:3000/lighting-spike
```

Headless half (the arithmetic — no browser needed):

```bash
cd .planning/spikes/004-backdrop-plane-dof
node --experimental-strip-types verify-cover-math.mjs
```

## What to Expect

**Cover correctness** — resize the browser window and watch the red border:
- correct: the border stays flush against two edges and is cropped off the other two; the green
  centre crosshair stays dead centre; nothing stretches or squashes.
- wrong: the border is visible on all four edges (letterboxed, not covered), or the pattern's
  circles/grid go oval (stretched).

**DOF separation** — with DOF on, `bokehScale` up, focus distance near the avatar:
- correct: the grid and rulers on the backdrop go soft while the avatar's face and clothing
  edges stay sharp.
- wrong: the avatar blurs too, or the backdrop stays sharp regardless of `bokehScale`.

## Observability

The page keeps a rolling forensic log (last 200 entries). Every config change records an entry
with viewport aspect, plane size and aspect, texture repeat/offset, resulting visible-image
percentage, and the FPS at that moment. **Export log to console** dumps it. A `FrameProbe`
samples real frame time twice a second so DOF's cost is observed rather than assumed.

## Investigation Trail

**Iteration 1 — split the question in two before building anything.** The spike asks one
question that is really two: *does the arithmetic hold* (a fact) and *does it look right* (a
feeling). Conventions say build for the feeling by default, but the arithmetic half is
cheap to verify exhaustively and expensive to debug through a browser, so it was extracted into
a pure `coverMath.ts` with no three.js import and driven headlessly.

That paid off immediately — the headless run covers 81 aspect-ratio pairs and five degenerate
inputs in under a second, which no amount of window-dragging would have covered.

**Iteration 2 — degenerate inputs were added after considering real failure modes.** A
zero-height container mid-layout and a not-yet-loaded texture both produce an aspect of `0`,
and the naive formula emits `NaN`. three.js does not warn on a `NaN` texture offset; it renders
an invisible texture. Guarded to fall back to "no crop", and the headless suite pins that.

**Iteration 3 — found a product problem, not a technical one.** See Results.

## Results

### Headless — the arithmetic: PASS

```
1. planeSizeForDistance                    4/4 ok (incl. portrait 9:16)
2. coverTransform invariants               81/81 aspect pairs ok
   (no-magnify / one-axis-cropped / centred / in-[0,1] / aspect-preserved)
3. Degenerate inputs emit no NaN           5/5 ok
PASS — 0 failing checks
```

The invariant set is the real content here: for every pair it checks that cover never magnifies
(repeat <= 1), crops exactly one axis, centres the crop, keeps sampling inside [0,1], and that
the sampled sub-rectangle's aspect equals the plane's — i.e. the image cannot come out stretched.

### Finding: cover crops far more of a customer's image than expected

Measured against a 16:9 plane:

| Customer image | Visible after cover |
|---|---|
| 16:9 landscape | 100.0% |
| 21:9 ultrawide | 55.6% |
| 1:1 square | 56.3% |
| **9:16 phone portrait** | **31.6%** |

A background shot on a phone in portrait — the single most likely thing a non-technical customer
uploads — loses **more than two thirds of its content**. This is not an arithmetic bug; `cover`
is behaving exactly as specified, and CSS does the same thing today. But today the CSS crop
happens in a DOM element the customer can see and adjust around, whereas an in-canvas backdrop
makes it the SDK's visible behaviour.

This is a **product** finding for Phase 16 planning, not a technical blocker: the phase likely
needs a `backgroundFit` choice (`cover` vs `contain` vs a focal point) rather than hard-coding
`cover`. Recorded as a candidate requirement below.

### Visual — cover: PASS

Human-verified under live window resize across the aspect set. The red border stayed flush to
two edges and cropped on the other two, the crosshair stayed centred, and nothing stretched.

### Visual — DOF: works, but ONLY with subject-tracking focus

First human report was "both the avatar and the background blur". Investigated in-browser rather
than taken at face value, and the investigation killed the obvious explanation before finding the
real one.

**Hypothesis 1 — MToon transparency defeats the depth buffer. REFUTED.**
A material with `transparent: true` does not write depth by default, so a transparent avatar
would be invisible to DOF. Plausible, and wrong. A live scene probe reported:

```
materials 103   transparent 6   depthWrite off 6
offenders: FaceBrow, EyeHighlight, FaceEyelash, FaceEyeline, EyeExtra, HairBack
```

Only 6 of 103 materials are transparent and every one is a face detail or the hair backing —
the body, clothing and face skin all write depth normally. Transparency cannot explain a
whole-avatar blur. (Noted for later: those 6 *will* be invisible to DOF, so eyelashes and brows
stay sharp when the rest of a face is deliberately defocused. Cosmetic, not blocking.)

**Hypothesis 2 — DOF is misconfigured. REFUTED.**
An opaque reference sphere was added at the avatar's own distance to isolate the material
variable. At `bokehScale=20`, `worldFocusDistance=3`, `worldFocusRange=0.6`, the backdrop
dissolved into recognisable bokeh discs while **both** the avatar and the sphere stayed sharp.
DOF separates subject from background correctly.

Also learned: at the default `bokehScale=6` the effect is nearly invisible at this scene scale.
A too-timid default reads as "DOF is broken" rather than "DOF is subtle".

**Actual cause — a fixed focus distance cannot survive a moving camera.**
`worldFocusDistance` is a constant; the camera is not. `OrbitControls`' scroll dollies the
camera, which changes how far the subject actually is while the focus plane stays where it was.
The subject then drifts out of the focus band and blurs *along with* the background — exactly
the reported symptom.

**Fix, implemented and in the page:** a `SubjectTracker` measures `camera.position.distanceTo(subject)`
every frame and feeds it to `worldFocusDistance`, with a `focus tracks subject` toggle and a live
`camera->subject | focusing at` readout so the two numbers can be watched diverging. State is
only pushed upstream when the distance moves more than 0.02, so the measurement does not cost
more than the effect it measures.

**This is a Phase 16 design requirement, not a spike detail.** Any DOF the SDK ships must derive
focus from the subject's real distance. Phase 17 (Camera Direction) makes this sharper still: it
introduces state-driven camera moves — a push-in on `speaking` — so the camera will be moving by
design, and a constant focus distance would break on every state change.

### Methodology note — frame timings from browser automation are worthless

The page's FPS readout showed `0 fps / 2570 ms` with DOF on and `1 fps / 1266 ms` with DOF off,
which looks like a catastrophic performance finding. It is an artifact. `document.visibilityState`
was `"hidden"` for the automated tab, and Chrome throttles `requestAnimationFrame` to roughly 1Hz
in hidden tabs — a follow-up rAF probe confirmed it by timing out after 45s on a 1-second loop.

Recorded because **spike 006 (outline-draw-cost) depends on frame timing** and must therefore be
measured by a human in a visible, focused tab. Any performance number gathered through browser
automation in this project should be discarded.

## Verdict

**VALIDATED, with one requirement attached.**

Cover equivalence holds — proven exhaustively headlessly and confirmed visually. DOF genuinely
separates subject from backdrop. The in-canvas backdrop path in CONTEXT D-06/D-07 is viable.

The attached requirement: **DOF focus must track the subject, not be a constant.** Shipping a
fixed focus distance would reproduce the exact failure first reported here.

## Candidate requirements for Phase 16

- **`backgroundFit` must be a choice, not hard-coded `cover`.** A 9:16 phone photo — the most
  likely customer upload — keeps only 31.6% of its content under `cover` against a 16:9 viewport.
  Needs at least `cover` / `contain`, and plausibly a focal point.
- **DOF focus must be derived from the subject's live camera distance.** A constant breaks on any
  camera move, and Phase 17 will add camera moves by design.
- **The DOF default must be strong enough to read.** `bokehScale=6` was indistinguishable from
  off at this scene scale.
- **Backdrop material must be `meshBasicMaterial` with `toneMapped={false}`** — it is an image,
  not a lit surface, and tone-mapping it twice fights Phase 15's curve.
- **Backdrop texture must use `ClampToEdgeWrapping`** or the cropped edge wraps and reappears.
- Known cosmetic limit: the 6 transparent face-detail materials do not write depth, so eyelashes,
  brows and eye highlights stay sharp when the rest of the face is defocused.
