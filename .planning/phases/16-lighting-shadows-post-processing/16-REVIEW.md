---
phase: 16-lighting-shadows-post-processing
reviewed: 2026-09-14T10:35:15Z
depth: deep
diff_base: 2de8f4c^
files_reviewed: 13
files_reviewed_list:
  - packages/react/src/utils/renderQuality.tsx
  - packages/react/src/utils/AvatarBackdrop.tsx
  - packages/react/src/utils/backgroundRim.ts
  - packages/react/src/utils/backdropCover.ts
  - packages/react/src/utils/deriveRimColor.ts
  - packages/react/src/utils/mtoonOutlines.ts
  - packages/react/src/VRMAvatar.tsx
  - packages/react/src/GLBAvatar.tsx
  - packages/react/src/index.ts
  - packages/react/package.json
  - apps/playground/src/app/lighting/page.tsx
  - apps/playground/src/app/lighting/fixtureTextures.ts
  - packages/react/src/utils/mtoonOutlines.assets.test.ts
findings:
  critical: 5
  warning: 8
  info: 6
  total: 19
status: issues_found
---

# Phase 16: Code Review Report

**Reviewed:** 2026-09-14T10:35:15Z
**Depth:** deep (traced into drei 10.7.6, @react-three/postprocessing 3.0.4, postprocessing 6.37.8, R3F 9.3.0 `applyProps`/`diffProps`, three-vrm 3.4.2 `_generateOutline`/`removeUnnecessaryVertices`/`deepDispose`, three r180 `mergeVertices`)
**Files Reviewed:** 13
**Status:** issues_found

## Summary

I read every file in scope and followed each new call into the library code it depends on. The pure math modules (`backdropCover.ts`, `deriveRimColor.ts`) are sound. The problems are in how the React and three.js layers are wired together:

