/**
 * animationConfig.ts — pure helpers for the expanded AnimationConfig format.
 *
 * This is an internal helper module. `AnimationConfig` is re-exported from
 * `VRMAvatar.tsx` and surfaced publicly via `index.ts`.
 *
 * The expanded format allows each key to map to either a single URL (string)
 * or an array of URLs (string[]). Arrays are flattened to individual entries
 * named `${key}_0`, `${key}_1`, …, so STATUS_CLIP_PATTERNS still match on
 * the key prefix (e.g. "idle_0" matches /idle|ready|rest/i).
 */

/**
 * Animation configuration mapping clip names to file URLs.
 *
 * Each key is matched against `STATUS_CLIP_PATTERNS` in the animation engine
 * to auto-resolve which clip plays for a given chatStatus. Use string arrays
 * to supply multiple clips for the same status — they cycle automatically
 * when `animationCycleOrder` is set.
 *
 * @example
 * ```tsx
 * const animations: AnimationConfig = {
 *   idle: '/animations/idle.fbx',               // single idle clip
 *   talking: [                                   // multiple speaking clips
 *     '/animations/talk1.fbx',
 *     '/animations/talk2.fbx',
 *     '/animations/talk3.fbx',
 *   ],
 *   thinking: '/animations/thinking.fbx',
 *   listening: ['/animations/listen1.fbx', '/animations/listen2.fbx'],
 * };
 * ```
 */
export interface AnimationConfig {
  [name: string]: string | string[];
}

/**
 * Flattens an `AnimationConfig` into an ordered list of `[clipName, url]`
 * pairs suitable for the hook-based loader in VRMAvatar.
 *
 * - A plain string entry `{ idle: "/a.fbx" }` becomes `[["idle", "/a.fbx"]]`.
 * - An array entry `{ idle: ["/a.fbx", "/b.fbx"] }` becomes
 *   `[["idle_0", "/a.fbx"], ["idle_1", "/b.fbx"]]`.
 * - Empty arrays are skipped (no entries emitted).
 * - Insertion order of the config object is preserved.
 *
 * A colliding explicit key (e.g. both `idle_0: "..."` and `idle: [...]`)
 * resolves to whichever entry comes last, matching Object/Record overwrite
 * semantics downstream in `useAnimationFiles`.
 */
export function expandAnimationConfig(
  config: AnimationConfig | undefined,
): Array<[name: string, url: string]> {
  if (!config) return [];
  const result: Array<[string, string]> = [];
  for (const [key, value] of Object.entries(config)) {
    if (Array.isArray(value)) {
      value.forEach((url, i) => {
        result.push([`${key}_${i}`, url]);
      });
    } else {
      result.push([key, value]);
    }
  }
  return result;
}
