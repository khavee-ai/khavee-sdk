# VRMAvatar Shared-Scene Multi-Instance Bug - Research

**Researched:** 2026-07-08
**Domain:** three.js / @pixiv/three-vrm 3.4.2 / @react-three/drei 10.7.6 / @react-three/fiber
**Confidence:** HIGH (all claims verified against installed source in `node_modules`)

## Summary

The diagnosis in the task brief is **correct on both counts**. `useGLTF` caches the parsed
GLTF (including `userData.vrm`) in a module-global cache keyed by `[GLTFLoader, url]`, shared
across every `<Canvas>` on the page. Two `<VRMAvatar src="same-url">` instances receive the
**same** `scene` (`THREE.Group`) and the **same** `VRM` object references. Mounting the same
`THREE.Object3D` via `<primitive object={scene} />` into two React trees reparents it to whichever
mounts second — leaving the first Canvas blank. This matches the observed symptom exactly.

There is **no built-in whole-VRM clone** in three-vrm 3.4.2. The correct minimal fix is to
**bypass `useGLTF` and perform an independent per-instance `GLTFLoader.parse()` with `VRMLoaderPlugin`
registered**, producing a genuinely independent `scene`+`VRM` pair per component. A per-URL raw
`ArrayBuffer` cache (or the browser HTTP cache) avoids re-downloading; the parse itself must run
per instance — that is precisely what buys independence.

**Primary recommendation:** Replace the `useGLTF(...)` call in `VRMAvatar.tsx` (lines 199-206)
with a custom `useVRM(src)` hook that fetches the GLB once per URL (cached ArrayBuffer) and calls
`loader.parse()` per component instance, storing the resulting `{ scene, vrm }` in local component
state. This is correct for N instances and adds no regression for the single-instance case beyond
one unavoidable parse (which already happens today).

## Diagnosis Verification

### 1(a) — `useGLTF` cache is global-by-URL, shared across Canvases — CONFIRMED

- `node_modules/@react-three/drei/core/Gltf.js`: `useGLTF = (path, ...) => useLoader(GLTFLoader, path, extensions(...))`. [VERIFIED: source]
- `node_modules/@react-three/fiber/dist/events-e3cb66e2.esm.js:1207-1215`: `useLoader` calls
  `suspend(loadingFn(...), [loader, ...keys], { equal: is.equ })` where `keys = [url]`. The cache
  key is `[GLTFLoader, url]`. [VERIFIED: source]
- `suspend` is from `suspend-react`, a **module-global** cache — not Canvas- or tree-scoped. The
  key notably does **not** include the `extendLoader`/VRM-plugin callback, so the first parse wins
  and populates `userData.vrm` for all callers. [VERIFIED: source]
- Corroborating signal: drei's own `Gltf` component wraps the scene in `<Clone>` rather than
  mounting `<primitive object={scene}>` directly (`Gltf.js`), precisely because the raw cached
  scene must not be mounted more than once. [VERIFIED: source]

### 1(b) — `VRM` holds direct refs into the original parsed skeleton; `scene.clone()` is insufficient — CONFIRMED

- `VRMCore` (`@pixiv/three-vrm-core@3.4.2/types/VRMCore.d.ts`) exposes `readonly scene`, `humanoid`,
  `expressionManager`, `firstPerson`, `lookAt`; `VRM` (three-vrm/types/VRM.d.ts) adds
  `springBoneManager`, `nodeConstraintManager`. Every manager is constructed from, and holds direct
  references to, the **actual `THREE.Object3D` bone nodes of the parsed scene**. [VERIFIED: source]
- A plain `scene.clone()` produces a new `Group` with new bone objects, but the existing `VRM`
  object's `humanoid`/`expressionManager`/`lookAt`/`springBoneManager` would still drive the
  **original** (shared) bones — so expressions and pose control would move the wrong model.
  There is no `VRM.setScene()` / rebind API to fix this. [VERIFIED: absence in API surface]

## Fix Approaches — Ruled In / Out

### (a) Built-in `VRM.clone()` / whole-VRM deep clone — RULED OUT (does not exist)

