# Spike Conventions

Patterns and stack choices established across spike sessions. New spikes follow these unless the
question requires otherwise.

## Stack

- **Headless / fact questions:** Node ESM (`.mjs`), or `.ts` run with
  `node --experimental-strip-types` when the spike needs to import real TypeScript source.
  No bundler, no test runner, no jsdom.
- **Visual / "how does it feel" questions:** a real page in `apps/playground/src/app/<spike-name>/`.
  The playground already has `three`, `@pixiv/three-vrm`, `@react-three/fiber` and drei, so a
  spike page needs no new dependencies.

## Structure

- Artifacts live in `.planning/spikes/NNN-name/` — `README.md`, scripts, and result JSON.
- Renderable spike code lives under `apps/playground/src/app/<name>/` (it cannot render from
  `.planning/`), with a header comment naming the spike and stating it is throwaway.
- A spike that extends an earlier spike's page **shares that page** rather than forking it, so
  the earlier variable can be held constant while the new one moves. Both READMEs say so.

## Patterns

- **Resolving workspace deps from `.planning/spikes/`:** pnpm's strict layout means the repo root
  exposes nothing. Symlink a package's `node_modules` into the spike directory and `.gitignore`
  it:
  ```bash
  ln -sfn ../../../packages/react/node_modules .planning/spikes/NNN-name/node_modules
  ```
- **Loading a full VRM headless (three-vrm 3.4.x):** `GLTFLoader.parse()` dies on
  `self is not defined` because Node has no image pipeline, and three-vrm's MToon params helper
  then dies on `setTextureColorSpace(undefined)`. Register a plugin ahead of `VRMLoaderPlugin`
  that returns image-less `new THREE.Texture()` objects from `loadTexture`, `loadTextureImage`
  and `assignTexture`, and set `globalThis.self ??= globalThis`. This runs the **full**
  `VRMLoaderPlugin`, MToon materials included — do not fall back to `VRMCoreLoaderPlugin`, which
  skips materials entirely. Caveat: texture-driven material values are invisible under this stub.
- **A/B toggles must be non-cumulative.** Snapshot authored state once, before the first write,
  and restore from that snapshot — never from the previous frame's already-modified state.
- **Measure when two properties move together.** If the variable under test changes more than one
  perceptual dimension at once (e.g. tone mapping changes brightness *and* saturation), build a
  numeric readout and sweep it automatically. Spike 003 found the human's eye agreed with the
  metric on which curves were bad, which is what made the metric trustworthy on the rest.
- **Record refuted predictions in the README, not just confirmed ones.** Spikes 001 and 003 each
  killed a plausible assumption; those are the highest-value lines in either document.

## Tools & Libraries

- `three@0.180.0`, `@pixiv/three-vrm@3.4.2` — versions the above workarounds are verified against.
- Node v23.5.0 — `--experimental-strip-types` works for erasable TS syntax (interfaces, type
  aliases, `import type`). Enums and namespaces are not supported.
