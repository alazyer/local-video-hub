# Spec: Video.js Streaming (Calibrated to Empirical Findings)

## Requirement 1: Runtime Integration

Playback MUST initialize a real Video.js runtime when available, instead of only wrapping native `<video>` behavior.

### Scenario: Video.js runtime available

- **Given** the browser can load Video.js runtime scripts from the CDN
- **When** the player initializes
- **Then** it creates a Video.js player instance for playback operations

### Scenario: Video.js runtime unavailable

- **Given** runtime scripts cannot be loaded (e.g. CDN blocked by network)
- **When** the player initializes
- **Then** it falls back to native playback with an explicit runtime status, and seek continues to work on Range-capable sources (see Requirement 5)

## Requirement 2: DASH Capability Gating

DASH playback MUST be enabled only when both feature flag and plugin availability are satisfied.

### Scenario: DASH feature disabled

- **Given** `NEXT_PUBLIC_ENABLE_DASH_PLAYBACK` is not `true`
- **When** source capabilities are evaluated
- **Then** DASH sources are excluded from playable candidates

### Scenario: DASH feature enabled with plugin loaded

- **Given** `NEXT_PUBLIC_ENABLE_DASH_PLAYBACK=true` and the DASH plugin is loaded
- **When** source capabilities are evaluated
- **Then** DASH sources are allowed in playable candidates

## Requirement 3: Existing UX Preservation

The migration MUST preserve existing playback controls and deterministic fallback behavior for existing source types.

### Scenario: Existing non-DASH source

- **Given** local/server/pan/url sources that resolve to progressive or HLS playback
- **When** playback starts
- **Then** the custom scrubber, ±10s seek, keyboard shortcuts, volume, rate, fullscreen, and prev/next controls continue to operate, and the fallback policy retries/switches sources on error

## Requirement 4: Streaming Seek for URL Sources Regardless of Origin Capability

The URL proxy (`/api/http-proxy`) MUST support byte-range seek even when the upstream origin server ignores the `Range` header. This is the verified root cause of the "downloads the whole file before playing" report.

### Scenario: Upstream honors Range (transparent passthrough)

- **Given** the upstream server returns `206 Partial Content` with `Content-Range` for a `Range` request
- **When** the client requests the proxy with a `Range` header
- **Then** the proxy forwards `Range` upstream and transparently passes back the `206`, `Content-Range`, `Content-Length`, and `Accept-Ranges` headers to the client

### Scenario: Upstream ignores Range (server-side synthesis) — `python -m http.server` case

- **Given** the upstream server ignores `Range` and returns `200 OK` with the full body (e.g. Python `SimpleHTTP`)
- **When** the client requests the proxy with `Range: bytes=start-end`
- **Then** the proxy MUST return `206 Partial Content` with `Content-Range: bytes start-end/*` (or `bytes start-end/total` when the upstream `Content-Length` is known) and a `Content-Length` matching the requested window, emitting only the requested byte range from the upstream stream
- **And** the proxy MUST discard upstream bytes before `start` and cancel the upstream read after `end`
- **And** the response MUST include `Accept-Ranges: bytes` and the CORS expose headers (`Content-Range`, `Content-Length`)

### Scenario: No Range header from client

- **Given** the client does not send a `Range` header
- **When** the client requests the proxy
- **Then** the proxy passes through the upstream response unchanged (current behavior preserved)

## Requirement 5: Native Fallback Seek Preservation

When the Video.js runtime fails to load and the player falls back to the native `<video>` adapter, byte-range seek MUST continue to function for Range-capable sources.

### Scenario: CDN load fails, source URL honors Range

- **Given** the Video.js CDN is unreachable and the adapter returns the native fallback
- **And** the active source URL points to a Range-capable server (server-file stream, baidu-pan stream, or a Range-capable URL)
- **When** the user seeks via the scrubber or ±10s buttons
- **Then** the browser issues a `Range` request and playback resumes at the target position without buffering the whole file

### Scenario: CDN load fails, source URL does not honor Range

- **Given** the Video.js CDN is unreachable and the adapter returns the native fallback
- **And** the active source URL points to a Range-incapable server (direct URL to `python http.server`)
- **Then** seek is not possible for that source, and the UI SHOULD surface a hint to use the proxy path (which now synthesizes Range per Requirement 4)

## Requirement 6: Delivery & Verification

The streaming implementation MUST be committed and empirically verified, not left as uncommitted working-tree changes.

### Scenario: Committed and built

- **Given** the Video.js adapter, the three streaming routes, and `videojs-player.tsx` exist as uncommitted changes
- **When** the change is delivered
- **Then** these files are committed to version control and the dev server compiles them without TypeScript/build errors

### Scenario: Runtime verification of server source

- **Given** a large server-file video (≥50 MB)
- **When** a `Range: bytes=0-1023` request is sent to `/api/server-file/stream?path=...`
- **Then** the response is `206 Partial Content` with `Content-Range: bytes 0-1023/<total>` and a 1024-byte body
- **And** a `Range: bytes=<mid>-<mid+1023>` request returns the correct offset range, proving seek fetches only the requested bytes

### Scenario: Runtime verification of URL proxy Range synthesis

- **Given** a URL proxy backed by a Range-incapable upstream (e.g. `python -m http.server` serving a large file)
- **When** a `Range: bytes=0-1023` request is sent to `/api/http-proxy?url=...`
- **Then** the response is `206 Partial Content` with `Content-Range: bytes 0-1023/*` and a body of exactly 1024 bytes (not the full file)
