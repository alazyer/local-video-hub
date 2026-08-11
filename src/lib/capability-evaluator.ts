import type { NormalizedSource, PlaybackProtocol } from "@/lib/source-resolver";

export interface PlaybackCapabilities {
  mseSupported: boolean;
  nativeHlsSupported: boolean;
  dashPluginAvailable: boolean;
  drmApiAvailable: boolean;
}

export interface CapabilityEvaluationResult {
  capabilities: PlaybackCapabilities;
  playableSources: NormalizedSource[];
  blockedProtocols: PlaybackProtocol[];
}

export interface RuntimeCapabilityInput {
  dashFeatureEnabled: boolean;
  dashPluginLoaded: boolean;
}

function canPlayNativeHls(videoEl: HTMLVideoElement | null): boolean {
  if (!videoEl) return false;
  return videoEl.canPlayType("application/vnd.apple.mpegurl") !== "";
}

function hasDashPlugin(runtime: RuntimeCapabilityInput): boolean {
  return runtime.dashFeatureEnabled && runtime.dashPluginLoaded;
}

export function evaluateCapabilities(
  sources: NormalizedSource[],
  videoEl: HTMLVideoElement | null,
  runtime: RuntimeCapabilityInput,
): CapabilityEvaluationResult {
  const capabilities: PlaybackCapabilities = {
    mseSupported: typeof window !== "undefined" && typeof window.MediaSource !== "undefined",
    nativeHlsSupported: canPlayNativeHls(videoEl),
    dashPluginAvailable: hasDashPlugin(runtime),
    drmApiAvailable:
      typeof navigator !== "undefined" &&
      typeof navigator.requestMediaKeySystemAccess === "function",
  };

  const blockedProtocols = new Set<PlaybackProtocol>();

  const playableSources = sources.filter((source) => {
    if (source.protocol === "hls") {
      const allowed = capabilities.nativeHlsSupported || capabilities.mseSupported;
      if (!allowed) blockedProtocols.add("hls");
      return allowed;
    }
    if (source.protocol === "dash") {
      if (!capabilities.dashPluginAvailable) {
        blockedProtocols.add("dash");
        return false;
      }
    }
    return true;
  });

  return {
    capabilities,
    playableSources,
    blockedProtocols: [...blockedProtocols],
  };
}
