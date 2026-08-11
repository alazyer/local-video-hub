import type { NormalizedSource } from "@/lib/source-resolver";

export type PlaybackErrorType =
  | "source-unavailable"
  | "protocol-unsupported"
  | "network"
  | "drm"
  | "unknown";

export interface FallbackState {
  currentIndex: number;
  retries: Record<number, number>;
}

export interface FallbackDecision {
  nextIndex: number | null;
  errorType: PlaybackErrorType;
  reason: string;
}

const MAX_RETRIES_PER_SOURCE = 2;

export function createFallbackState(initialIndex = 0): FallbackState {
  return {
    currentIndex: initialIndex,
    retries: {},
  };
}

export function classifyPlaybackError(message: string): PlaybackErrorType {
  const normalized = message.toLowerCase();
  if (normalized.includes("network") || normalized.includes("timeout")) return "network";
  if (normalized.includes("drm") || normalized.includes("keysystem")) return "drm";
  if (normalized.includes("not supported") || normalized.includes("unsupported")) {
    return "protocol-unsupported";
  }
  if (normalized.includes("404") || normalized.includes("not found")) {
    return "source-unavailable";
  }
  return "unknown";
}

export function nextFallbackSource(
  sources: NormalizedSource[],
  state: FallbackState,
  errorMessage: string,
): FallbackDecision {
  const currentRetry = state.retries[state.currentIndex] ?? 0;
  if (currentRetry < MAX_RETRIES_PER_SOURCE) {
    state.retries[state.currentIndex] = currentRetry + 1;
    return {
      nextIndex: state.currentIndex,
      errorType: classifyPlaybackError(errorMessage),
      reason: `retry-${state.retries[state.currentIndex]}`,
    };
  }

  const nextIndex = state.currentIndex + 1;
  if (nextIndex >= sources.length) {
    return {
      nextIndex: null,
      errorType: classifyPlaybackError(errorMessage),
      reason: "no-more-sources",
    };
  }

  state.currentIndex = nextIndex;
  return {
    nextIndex,
    errorType: classifyPlaybackError(errorMessage),
    reason: "switch-source",
  };
}
