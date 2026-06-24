// packages/wp-bundle/build.mjs
// Source: esbuild official docs (esbuild.github.io/api/#format) — IIFE format
// wraps output in a function expression so bundle-local variables never leak
// into global scope; omitting --global-name means NOTHING is assigned to
// window at all (D-10's "never assigns window.React/window.ReactDOM").
import * as esbuild from "esbuild";

const watch = process.argv.includes("--watch");

const buildOptions = {
  entryPoints: ["src/index.ts"],
  bundle: true,
  format: "iife", // no globalName set: zero globals exposed
  outfile: "../../wordpress-plugin/build/khaveeai-bundle.js",
  minify: true,
  target: ["es2017"], // matches root tsconfig.json's ES2017 target
  loader: { ".css": "css" },
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"' },
  // Deliberately NO `external` array — D-10 full isolation means react,
  // react-dom, three, @pixiv/three-vrm all get bundled INLINE, not externalized.
};

if (watch) {
  const ctx = await esbuild.context(buildOptions);
  await ctx.watch();
  console.log("watching for changes...");
} else {
  await esbuild.build(buildOptions);
}
