/**
 * Spike 004 — headless verification of the cover arithmetic.
 *
 * The "does it look right" half lives in the playground page. This half asks
 * the FACT question: does the maths hold across the aspect ratios a real
 * customer can produce, including the degenerate cases that appear mid-layout?
 */
import {
  planeSizeForDistance,
  coverTransform,
  visibleFraction,
} from "../../../apps/playground/src/app/lighting-spike/coverMath.ts";

let failures = 0;
const check = (name, cond, detail = "") => {
  if (cond) {
    console.log(`  ok    ${name}`);
  } else {
    failures++;
    console.log(`  FAIL  ${name} ${detail}`);
  }
};
const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

console.log("\n1. planeSizeForDistance — does a plane of this size fill the view?");
// Ground truth: at distance d, visible height = 2*d*tan(fov/2).
for (const [fov, aspect, dist] of [
  [50, 16 / 9, 5],
  [50, 9 / 16, 5],   // portrait — the case a height-from-width derivation breaks on
  [35, 1, 2],
  [75, 21 / 9, 12],
]) {
  const { width, height } = planeSizeForDistance(fov, aspect, dist);
  const expectedH = 2 * dist * Math.tan((fov * Math.PI) / 360);
  check(
    `fov=${fov} aspect=${aspect.toFixed(3)} d=${dist} -> ${width.toFixed(3)}x${height.toFixed(3)}`,
    near(height, expectedH) && near(width / height, aspect),
    `expected h=${expectedH.toFixed(4)}, aspect=${(width / height).toFixed(4)}`,
  );
}

console.log("\n2. coverTransform — invariants that must hold for ANY aspect pair");
const ASPECTS = [0.5, 0.5625, 0.75, 1, 1.333, 1.5, 1.778, 2.333, 3.2];
let invariantFailures = 0;
for (const pa of ASPECTS) {
  for (const ia of ASPECTS) {
    const { repeat, offset } = coverTransform(pa, ia);
    const [rx, ry] = repeat;
    const [ox, oy] = offset;

    // (a) Never magnify: cover crops, it never samples outside the image.
    const noMagnify = rx <= 1 + 1e-9 && ry <= 1 + 1e-9;
    // (b) Exactly one axis is cropped (or neither, when aspects match).
    const oneAxis = near(rx, 1) || near(ry, 1);
    // (c) The crop is centred.
    const centred = near(ox, (1 - rx) / 2) && near(oy, (1 - ry) / 2);
    // (d) Sampling stays inside [0,1] — outside it the texture would wrap or clamp.
    const inRange = ox >= -1e-9 && oy >= -1e-9 && ox + rx <= 1 + 1e-9 && oy + ry <= 1 + 1e-9;
    // (e) Aspect preserved: the sampled sub-rectangle has the plane's aspect.
    const sampledAspect = (rx / ry) * ia;
    const preserved = near(sampledAspect, pa, 1e-9);

    if (!(noMagnify && oneAxis && centred && inRange && preserved)) {
      invariantFailures++;
      console.log(
        `  FAIL  plane=${pa} image=${ia} repeat=[${rx.toFixed(4)},${ry.toFixed(4)}] ` +
          `offset=[${ox.toFixed(4)},${oy.toFixed(4)}] sampledAspect=${sampledAspect.toFixed(4)}`,
      );
    }
  }
}
check(
  `all ${ASPECTS.length * ASPECTS.length} aspect pairs satisfy no-magnify / one-axis / centred / in-range / aspect-preserved`,
  invariantFailures === 0,
  `${invariantFailures} failed`,
);

console.log("\n3. Degenerate inputs must not emit NaN (three.js turns NaN into an invisible texture)");
for (const [pa, ia, label] of [
  [0, 1.778, "plane aspect 0 (zero-height container mid-layout)"],
  [1.778, 0, "image aspect 0 (texture not loaded yet)"],
  [NaN, 1.778, "NaN plane aspect"],
  [1.778, Infinity, "Infinite image aspect"],
  [-1, 1.778, "negative plane aspect"],
]) {
  const { repeat, offset } = coverTransform(pa, ia);
  const finite = [...repeat, ...offset].every(Number.isFinite);
  check(`${label} -> repeat=[${repeat}] offset=[${offset}]`, finite);
}

console.log("\n4. How much of a customer's image actually survives the crop?");
const PLANE_16_9 = 16 / 9;
for (const [ia, label] of [
  [16 / 9, "16:9 landscape (matches)"],
  [1, "1:1 square"],
  [9 / 16, "9:16 phone portrait"],
  [3.2, "ultra-wide banner"],
]) {
  const f = visibleFraction(PLANE_16_9, ia);
  console.log(`  ${label.padEnd(28)} ${(f * 100).toFixed(1)}% of the image visible`);
}

console.log(
  `\n${failures === 0 ? "PASS" : "FAIL"} — ${failures} failing check(s)\n`,
);
process.exit(failures === 0 ? 0 : 1);
