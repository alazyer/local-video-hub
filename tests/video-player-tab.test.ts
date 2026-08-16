import { describe, expect, test } from "bun:test";
import { parseVideoPlayerTab } from "../src/lib/video-player-tab";

describe("parseVideoPlayerTab", () => {
  test("returns tab value when it is valid", () => {
    expect(parseVideoPlayerTab("local")).toBe("local");
    expect(parseVideoPlayerTab("url")).toBe("url");
    expect(parseVideoPlayerTab("server")).toBe("server");
    expect(parseVideoPlayerTab("pan")).toBe("pan");
  });

  test("falls back to local for invalid values", () => {
    expect(parseVideoPlayerTab(null)).toBe("local");
    expect(parseVideoPlayerTab(undefined)).toBe("local");
    expect(parseVideoPlayerTab("unknown")).toBe("local");
  });
});
