export type PlaybackProtocol = "hls" | "dash" | "progressive";

export interface NormalizedSource {
  src: string;
  type: string;
  protocol: PlaybackProtocol;
  codecs?: string;
}

export type PlaybackOrigin = "local" | "url" | "server" | "pan";

export interface SourceResolverInput {
  origin: PlaybackOrigin;
  url: string;
  mimeType?: string | null;
}

function inferMimeTypeFromUrl(url: string): string {
  const normalized = url.toLowerCase();
  if (normalized.includes(".m3u8")) return "application/vnd.apple.mpegurl";
  if (normalized.includes(".mpd")) return "application/dash+xml";
  if (normalized.includes(".mp4")) return "video/mp4";
  if (normalized.includes(".webm")) return "video/webm";
  if (normalized.includes(".mov")) return "video/quicktime";
  if (normalized.includes(".mkv")) return "video/x-matroska";
  return "application/octet-stream";
}

function inferProtocol(mimeType: string, url: string): PlaybackProtocol {
  const normalizedType = mimeType.toLowerCase();
  if (normalizedType.includes("mpegurl") || url.toLowerCase().includes(".m3u8")) {
    return "hls";
  }
  if (normalizedType.includes("dash+xml") || url.toLowerCase().includes(".mpd")) {
    return "dash";
  }
  return "progressive";
}

function extractCandidateUrl(url: string): string {
  if (url.startsWith("blob:")) return url;

  try {
    const base = typeof window !== "undefined" ? window.location.origin : "http://localhost";
    const parsed = new URL(url, base);
    const proxied = parsed.searchParams.get("url");
    if (proxied) return proxied;
    return parsed.toString();
  } catch {
    return url;
  }
}

export function resolveSources(input: SourceResolverInput): NormalizedSource[] {
  const candidateUrl = extractCandidateUrl(input.url);
  const mimeType = input.mimeType?.trim() || inferMimeTypeFromUrl(candidateUrl);
  const protocol = inferProtocol(mimeType, candidateUrl);

  const primary: NormalizedSource = {
    src: input.url,
    type: mimeType,
    protocol,
  };

  // URL sources can safely add a progressive fallback candidate.
  if (input.origin === "url" && protocol !== "progressive") {
    return [
      primary,
      {
        src: input.url,
        type: "application/octet-stream",
        protocol: "progressive",
      },
    ];
  }

  return [primary];
}
