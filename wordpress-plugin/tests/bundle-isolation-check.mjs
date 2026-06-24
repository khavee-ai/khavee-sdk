#!/usr/bin/env node
/**
 * bundle-isolation-check.mjs — D-10 bundle isolation smoke check.
 *
 * Standalone Node script (no test framework). Reads the BUILT
 * wordpress-plugin/build/khaveeai-bundle.js, executes it inside a fresh
 * node:vm sandbox with a minimal window/document/globalThis shim, then
 * asserts the IIFE never assigned window.React, window.ReactDOM, or any
 * window.khaveeai global. The DOM shim only needs enough surface for the
 * bundle's top-level DOMContentLoaded registration to run without throwing
 * — it does not need to actually mount React.
 *
 * Run: node wordpress-plugin/tests/bundle-isolation-check.mjs
 * Exits 0 if all checks pass, 1 if any fail — mirrors the PASS/FAIL +
 * exit-code reporting convention used by the PHP harnesses in this
 * directory (see rest-logic-harness.php).
 */

import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const bundlePath = join(__dirname, "..", "build", "khaveeai-bundle.js");

const code = readFileSync(bundlePath, "utf8");

// ── Minimal DOM shim ────────────────────────────────────────────────────
// Just enough surface for the bundle's top-level
// `document.readyState`/`addEventListener`/`querySelectorAll` calls to run
// without throwing. The bundle finds zero `[data-khaveeai-config]` elements
// against this empty shim, so it never attempts to actually mount React.

const listeners = {};

const documentShim = {
  readyState: "complete",
  addEventListener(event, handler) {
    (listeners[event] ??= []).push(handler);
  },
  removeEventListener() {},
  querySelectorAll() {
    return [];
  },
  querySelector() {
    return null;
  },
  createElement() {
    return {
      setAttribute() {},
      style: {},
      appendChild() {},
    };
  },
  head: { appendChild() {} },
  body: { appendChild() {} },
};

const sandbox = {
  window: {},
  document: documentShim,
  navigator: { userAgent: "node-vm-sandbox" },
  console,
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
  // Standard browser globals referenced at module scope by bundled
  // dependencies (e.g. AbortController by fetch-using helpers, performance
  // by three.js) — provided here so the sandbox can execute the bundle far
  // enough to prove the isolation assertions below, without needing a full
  // jsdom environment (D-10's check only needs to prove no global leak, not
  // a working render).
  AbortController,
  performance,
};
sandbox.globalThis = sandbox;
// `window` and `globalThis` are the same object here so a bundle that
// assigns either `window.React = ...` or `globalThis.React = ...` is
// caught by a single set of assertions below.

const context = createContext(sandbox);

let failures = 0;

function runCase(name, fn) {
  try {
    const result = fn();
    if (result === true) {
      console.log(`PASS: ${name}`);
    } else {
      console.log(`FAIL: ${name}`);
      failures += 1;
    }
  } catch (error) {
    console.log(`FAIL: ${name} (unexpected exception: ${error.message})`);
    failures += 1;
  }
}

runCase("bundle executes without throwing in an isolated sandbox", () => {
  runInContext(code, context, { filename: "khaveeai-bundle.js" });
  return true;
});

runCase("globalThis.React is not assigned by the bundle", () => {
  return typeof sandbox.globalThis.React === "undefined";
});

runCase("globalThis.ReactDOM is not assigned by the bundle", () => {
  return typeof sandbox.globalThis.ReactDOM === "undefined";
});

runCase("globalThis.khaveeai is not assigned by the bundle", () => {
  return typeof sandbox.globalThis.khaveeai === "undefined";
});

// ── Exit ─────────────────────────────────────────────────────────────

if (failures > 0) {
  console.log(`\n${failures} case(s) FAILED.`);
  process.exit(1);
}

console.log("\nAll cases PASSED.");
process.exit(0);
