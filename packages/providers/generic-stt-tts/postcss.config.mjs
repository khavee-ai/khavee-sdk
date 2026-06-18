// Empty PostCSS config — this package has no CSS.
// This file shadows the root postcss.config.mjs so vitest does not pick up
// the root-level @tailwindcss/postcss plugin which is incompatible with Vite's
// CSS transform in a Node/TypeScript-only package context.
export default { plugins: [] };
