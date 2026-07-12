import { defineConfig } from "vitest/config";

export default defineConfig({
  // Vite's dep-optimizer walks up from this package looking for a PostCSS
  // config and picks up the repo root's postcss.config.mjs, which declares
  // its `plugins` as bare package-name strings (Tailwind CLI convention) —
  // a shape Vite's own postcss-load-config rejects ("Invalid PostCSS
  // Plugin"). This package has no CSS to process, so short-circuit PostCSS
  // resolution entirely rather than letting it inherit the Next.js app's
  // Tailwind config.
  css: {
    postcss: { plugins: [] },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
    },
  },
});
