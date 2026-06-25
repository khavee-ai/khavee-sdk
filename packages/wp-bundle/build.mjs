// packages/wp-bundle/build.mjs
// Source: esbuild official docs (esbuild.github.io/api/#format) — IIFE format
// wraps output in a function expression so bundle-local variables never leak
// into global scope; omitting --global-name means NOTHING is assigned to
// window at all (D-10's "never assigns window.React/window.ReactDOM").
//
// Phase 9 (STUDIO-02): refactored to a buildOptions(entry, outfile) factory
// that emits two entries: the existing VIEW bundle (khaveeai-bundle.js) and
// the new PREVIEW bundle (khaveeai-preview.js). A build-time grep assertion
// (T-09-01-05) fails the build if the preview output accidentally contains
// realtime/mic/token code — structural entry-point isolation is the primary
// safety mechanism; this grep is belt-and-braces.
import * as esbuild from "esbuild";
import { readFileSync } from "node:fs";

const watch = process.argv.includes("--watch");

/**
 * Shared esbuild options factory. Both entries use identical settings
 * (IIFE, no external array, minified) so the live bundle and preview bundle
 * are built with the same isolation properties (D-10).
 *
 * @param {string} entry  - Entry point relative to this file (e.g. "src/index.ts").
 * @param {string} outfile - Output path relative to this file.
 * @returns {import("esbuild").BuildOptions}
 */
const buildOptions = (entry, outfile) => ({
  entryPoints: [entry],
  bundle: true,
  format: "iife", // no globalName set: zero globals exposed
  outfile,
  minify: true,
  target: ["es2017"], // matches root tsconfig.json's ES2017 target
  loader: { ".css": "css" },
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"' },
  // Deliberately NO `external` array — D-10 full isolation means react,
  // react-dom, three, @pixiv/three-vrm all get bundled INLINE, not externalized.
});

const VIEW_ENTRY   = "src/index.ts";
const VIEW_OUT     = "../../wordpress-plugin/build/khaveeai-bundle.js";
const PREVIEW_ENTRY = "src/preview.ts";
const PREVIEW_OUT  = "../../wordpress-plugin/build/khaveeai-preview.js";

if (watch) {
  // Build a context for each entry so esbuild watches both in the same process.
  const viewCtx    = await esbuild.context(buildOptions(VIEW_ENTRY,    VIEW_OUT));
  const previewCtx = await esbuild.context(buildOptions(PREVIEW_ENTRY, PREVIEW_OUT));
  await viewCtx.watch();
  await previewCtx.watch();
  console.log("watching for changes...");
} else {
  await esbuild.build(buildOptions(VIEW_ENTRY,    VIEW_OUT));
  await esbuild.build(buildOptions(PREVIEW_ENTRY, PREVIEW_OUT));

  // STUDIO-02 BUILD-TIME SAFETY ASSERTION (T-09-01-05 belt-and-braces).
  // The structural guarantee (preview entry never imports openai-realtime) is
  // the primary defence. This grep is a secondary check that catches accidental
  // transitive imports that the bundler resolves but that break the safety model.
  const previewOut = readFileSync(PREVIEW_OUT, "utf8");
  const FORBIDDEN = [/RealtimeProvider/, /getUserMedia/, /ephemeral/];
  for (const re of FORBIDDEN) {
    if (re.test(previewOut)) {
      console.error(`SAFETY VIOLATION: preview bundle matches ${re} — aborting build`);
      process.exit(1);
    }
  }
  console.log("Build complete. Safety assertion passed for khaveeai-preview.js.");
}
