import { describe, it, expect } from "vitest";
import { deriveRimColor, saturationOf, toHex, type RGB, type SampledImage } from "./deriveRimColor";

/**
 * Helper to create synthetic test fixtures.
 * Allocates a Uint8ClampedArray and fills rectangular regions.
 */
function createFixture(
  width: number,
  height: number,
  fill: (x: number, y: number) => { r: number; g: number; b: number; a: number }
): SampledImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const pixel = fill(x, y);
      data[i] = pixel.r;
      data[i + 1] = pixel.g;
      data[i + 2] = pixel.b;
      data[i + 3] = pixel.a;
    }
  }
  return { data, width, height };
}

describe("deriveRimColor", () => {
  it("preserves achromatic input (uniform grey) - no hue invented", () => {
    // 128×128 uniform grey
    const img = createFixture(128, 128, () => ({ r: 128, g: 128, b: 128, a: 255 }));
    const result = deriveRimColor(img);

    expect(result).not.toBeNull();
    if (!result) return; // Type guard

    // All three channels should be equal within floating-point precision
    expect(Math.abs(result.r - result.g)).toBeLessThan(1e-6);
    expect(Math.abs(result.g - result.b)).toBeLessThan(1e-6);
    expect(saturationOf(result)).toBeLessThan(1e-6);
  });

  it("beats plain mean when top third has a saturated region", () => {
    // 128×128 fixture:
    // - Top third (rows 0-42): mostly rgb(154,154,154), with a horizontal band
    //   of red rgb(255,32,32) covering ~15% of that third
    // - Bottom two thirds (rows 43-127): rgb(60,60,60)
    const img = createFixture(128, 128, (x, y) => {
      if (y < 43) {
        // Top third
        if (y >= 15 && y < 21) {
          // Horizontal red band (~6 rows out of 43 = ~14%)
          return { r: 255, g: 32, b: 32, a: 255 };
        }
        return { r: 154, g: 154, b: 154, a: 255 };
      }
      // Bottom two thirds
      return { r: 60, g: 60, b: 60, a: 255 };
    });

    const result = deriveRimColor(img);
    expect(result).not.toBeNull();
    if (!result) return;

    // Derived colour should be red-ish
    expect(result.r).toBeGreaterThan(result.g);
    expect(result.r).toBeGreaterThan(result.b);

    // Compute the plain mean of the whole image for comparison
    let rSum = 0, gSum = 0, bSum = 0, count = 0;
    for (let i = 0; i < img.data.length; i += 4) {
      if (img.data[i + 3] >= 128) {
        rSum += img.data[i];
        gSum += img.data[i + 1];
        bSum += img.data[i + 2];
        count++;
      }
    }
    const plainMean: RGB = { r: rSum / count, g: gSum / count, b: bSum / count };

    // Derived saturation should beat plain mean saturation
    expect(saturationOf(result)).toBeGreaterThan(saturationOf(plainMean));
  });

  it("picks sky over ground (top half blue, bottom half brown)", () => {
    // 128×128 fixture: top half sky blue, bottom half ground brown
    const img = createFixture(128, 128, (x, y) => {
      if (y < 64) {
        // Top half: sky blue rgb(68,136,255)
        return { r: 68, g: 136, b: 255, a: 255 };
      }
      // Bottom half: ground brown rgb(85,51,17)
      return { r: 85, g: 51, b: 17, a: 255 };
    });

    const result = deriveRimColor(img);
    expect(result).not.toBeNull();
    if (!result) return;

    // Should be blue-ish (b > r)
    expect(result.b).toBeGreaterThan(result.r);
  });

  it("excludes low-alpha pixels", () => {
    // 128×128 fixture: top 20 rows transparent blue, rows 20-42 opaque brown, bottom opaque grey
    // This ensures the top third (rows 0-42) has both transparent and opaque pixels
    const img = createFixture(128, 128, (x, y) => {
      if (y < 20) {
        // Top rows: sky blue but alpha=0 (fully transparent, should be excluded)
        return { r: 68, g: 136, b: 255, a: 0 };
      }
      if (y < 43) {
        // Rest of top third: ground brown, opaque (should be included)
        return { r: 85, g: 51, b: 17, a: 255 };
      }
      // Bottom two thirds: grey
      return { r: 128, g: 128, b: 128, a: 255 };
    });

    const result = deriveRimColor(img);
    expect(result).not.toBeNull();
    if (!result) return;

    // Should be brown-ish (r > b), not blue (transparent pixels excluded)
    expect(result.r).toBeGreaterThan(result.b);
  });

  it("returns null when all pixels are transparent", () => {
    const img = createFixture(128, 128, () => ({ r: 100, g: 100, b: 100, a: 0 }));
    const result = deriveRimColor(img);
    expect(result).toBeNull();
  });

  it("returns null for zero-dimension images", () => {
    const zeroWidth = deriveRimColor({ data: new Uint8ClampedArray(0), width: 0, height: 10 });
    expect(zeroWidth).toBeNull();

    const zeroHeight = deriveRimColor({ data: new Uint8ClampedArray(0), width: 10, height: 0 });
    expect(zeroHeight).toBeNull();
  });
});

describe("toHex", () => {
  it("converts RGB to hex string", () => {
    expect(toHex({ r: 255, g: 0, b: 0 })).toBe("#ff0000");
    expect(toHex({ r: 0, g: 255, b: 0 })).toBe("#00ff00");
    expect(toHex({ r: 0, g: 0, b: 255 })).toBe("#0000ff");
    expect(toHex({ r: 128, g: 128, b: 128 })).toBe("#808080");
  });

  it("clamps out-of-range values", () => {
    expect(toHex({ r: 300, g: -10, b: 128 })).toBe("#ff0080");
    expect(toHex({ r: 255.7, g: 0.3, b: 127.6 })).toBe("#ff0080");
  });
});

describe("saturationOf", () => {
  it("returns 0 for achromatic colors", () => {
    expect(saturationOf({ r: 0, g: 0, b: 0 })).toBe(0);
    expect(saturationOf({ r: 128, g: 128, b: 128 })).toBe(0);
    expect(saturationOf({ r: 255, g: 255, b: 255 })).toBe(0);
  });

  it("returns >0 for chromatic colors", () => {
    const redSat = saturationOf({ r: 255, g: 0, b: 0 });
    expect(redSat).toBeGreaterThan(0.9);

    const blueSat = saturationOf({ r: 68, g: 136, b: 255 });
    expect(blueSat).toBeGreaterThan(0);
  });
});
