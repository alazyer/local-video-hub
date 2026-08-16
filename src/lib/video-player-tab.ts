export type VideoPlayerTab = "local" | "url" | "server" | "pan";

const DEFAULT_TAB: VideoPlayerTab = "local";

export function parseVideoPlayerTab(value: string | null | undefined): VideoPlayerTab {
  if (value === "local" || value === "url" || value === "server" || value === "pan") {
    return value;
  }
  return DEFAULT_TAB;
}