- Neither `VRM` nor `VRMCore` has a `clone()` method (`VRM.d.ts`, `VRMCore.d.ts`). [VERIFIED: source]
- `VRMUtils` (three-vrm/lib/three-vrm.module.js:6615-6621) exposes only `combineMorphs`,
  `combineSkeletons`, `deepDispose`, `removeUnnecessaryJoints`, `removeUnnecessaryVertices`,
  `rotateVRM0` — **no clone helper**. [VERIFIED: source]
- The sub-managers *do* have `.clone()` (`VRMHumanoid`, `VRMExpressionManager`, `VRMLookAt`,
  `VRMFirstPerson`), but they clone against the **original bones**, not new ones. Proof:
  `VRMHumanoid.copy()` (three-vrm-core.module.js:1928-1933) does `this._rawHumanBones = new
  VRMRig(source.humanBones)` — `source.humanBones` returns the original bone-node map. So
  `humanoid.clone()` yields a humanoid still pointing at the shared skeleton. Useless for
  producing an independent model. [VERIFIED: source]

### (b) `three/examples/jsm/utils/SkeletonUtils.clone(scene)` alone — RULED OUT (insufficient on its own)

- `SkeletonUtils.clone` (available at `node_modules/three/examples/jsm/utils/SkeletonUtils.js`;
  also used internally by drei's `<Clone>` for skinned meshes — `Clone.js:63` `if (isSkinned)
  return SkeletonUtils.clone(object)`) correctly deep-clones the `Object3D` graph and rebinds
  skinned meshes to the **cloned** bones. [VERIFIED: source]
- BUT it only touches the `THREE.Object3D` graph. It does **not** know about, and does not update,
  the sidecar `VRM` object's `humanoid`/`expressionManager`/`lookAt`/`springBoneManager` pointers —
  those still reference the OLD bones. You would have to manually re-link every manager to the
  cloned bones (by name traversal), which is fragile and effectively reimplements what a second
  parse gives you for free. This is also why drei's `<Clone>` / `<Gltf>` does **not** solve the
  VRM case — it clones the scene but leaves the `VRM` object stale. [VERIFIED: reasoning from source]

### (c) Independent per-instance `GLTFLoader.parse()` with `VRMLoaderPlugin` — RULED IN (recommended)

- `GLTFLoader.parse(arrayBuffer, path, onLoad, onError)` (three-stdlib GLTFLoader) runs a full,
  independent parse. With `loader.register(p => new VRMLoaderPlugin(p))` registered on that loader
  instance, the resulting `gltf.userData.vrm` is a **genuinely independent** `VRM` whose scene and
  managers all reference the same, fresh set of bone objects. This is the only approach that yields
  a fully independent model (own mixer, own expressions, own pose) with no manual re-linking.
- **Cannot be done inside `useGLTF`/`useLoader`'s cache**: that cache stores the *parsed result*
  keyed by URL, not the raw buffer — there is no supported way to retrieve the source `ArrayBuffer`
  from it and re-parse. You must bypass `useGLTF` and own the load in the component (e.g. a
  `useEffect`/hook with its own `GLTFLoader` instance, result held in local `useState`).
- **Avoiding a network re-fetch**: keep a small module-level `Map<url, Promise<ArrayBuffer>>` so the
  `.glb` is fetched once per URL and every instance parses from the shared buffer. Even without that,
  the browser HTTP cache serves the second fetch from disk/memory. The *parse* is per-instance and
  unavoidable — it is exactly what produces independence.

### (d) Established ecosystem pattern — CONFIRMS (c)

- three-vrm has no official clone helper (verified above); the community-standard answer for
  "multiple instances of the same VRM" is to parse the model again (or SkeletonUtils.clone + manual
  manager rebuild — the harder path). [ASSUMED: ecosystem knowledge — the source-verified absence
  of any clone API in 3.4.2 is what forces this.]
- drei explicitly steers reuse through `<Clone>` (SkeletonUtils under the hood), which is correct
  for plain skinned GLTFs but — as shown in (b) — does not carry the VRM sidecar. So drei's built-in
  reuse mechanism does not cover this case. [VERIFIED: source]

## Recommended Fix (for the planner — do not implement here)

Introduce a `useVRM(src)` hook in `@khaveeai/react` and use it in `VRMAvatar.tsx` in place of the
`useGLTF(...)` call at lines 199-206:

1. Module-level `Map<string, Promise<ArrayBuffer>>` — fetch each URL's GLB at most once.
2. Per component instance (`useEffect`/`useState`, keyed by `src`): create a fresh `GLTFLoader`,
   `loader.register(p => new VRMLoaderPlugin(p))`, `await loader.parseAsync(buffer, "")`, read
   `gltf.userData.vrm`, store `{ scene: gltf.scene, vrm }` in local state.
3. Keep the existing downstream logic (`mixerRef`, `VRMUtils.removeUnnecessaryVertices/combineSkeletons/
   combineMorphs`, `<primitive object={scene}>`) unchanged — it now operates on a per-instance scene.
4. Dispose per-instance on unmount (`VRMUtils.deepDispose(scene)`) to avoid GPU leaks, since each
   instance now owns its own geometry/materials/textures (previously shared).

### Blast-radius / single-instance regression check

- **Single-instance case (the common path — `src/app/openai/page.tsx`, realtime experience):**
  Behaviorally identical. Exactly one parse occurs — the same one that happens today via `useGLTF`.
  No extra network fetch (buffer fetched once). No visual/perf change.
- **Costs introduced:** (1) Loss of drei's cross-mount parsed-result cache — if the *same* URL is
  mounted, unmounted, and remounted, it re-parses instead of hitting the cache. For a live-preview
  widget this is negligible and arguably more correct. (2) Each instance now owns its own
  geometry/material/texture GPU resources instead of sharing — higher memory for N simultaneous
  instances, but this is **required** for independence and is the whole point of the fix.
- **Memory note:** because resources are no longer shared, the unmount `deepDispose` step (item 4)
  is important — without it, per-instance textures/geometry would leak. This is new cleanup the
  planner must include.

## Sources

### Primary (HIGH — verified source in node_modules)
- `@react-three/drei/core/Gltf.js` — `useGLTF` = `useLoader(GLTFLoader, ...)`; `<Gltf>` uses `<Clone>`
- `@react-three/drei/core/Clone.js:63` — `<Clone>` uses `SkeletonUtils.clone` for skinned meshes
- `@react-three/fiber/dist/events-e3cb66e2.esm.js:1207-1231` — `useLoader` global `suspend` cache keyed `[loader, url]`
- `@pixiv/three-vrm@3.4.2/types/VRM.d.ts`, `.../three-vrm-core@3.4.2/types/VRMCore.d.ts` — VRM holds direct scene/manager refs; no `clone()`
- `.../three-vrm-core@3.4.2/lib/three-vrm-core.module.js:1928-1939` — `VRMHumanoid.copy/clone` re-reference original bones
- `@pixiv/three-vrm@3.4.2/lib/three-vrm.module.js:6615-6621` — `VRMUtils` has no clone helper
- `packages/react/src/VRMAvatar.tsx:199-206, 273-294, 347-362, 440` — current usage / mount site
- `three/examples/jsm/utils/SkeletonUtils.js` — present, clones Object3D graph only

### Tertiary (LOW — ecosystem knowledge)
- Community pattern "re-parse for independent VRM instances" — [ASSUMED], but forced by the
  source-verified absence of any whole-VRM clone API in 3.4.2.

## Metadata
- Standard stack / diagnosis: HIGH — every claim traced to installed source.
- Fix recommendation: HIGH — (a)/(b) ruled out from source; (c) is the only source-consistent path.
- Ecosystem-pattern framing (d): MEDIUM — API absence is verified; "everyone re-parses" is training knowledge.
- Valid until: stable while `@pixiv/three-vrm@3.x`, `@react-three/drei@10.x`, `@react-three/fiber` versions are unchanged.
