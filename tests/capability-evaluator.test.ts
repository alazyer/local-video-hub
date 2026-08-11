import { afterEach, describe, expect, test } from "bun:test";
import { evaluateCapabilities, type RuntimeCapabilityInput } from "../src/lib/capability-evaluator";
import type { NormalizedSource } from "../src/lib/source-resolver";

const ORIGINAL_WINDOW = globalThis.window;
const ORIGINAL_NAVIGATOR = globalThis.navigator;

function withRuntime({
  mediaSource = true,
  drmApi = false,
}: {
  mediaSource?: boolean;
  drmApi?: boolean;
}) {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: mediaSource ? { MediaSource: {} } : {},
  });

  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: drmApi ? { requestMediaKeySystemAccess: () => Promise.resolve({}) } : {},
  });
}

function source(protocol: "hls" | "dash" | "progressive", src: string): NormalizedSource {
  const type =
    protocol === "hls"
      ? "application/vnd.apple.mpegurl"
      : protocol === "dash"
        ? "application/dash+xml"
        : "video/mp4";

  return { protocol, src, type };
}

function evaluate(
  sources: NormalizedSource[],
  runtime: RuntimeCapabilityInput,
  canPlayHls = "",
) {
  const videoEl = {
    canPlayType: () => canPlayHls,
  } as unknown as HTMLVideoElement;

  return evaluateCapabilities(sources, videoEl, runtime);
}

afterEach(() => {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: ORIGINAL_WINDOW,
  });
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: ORIGINAL_NAVIGATOR,
  });
});

describe("evaluateCapabilities", () => {
  test("blocks DASH when feature flag is disabled", () => {
    withRuntime({ mediaSource: true });
    const result = evaluate(
      [source("dash", "/video.mpd"), source("progressive", "/video.mp4")],
      { dashFeatureEnabled: false, dashPluginLoaded: true },
    );

    expect(result.playableSources.map((s) => s.protocol)).toEqual(["progressive"]);
    expect(result.blockedProtocols).toEqual(["dash"]);
  });

  test("blocks DASH when plugin is missing", () => {
    withRuntime({ mediaSource: true });
    const result = evaluate(
      [source("dash", "/video.mpd"), source("progressive", "/video.mp4")],
      { dashFeatureEnabled: true, dashPluginLoaded: false },
    );

    expect(result.playableSources.map((s) => s.protocol)).toEqual(["progressive"]);
    expect(result.blockedProtocols).toEqual(["dash"]);
  });

  test("allows DASH when feature and plugin are both available", () => {
    withRuntime({ mediaSource: true });
    const result = evaluate(
      [source("dash", "/video.mpd"), source("progressive", "/video.mp4")],
      { dashFeatureEnabled: true, dashPluginLoaded: true },
    );

    expect(result.playableSources.map((s) => s.protocol)).toEqual(["dash", "progressive"]);
    expect(result.blockedProtocols).toEqual([]);
  });
});

