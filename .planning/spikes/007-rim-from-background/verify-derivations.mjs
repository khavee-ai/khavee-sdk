/**
 * Spike 007 — headless comparison of rim-colour derivations.
 *
 * Synthetic backgrounds whose "right answer" is arguable but whose FAILURE is
 * not: if a background obviously has a colour and the derivation returns grey,
 * that derivation reproduces the exact defect Phase 15 spent a plan fixing.
 */
import {
  deriveRimColor,
  saturationOf,
  toHex,
  DERIVATIONS,
} from "../../../apps/playground/src/app/lighting-spike/deriveRimColor.ts";

/** Build an RGBA image from a per-pixel function. */
function make(width, height, fn) {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b] = fn(x, y, width, height);
      const i = (y * width + x) * 4;
      data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
    }
  }
  return { data, width, height };
}

const CASES = [
  {
    name: "mostly grey wall + small red neon",
    note: "the discriminating case — 88% neutral, 12% vivid red",
    img: make(50, 50, (x, y) => (x > 43 ? [230, 20, 40] : [120, 120, 122])),
    expect: "a red-ish rim; grey means the vivid light was averaged away",
  },
  {
    name: "opposing colours, equal area",
    note: "warm left / cool right — the classic mud generator",
    img: make(50, 50, (x) => (x < 25 ? [235, 140, 30] : [40, 90, 230])),
    expect: "any chromatic result; a neutral one proves averaging destroyed both",
  },
  {
    name: "blue sky over dark ground",
    note: "sky on top, dark ground below — a common uploaded photo",
    img: make(50, 60, (x, y, w, h) => (y < h * 0.4 ? [95, 160, 235] : [45, 38, 32])),
    expect: "sky blue; the light in this scene comes from above",
  },
  {
    name: "genuinely grey background",
    note: "the safety case — no hue exists to find",
    img: make(40, 40, () => [128, 128, 130]),
    expect: "near-zero saturation from EVERY derivation; inventing a hue here is the worst failure",
  },
];

console.log("");
for (const c of CASES) {
  console.log(`── ${c.name}`);
  console.log(`   ${c.note}`);
  console.log(`   want: ${c.expect}`);
  for (const d of DERIVATIONS) {
    const col = deriveRimColor(c.img, d.id);
    const sat = saturationOf(col);
    const flag = sat < 0.12 ? "  <- achromatic" : "";
    console.log(
      `     ${d.label.padEnd(20)} ${toHex(col)}  sat ${sat.toFixed(3)}${flag}`,
    );
  }
  console.log("");
}

// The one hard assertion: a truly grey background must not acquire a hue.
const grey = CASES[3].img;
let failures = 0;
for (const d of DERIVATIONS) {
  const sat = saturationOf(deriveRimColor(grey, d.id));
  if (sat > 0.05) {
    failures++;
    console.log(`FAIL  ${d.label} invented a hue on a grey background (sat ${sat.toFixed(3)})`);
  }
}
console.log(
  failures === 0
    ? "PASS — no derivation invents a hue on an achromatic background\n"
    : `FAIL — ${failures} derivation(s) invented a hue\n`,
);
process.exit(failures === 0 ? 0 : 1);
