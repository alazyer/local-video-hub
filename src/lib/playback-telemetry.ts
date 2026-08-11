import type { PlaybackErrorType } from "@/lib/fallback-policy";

export type PlaybackEventName =
  | "startup-latency"
  | "buffering"
  | "fatal-error"
  | "fallback-success"
  | "drm-capability-failure";

export interface PlaybackEventPayload {
  event: PlaybackEventName;
  timestamp: number;
  src?: string;
  detail?: string;
  durationMs?: number;
  errorType?: PlaybackErrorType;
}

export type PlaybackEventEmitter = (payload: PlaybackEventPayload) => void;

export function emitPlaybackEvent(
  emit: PlaybackEventEmitter | undefined,
  payload: PlaybackEventPayload,
): void {
  if (!emit) return;
  emit(payload);
}
