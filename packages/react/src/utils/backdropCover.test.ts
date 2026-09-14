import { describe, it, expect } from "vitest";
import {
  planeSizeForDistance,
  coverTransform,
  visibleFraction,
  backdropLayout,
  type BackgroundFit,
} from "./backdropCover";

describe("planeSizeForDistance", () => {
  it("returns height 2 and width 2 for 90° FOV, aspect 1, distance 1", () => {
    const result = planeSizeForDistance(90, 1, 1);
    expect(result.height).toBeCloseTo(2, 5);
    expect(result.width).toBeCloseTo(2, 5);
  });

  it("returns correct aspect ratio and height for 50° FOV, 16:9 aspect, distance 6", () => {
    const result = planeSizeForDistance(50, 16 / 9, 6);
    const aspectRatio = result.width / result.height;
    expect(aspectRatio).toBeCloseTo(16 / 9, 5);
    // height / (2 * distance) should equal tan(25°)
    expect(result.height / (2 * 6)).toBeCloseTo(Math.tan((25 * Math.PI) / 180), 5);
  });

  it("doubles both dimensions when distance is doubled", () => {
    const result1 = planeSizeForDistance(60, 16 / 9, 5);
    const result2 = planeSizeForDistance(60, 16 / 9, 10);
    expect(result2.width).toBeCloseTo(result1.width * 2, 5);
    expect(result2.height).toBeCloseTo(result1.height * 2, 5);
  });
});

describe("coverTransform", () => {
  it("returns 31.6% visible fraction for 16:9 plane with 9:16 image", () => {
    const transform = coverTransform(16 / 9, 9 / 16);
    const visible = visibleFraction(16 / 9, 9 / 16);
    expect(visible).toBeCloseTo(0.31640625, 4);
    expect(transform.repeat[0]).toBe(1);
    expect(transform.repeat[1]).toBeCloseTo((9 / 16) / (16 / 9), 5);
  });

  it("returns no crop for matching aspects", () => {
    const transform = coverTransform(16 / 9, 16 / 9);
    expect(transform.repeat).toEqual([1, 1]);
    expect(transform.offset).toEqual([0, 0]);
  });

  it("returns valid crop for 81 aspect pairs", () => {
    const aspects = [9 / 16, 3 / 4, 1, 4 / 3, 16 / 9, 2, 21 / 9, 1 / 2, 5 / 4];

    for (const planeAspect of aspects) {
      for (const imageAspect of aspects) {
        const { repeat } = coverTransform(planeAspect, imageAspect);

        // Both components must be finite
        expect(isFinite(repeat[0])).toBe(true);
        expect(isFinite(repeat[1])).toBe(true);

        // Both must be in (0, 1]
        expect(repeat[0]).toBeGreaterThan(0);
        expect(repeat[0]).toBeLessThanOrEqual(1);
        expect(repeat[1]).toBeGreaterThan(0);
        expect(repeat[1]).toBeLessThanOrEqual(1);

        // At least one must equal 1
        expect(repeat[0] === 1 || repeat[1] === 1).toBe(true);
      }
    }
  });

  it("handles degenerate inputs gracefully", () => {
    const degenerateValues = [0, -1, NaN, Infinity];

    for (const val1 of degenerateValues) {
      for (const val2 of [1, ...degenerateValues]) {
        const result = coverTransform(val1, val2);
        expect(result.repeat).toEqual([1, 1]);
        expect(result.offset).toEqual([0, 0]);
        expect(isFinite(result.repeat[0])).toBe(true);
        expect(isFinite(result.repeat[1])).toBe(true);
      }
    }
  });
});

describe("backdropLayout", () => {
  it("returns cover transform for fit: cover", () => {
    const layout = backdropLayout({
      fovDegrees: 60,
      cameraAspect: 16 / 9,
      distance: 5,
      imageAspect: 9 / 16,
      fit: "cover",
    });

    // Plane dimensions should match planeSizeForDistance
    const planeSize = planeSizeForDistance(60, 16 / 9, 5);
    expect(layout.planeWidth).toBeCloseTo(planeSize.width, 5);
    expect(layout.planeHeight).toBeCloseTo(planeSize.height, 5);

    // Should have the cover crop
    const expectedTransform = coverTransform(16 / 9, 9 / 16);
    expect(layout.repeat[0]).toBeCloseTo(expectedTransform.repeat[0], 5);
    expect(layout.repeat[1]).toBeCloseTo(expectedTransform.repeat[1], 5);
    expect(layout.offset[0]).toBeCloseTo(expectedTransform.offset[0], 5);
    expect(layout.offset[1]).toBeCloseTo(expectedTransform.offset[1], 5);
  });

  it("returns no crop for fit: contain", () => {
    const layout = backdropLayout({
      fovDegrees: 60,
      cameraAspect: 16 / 9,
      distance: 5,
      imageAspect: 9 / 16,
      fit: "contain",
    });

    // No crop
    expect(layout.repeat).toEqual([1, 1]);
    expect(layout.offset).toEqual([0, 0]);
    expect(layout.visibleFraction).toBe(1);

    // Plane aspect should match image aspect
    const planeAspect = layout.planeWidth / layout.planeHeight;
    expect(planeAspect).toBeCloseTo(9 / 16, 6);

    // Both dimensions should be <= frustum dimensions
    const frustumSize = planeSizeForDistance(60, 16 / 9, 5);
    expect(layout.planeWidth).toBeLessThanOrEqual(frustumSize.width + 1e-6);
    expect(layout.planeHeight).toBeLessThanOrEqual(frustumSize.height + 1e-6);
  });

  it("handles degenerate inputs gracefully", () => {
    const layout = backdropLayout({
      fovDegrees: NaN,
      cameraAspect: 0,
      distance: -1,
      imageAspect: Infinity,
      fit: "cover",
    });

    // Should return finite layout with no crop
    expect(isFinite(layout.planeWidth)).toBe(true);
    expect(isFinite(layout.planeHeight)).toBe(true);
    expect(layout.repeat).toEqual([1, 1]);
    expect(layout.offset).toEqual([0, 0]);
  });
});