- **`AvatarContactShadows` renders no shadow.** The component passes a `rotation` prop that replaces drei's own internal rotation. The shadow camera then points at the ground instead of up at the avatar. I checked this numerically.
- **`AvatarBackdrop` has two effect-lifecycle bugs:**
  - Its texture effect depends on `onError`. An inline callback (which the phase's own harness passes) makes the texture dispose and reload on every parent render.
  - An in-flight image load is never cancelled, so a slow earlier URL can replace a newer one.
- **The camera-relative backdrop fix is incomplete.** It copies the camera's *local* pose into the mesh's *local* transform. That is only correct when neither the backdrop's parent nor the camera is transformed.
- **Injected outlines add geometry groups that `mergeVertices` throws away.** If the mesh-flags effect runs again with `smoothShading` on, every injected mesh becomes invisible.

The other previously fixed bugs are only partly fixed:
- The DOF view-depth fix is correct maths, but each focus update rebuilds the whole effect chain.
- The light-rig counter-rotation assumes the model faces -Z, which is only true for VRM0. The harness's own control asset `3636451243928341470.vrm` is VRM1 (it has `VRMC_vrm`).
- The keyed-mesh remount fix is correct.
- The outline toggle now writes the drawn clone correctly, but injected clones never get into the MToon snapshot.

Changes for consumers who pass none of the new props, all documented and intentional:
- `AvatarPostFX` now adds a Cineon tone-mapping pass by default.
- `VRMAvatar`'s rig now sits in a counter-rotated group and uses new defaults (ambient 0.25, plus fill and rim lights).
- `outlines` defaults to `true`, and with `outlineWidth` unset it has no effect.

Nothing else changes for these consumers.

## Critical Issues

### CR-01: `AvatarContactShadows` overrides drei's internal rotation, so the shadow camera looks down and captures nothing

**File:** `packages/react/src/utils/renderQuality.tsx:501-511` (the `rotation={[-Math.PI / 2, 0, 0]}` at line 503)
**Issue:** drei's `ContactShadows` renders `<group "rotation-x"={Math.PI/2} {...props}>`, and its orthographic shadow camera lives inside that group. The props object has keys in the order `rotation-x`, `position`, `rotation`, and R3F's `applyProps` goes through them in that order (`for (const prop in props)`). So `rotation.x = π/2` is applied first and then `rotation.fromArray([-π/2, 0, 0])` replaces it.

I rebuilt the group in three r180 to check:
- drei's default gives a shadow-camera world direction of `[0, 1, 0]`, looking up at the avatar.
- `AvatarContactShadows` gives `[0, -1, 0]`, looking down.

With `far=2` the depth pass only sees the 2 units *below* the floor, so the shadow texture stays empty. The plane mesh still ends up flat (its own -π/2 cancels out), so nothing looks broken. You just get no contact shadow.

This was easy to miss: the `/lighting` harness mounts `ShadowFloor` at the same height, so the shadow people saw came from the key light.
**Fix:** Don't pass `rotation`. drei already lays the plane flat and points the camera up.
```tsx
<ContactShadows
  position={[0, y, 0]}
  opacity={opacity}
  blur={blur}
  scale={scale}
  resolution={clampedResolution}
  far={far}
  color={color}
  frames={frames}
/>
```
Then check it in the harness with `ShadowFloor` removed.

### CR-02: `onError` is a texture-effect dependency, so an inline callback disposes and reloads the backdrop on every parent render

**File:** `packages/react/src/utils/AvatarBackdrop.tsx:155` (deps `[url, onError]`), `packages/react/src/utils/backgroundRim.ts:184-189`; passed through at `VRMAvatar.tsx:755`, `GLBAvatar.tsx:304`, `VRMAvatar.tsx:435`, `GLBAvatar.tsx:170`
**Issue:** The usual way to pass a callback is inline: `onBackgroundError={(e) => ...}`. The harness does exactly that at `apps/playground/src/app/lighting/page.tsx:276`. Each time the parent component re-renders, a new function is created. The effect cleanup then runs:
1. The current texture is disposed and set to `null`.
2. The mesh unmounts, so the backdrop disappears.
3. A new `TextureLoader` load starts.

The harness page re-renders at least every 500 ms (`setRenderCalls`, `setFps`), so the backdrop blinks and re-uploads constantly. A consumer that keeps chat state (`useRealtime`) in the same component as `<Canvas>` hits the same thing on every message or status change.

`useBackgroundRimColor` has the same dependency, so it re-downloads and re-reads the image each time. For an invalid or CORS-blocked URL, `onError` fires again on every parent render (an error flood).
**Fix:** Keep the callback in a ref and take it out of the dependency arrays:
```tsx
const onErrorRef = useRef(onError);
useEffect(() => { onErrorRef.current = onError; }, [onError]);
// inside the load effect: onErrorRef.current?.(err)
}, [background.type === "image" ? background.url : null]);
```
Apply the same change in `useBackgroundRimColor`.

### CR-03: A backdrop image load that is still in flight is never cancelled, so the wrong image can show and textures leak

**File:** `packages/react/src/utils/AvatarBackdrop.tsx:118-154`
**Issue:** Unlike `useBackgroundRimColor` and `useLoadVRM`, this effect has no `cancelled` flag.

- **URL switch:** the user picks image A (slow) and then image B (fast). B loads and is shown. Then A's `onLoad` calls `setTexture(texA)`, so the backdrop shows A while the prop says B. `texB` is dropped without `dispose()`, and its GPU memory stays allocated.
- **Image to colour, or unmount, while loading:** the late `onLoad` still calls `setTexture`. If the component is unmounted, that texture is never disposed. If the background switched to colour, a stale texture sits in state until the next URL change.

The cleanup also calls `dispose()` inside a `setTexture` updater. Updaters must be pure; StrictMode runs them twice.
**Fix:**
```tsx
let cancelled = false;
loader.load(url, (tex) => {
  if (cancelled) { tex.dispose(); return; }
  ...
  setTexture(tex);
}, undefined, (error) => { if (!cancelled) onErrorRef.current?.(normalize(error)); });
return () => { cancelled = true; };
```
Dispose in a separate effect keyed on `texture`:
```tsx
useEffect(() => () => texture?.dispose(), [texture]);
```

### CR-04: The camera-relative backdrop fix writes the camera's local pose into the mesh's local transform, so a transformed parent or camera misplaces it

**File:** `packages/react/src/utils/AvatarBackdrop.tsx:210-217`; mounted at `VRMAvatar.tsx:755`, `GLBAvatar.tsx:304`
**Issue:** `mesh.position.copy(cam.position).addScaledVector(forward, distance)` and `mesh.quaternion.copy(cam.quaternion)` are only correct when both of these hold:
1. The backdrop's parent has an identity world transform.
2. The camera is a direct child of the scene.

The backdrop is only moved outside the avatar's *own* group. It still inherits every ancestor of `<VRMAvatar>`. Common avatar setups break this:
- `<group position={[0,-1,0]}><VRMAvatar background=.../></group>`
- drei `<Float>`, `<Center>`, `<PresentationControls>` (the last one rotates its children)
- A camera rig parented to a dolly group, which Phase 17 plans

The plane is sized to exactly fill the view frustum, so any offset or rotation shows transparent strips or a tilted card. `cam.getWorldDirection` is a world-space value mixed with the local `cam.position`, which also goes wrong when the camera is parented.
**Fix:** Work in world space and convert into the parent's space:
```tsx
useFrame(({ camera: cam }) => {
  const mesh = meshRef.current; if (!mesh) return;
  cam.getWorldPosition(_p); cam.getWorldQuaternion(_q); cam.getWorldDirection(_f);
  _p.addScaledVector(_f, distance);
  if (mesh.parent) {
    mesh.parent.updateWorldMatrix(true, false);
    _m.copy(mesh.parent.matrixWorld).invert();
    mesh.position.copy(_p).applyMatrix4(_m);
    mesh.quaternion.copy(mesh.parent.getWorldQuaternion(_pq).invert().multiply(_q));
  }
});
```
Alternatively, `createPortal` the mesh into the root `scene`. That removes ancestor transforms; the camera still needs world-space reads. Consider a small overscan (for example ×1.02) on the plane size.

### CR-05: Injected outline groups are dropped when the mesh-flags effect runs again with `smoothShading`, making every outlined mesh invisible

**File:** `packages/react/src/utils/mtoonOutlines.ts:92-94`, `packages/react/src/utils/renderQuality.tsx:389-397`, `packages/react/src/VRMAvatar.tsx:589-618, 666-669`
**Issue:** `injectOutline` sets `mesh.material = [surface, outline]` and adds two groups to the geometry. `applySmoothShading` replaces `obj.geometry` with the result of `mergeVertices`, and in three r180 `mergeVertices` does not copy `groups`.

When a mesh's material is an array and its geometry has no groups, `WebGLRenderer.projectObject` loops over zero groups and draws nothing. The mesh disappears.

The mesh-flags effect depends on `[scene, currentVrm, setVrm, gl, castShadow, receiveShadow, anisotropy, smoothShading]`. The outline effect depends only on `[scene, outlines, outlineWidth]`, so it does not re-inject afterwards. Scenarios:
- `outlineWidth={0.002}` is set, then `smoothShading` is switched to `true`.
- `smoothShading` and `outlineWidth` are both set, and then `castShadow` or `anisotropy` changes.

Either way, every opaque MToon mesh (the whole body) disappears.

Before this phase, only three-vrm's authored outlines were exposed to this (for example `262410318834873893.vrm`). Injection extends it to every opaque surface. Each rerun also leaks the replaced geometry, because it is never disposed.
**Fix:** In `applySmoothShading`, copy groups onto the merged geometry and dispose the old one:
```ts
const merged = mergeVertices(obj.geometry, tolerance);
for (const g of obj.geometry.groups) merged.addGroup(g.start, g.count, g.materialIndex);
obj.geometry.dispose();
```
Also keep the mesh-flags effect from redoing geometry work when only the flags change: split `applySmoothShading` into its own effect keyed on `[scene, smoothShading]`, and add a once-per-scene guard.

## Warnings

### WR-01: Each DOF focus update rebuilds `DepthOfFieldEffect` and every `EffectPass` (repeated shader recompiles while the camera moves)

**File:** `packages/react/src/utils/renderQuality.tsx:672-699, 747, 764-773, 827`
**Issue:** @react-three/postprocessing 3.0.4's `DepthOfField` creates `new DepthOfFieldEffect(...)` inside `useMemo`, and `worldFocusDistance` is one of the memo dependencies. Every time `setTrackedDistance` fires (whenever depth changes by more than 0.02), `AvatarPostFX` re-renders. That causes:
1. A new DOF effect is constructed and the old one disposed.
2. The `effects` array gets a new identity, so `EffectComposer`'s layout effect (which depends on `children`) removes every pass and re-creates the `EffectPass` objects, recompiling the merged shader.

While orbiting or dollying, that is a steady run of synchronous shader compiles. The comment "a state write every frame would cost more than the effect" is backwards: each write rebuilds the whole chain.

The tracker also reads `camera.position` (local space), so a parented camera gives a wrong depth. If the subject is behind the camera, the depth is negative.

Don't switch to the effect's built-in `target` instead: postprocessing's `calculateFocusDistance` uses straight-line `distanceTo`, which is the very bug that was fixed.
**Fix:** Drop the React state and write the uniform directly:
```tsx
const dofRef = useRef<DepthOfFieldEffect>(null);
useFrame(({ camera }) => {
  camera.getWorldPosition(_cam); camera.getWorldDirection(_fwd);
  const d = Math.max(camera.near, _v.set(...subject).sub(_cam).dot(_fwd));
  dofRef.current?.cocMaterial && (dofRef.current.cocMaterial.worldFocusDistance = d);
});
<DepthOfField ref={dofRef} worldFocusDistance={3} ... />
```

### WR-02: A fixed camera-relative backdrop distance hides the avatar once the camera is farther away than that

**File:** `packages/react/src/utils/AvatarBackdrop.tsx:94, 215, 232, 247`
**Issue:** The plane always sits at `distance` (default 6) in front of the camera, with `depthWrite` and depth testing on. If the camera is more than 6 units from the avatar, the plane is drawn in front of the avatar and hides it completely. Examples: the harness's `OrbitControls` zoomed out, a wide establishing shot, or a larger scene scale. Nothing warns about this.
**Fix:** Make the plane's distance at least the subject's depth plus a margin: `max(distance, subjectDepth + 1)`, using the same subject point as DOF. Otherwise, clamp it and report through `onError`. Also document that `distance` must exceed the camera's distance to the subject.

### WR-03: `toneMapped={false}` on the backdrop does nothing once `AvatarPostFX` is mounted

**File:** `packages/react/src/utils/AvatarBackdrop.tsx:229-248`, `packages/react/src/utils/renderQuality.tsx:774-819`
**Issue:** `EffectComposer` renders the scene into a HalfFloat target, where three.js applies no tone mapping to any material. The trailing `ToneMapping` pass added in 16-03 then tone-maps the whole frame, backdrop included. `Bloom` (threshold 0.3) also makes bright wallpapers and sky images glow.

Result: a background of `{type:"color", value:"#808080"}` renders as a different grey with `<AvatarPostFX />` than without it, and bright images are darkened and bloomed. This breaks the "backdrop matches its source" promise in the component's comments.
**Fix:** Pick one and document it:
- Render the backdrop outside the composer's tone-mapping pass, for example by pre-applying the inverse curve.
- Stop claiming the backdrop is exempt, and state in the docs that post-FX grades the background.

At minimum, add a `luminanceThreshold` note or a selective bloom so the backdrop doesn't bloom.

### WR-04: The derived rim colour keeps the background's brightness, so dark backgrounds turn the rim light off

**File:** `packages/react/src/utils/backgroundRim.ts:98-100, 154-157`, `packages/react/src/utils/renderQuality.tsx:351`
**Issue:** `mergeRimColor` puts the derived colour straight into `rim.color`, and three.js multiplies intensity by that colour. A `{type:"color", value:"#000000"}` background gives a black rim, so the rim contributes nothing. A night-scene image gives a near-black rim. `"#808080"` halves the rim. The rig was tuned with rim `#bcd4ff` at 1.6, which assumes a bright colour. This recreates the grey or absent rim problem the feature was meant to fix.
**Fix:** Keep only hue and saturation and set the brightness to 1 before merging:
```ts
const c = new THREE.Color(derived); const hsl = c.getHSL({h:0,s:0,l:0});
c.setHSL(hsl.h, hsl.s, Math.max(hsl.l, 0.75));
```
Alternatively, scale by `1 / max(r,g,b)`. For an achromatic result, fall back to the default rim.

### WR-05: Injected outline clones are missing from the MToon snapshot, so `materialPreset` toggles compound the repair on them

**File:** `packages/react/src/utils/mtoonOutlines.ts:85`, `packages/react/src/VRMAvatar.tsx:626-646`, `packages/react/src/utils/mtoonRepair.ts:291-302, 414`
**Issue:** The snapshot is taken once per `scene`, before any injection. `surface.clone()` creates a new uuid, so `restoreMToon` skips every injected clone (`if (!s) return`). Also, by default a clone is made from an already-repaired surface.

Sequence: default `"repair"`, then `outlineWidth` is set (the clone copies repaired values), then `"off"` (the surface is restored but the clone keeps repaired values), then `"repair"` (the clone is not restored, and R1's `parametricRimColorFactor.multiplyScalar(...)` runs on it again).

The clone's rim factor shrinks further on every cycle, which is the compounding the snapshot was built to prevent. It is visible: the MToon outline pass computes `outlineColorFactor * mix(1, col, outlineLightingMixFactor)` from the shaded colour, rim included.
**Fix:** When `injectOutline` creates a clone, add a snapshot entry for it built from the surface's *snapshot* values. The simplest way: `VRMAvatar` passes `mtoonSnapshotRef.current` into `setMToonOutlines`, which copies `snap.get(surface.uuid)` to `outline.uuid`. Alternatively, have `restoreMToon` resolve a clone's entry through its surface.

### WR-06: The light-rig counter-rotation assumes the model faces -Z, which is only true for VRM0; VRM1 models get the key light from behind

**File:** `packages/react/src/VRMAvatar.tsx:406, 757-764`
**Issue:** The fixed `rotation={[0, Math.PI, 0]}` cancels the default avatar rotation only when the model faces local -Z, which is VRM0's convention. The SDK never calls `VRMUtils.rotateVRM0`, so VRM1 models (`VRMC_vrm`, +Z forward) keep their native orientation. The harness's control asset `3636451243928341470.vrm` is VRM1; `male.vrm` is VRM0.

A consumer who passes `rotation={[0,0,0]}` to turn a VRM1 model toward the camera ends up with the rig rotated π in world space: the key light at `[-4,4,-1]` (behind the subject) and the rim at `[1.5,3,4]` (on the face). That is the same symptom 16-02 fixed, now on the other asset family.

Because the rig inherits the consumer's `rotation`, any yaw (for example a three-quarter pose) also swings the key light with the model.
**Fix:** Pick the counter-rotation from the loaded VRM's version (`currentVrm?.meta?.metaVersion === "0" ? Math.PI : 0`), combined with the consumer's rotation. Alternatively, mount the rig outside the rotated group (inheriting only `position`/`scale`) so it stays camera-side whatever the model's facing. Re-run the 16-06 measurement for `3636451243928341470.vrm`.

### WR-07: `useBackgroundRimColor` keeps a stale colour on some failures, and every failure is loaded and reported twice

**File:** `packages/react/src/utils/backgroundRim.ts:107-111, 123-129, 142-146`
**Issue:** The rejected-URL, oversized-image and no-2D-context paths return without calling `setDerivedColor(undefined)`. Switching from a valid image to an invalid or oversized one leaves the rim tinted by the *previous* background, while the backdrop renders nothing.

`AvatarBackdrop` and this hook also validate and load the same URL independently. Each failure (bad scheme, CORS, 404, too large) calls `onBackgroundError` twice with different messages, and the image is downloaded twice.
**Fix:** Reset `derivedColor` on every failure path. Load once: either derive from the backdrop's loaded `texture.image`, lifting the load into a shared hook used by both, or share one validator and one error emitter.

### WR-08: The backdrop layout ignores FOV and zoom changes, and silently becomes 1×1 with non-perspective cameras

**File:** `packages/react/src/utils/AvatarBackdrop.tsx:158-204`
**Issue:** The layout effect runs only when `camera`, `size`, `distance`, `fit`, `texture` or the colour change. A runtime `camera.fov` or `camera.zoom` change (an animated zoom, or Phase 17 camera work) leaves the plane the wrong size, showing edges or over-cropping.

`camera as THREE.PerspectiveCamera` is an unchecked cast. With an `OrthographicCamera`, `cam.fov` is `undefined`, the degenerate-input guard returns a 1×1 plane, and nothing reports an error.
**Fix:** Do the sizing in `useFrame` (it is cheap arithmetic), or compare `fov`/`zoom`/`aspect` against a ref each frame. For orthographic cameras, report through `onError` or compute the plane from `top-bottom`/`zoom`.

## Info

### IN-01: The URL allowlist is duplicated even though the comment says it is reused

**File:** `packages/react/src/utils/backgroundRim.ts:25-53`, `packages/react/src/utils/AvatarBackdrop.tsx:49-81`
**Issue:** The comment says "Re-use the validateUrl helper from AvatarBackdrop", but the code is a copy-paste with different return types. The two copies will drift, which matters for a security control. The `data:` check runs a case-sensitive regex on the raw string while the protocol comes from `URL`, so the two parts can disagree (for example `DATA:image/png` is wrongly rejected). This fails closed, so it isn't a hole.
**Fix:** Export one `validateBackgroundUrl` from a shared module and test it.

### IN-02: Error messages include the full URL

**File:** `packages/react/src/utils/AvatarBackdrop.tsx:61`, `packages/react/src/utils/backgroundRim.ts:108, 172`
**Issue:** Signed CDN URLs (with tokens in the query string) and multi-megabyte `data:` URLs end up in `Error.message`, and from there in the consumer's telemetry and console.
**Fix:** Log only `origin + pathname`, cut to a short length, and never include `data:` payloads.

### IN-03: `DEFAULT_LIGHT_RIG` is exported as a mutable object

**File:** `packages/react/src/utils/renderQuality.tsx:228-234`
**Issue:** Any consumer mutation (for example `DEFAULT_LIGHT_RIG.key.intensity = 3`) changes the defaults for every avatar.
**Fix:** Deep-freeze it (`Object.freeze` on the object, each spec and each position array), or type it `as const` and export a frozen copy.

### IN-04: Harness bugs in the `/lighting` page

**File:** `apps/playground/src/app/lighting/page.tsx:161-166, 208, 276, 289`
**Issue:** These are dev-only, but they are real:
- Typing `null` into the lighting JSON box parses to `null`, then `Object.keys(null)` at line 166 throws and crashes the page.
- The inline `onBackgroundError` (line 276) triggers CR-02, so the harness's own backdrop reloads every 500 ms. Backdrop screenshots and verification were taken under that condition.
- The inline `onStats` (line 289) restarts the stats interval on every render.
- `navigator.clipboard.writeText` has no rejection handler.
**Fix:** Guard with `typeof extra === "object" && extra !== null && !Array.isArray(extra)`. Wrap both callbacks in `useCallback`. Add a `.catch` on the clipboard call.

### IN-05: Dead guards and tautological error normalisation

**File:** `packages/react/src/utils/backgroundRim.ts:86-88, 127, 144, 173`, `packages/react/src/utils/AvatarBackdrop.tsx:127`
**Issue:** `typeof document === "undefined"` inside `useEffect` never runs on the server, because effects don't run during SSR. `err instanceof Error ? err : new Error(String(err))` on a freshly built `new Error(...)` is always true. Both add noise and suggest protection that isn't needed.
**Fix:** Remove them. Keep normalisation only where a value comes from `catch` or a loader callback.

### IN-06: `postprocessing` added as a direct dependency just for an enum

**File:** `packages/react/package.json:56`, `packages/react/src/utils/renderQuality.tsx:17`
**Issue:** The import is only `ToneMappingMode`, a numeric enum. A direct `^6.37.8` dependency next to @react-three/postprocessing's own `postprocessing` can put two copies in consumer lockfiles. That is harmless for an enum, but a trap if runtime classes are imported from it later.
**Fix:** Declare it as a peer dependency matching @react-three/postprocessing's range, or use the `ToneMappingMode` exposed through @react-three/postprocessing's `ToneMapping` props.

---

_Reviewed: 2026-09-14T10:35:15Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
