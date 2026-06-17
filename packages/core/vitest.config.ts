import { defineConfig } from "vitest/config";

export default defineConfig({
  css: {
    // Prevent vite from walking up to the monorepo-root postcss.config.mjs
    // (Next.js-only Tailwind v4 config, incompatible with raw postcss-load-config
    // resolution outside of Next's build pipeline). @khaveeai/core has no CSS.
    postcss: {},
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
    },
  },
});
