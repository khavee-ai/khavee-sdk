import { defineConfig } from "vitest/config";

export default defineConfig({
  css: false,
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
    },
  },
});
