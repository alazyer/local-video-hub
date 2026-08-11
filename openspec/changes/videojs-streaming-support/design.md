# Design: Video.js Runtime + Capability Wiring (Calibrated)

## Architecture

1. `src/lib/videojs-adapter.ts` is the runtime seam:
   - Loads Video.js from CDN at runtime (`vjs.zencdn.net/8.23.4`).
   - Optionally loads DASH runtime/plugin only when `NEXT_PUBLIC_ENABLE_DASH_PLAYBACK=true`.
   - Creates a Video.js instance when available.
   - Falls back to native `<video>` adapter (sets `video.src` directly) with explicit runtime status when the CDN load fails. **Verified:** the native fallback preserves Range-based seek because the browser issues its own Range requests against the source URL — but only if that URL's server honors Range.

2. `src/lib/capability-evaluator.ts` accepts runtime capability inputs (`dashFeatureEnabled`, `dashPluginLoaded`) and filters playable sources by protocol.

3. `src/components/video-player/videojs-player.tsx`:
   - Asynchronously initializes the adapter once per mount.
   - Uses runtime status + browser capabilities to filter playable sources before selecting the initial source.
   - Custom scrubber / `seekTo` / `seekBy` (±10s) / keyboard shortcuts, all writing `v.currentTime`.

4. Three streaming routes (`server-file/stream`, `baidu-pan/stream`, `http-proxy`) all return `206 Partial Content` + `Accept-Ranges`/`Content-Range` and use `fs.createReadStream({start,end})` (no `fs.readFile`). **Verified for `server-file/stream`:** a `Range: bytes=0-1023` returns `206` with `Content-Range: bytes 0-1023/77487291`; a mid-file range returns the correct offset and only the requested bytes.

## Data Flow

1. `page.tsx` resolves each origin into `sources[]` via `resolveSources`:
   - **local** → `blob:` URL (browser handles byte ranges natively).
   - **server** → `/api/server-file/stream?path=...` (server reads file via `fs.createReadStream`).
   - **pan** → `/api/baidu-pan/stream?fsId=...` (server proxies百度 CDN with correct UA, forwards Range).
   - **url direct** → the raw URL (browser Range-requests the origin directly).
   - **url via proxy** → `/api/http-proxy?url=...` (server proxies upstream, forwards Range).
2. `videojs-player.tsx` initializes the runtime adapter, then `evaluateCapabilities` filters candidates (HLS by native/MSE, DASH only when feature+plugin present).
3. Player loads first playable source; `fallback-policy` handles retries/source switches on error.

## Failure Modes & Verified Behavior

1. **Video.js CDN unavailable** (verified: `vjs.zencdn.net` returned status `000` in a restricted network): adapter returns native fallback with explicit status. Seek is preserved **iff** the source URL honors Range.
2. **DASH feature disabled**: DASH sources excluded from candidate set.
3. **DASH feature enabled but plugin unavailable**: DASH sources blocked deterministically.
4. **Upstream ignores Range** (verified: `python -m http.server` returns `200` + full file for a `Range` request): the proxy transparently returns the full `200` response. The browser buffers the entire file before playing and cannot seek. **This is the primary root cause of the user's report.** → Addressed by Requirement 4 (server-side Range synthesis).

## Design Decision: Server-Side Range Synthesis in the URL Proxy

When the upstream returns `200` (full body) to a Range request, the proxy MUST satisfy the client's `Range` by slicing the upstream stream itself, rather than passing the full body through. Concretely: if the client sent `Range: bytes=start-end` and the upstream returned `200` (no `Content-Range`), the proxy reads the upstream stream, emits only the requested byte window, and returns `206` with a synthesized `Content-Range: bytes start-end/*` (total size unknown → `*`) or `bytes start-end/total` when `Content-Length` is present. This makes seek work for `python http.server` and similar Range-incapable origins. Because this requires reading the stream sequentially, the proxy discards bytes before `start` and cancels the upstream read after `end`.

## Constraints

- Range synthesis applies only to the URL proxy path (`http-proxy`); `server-file/stream` already reads files via `fs.createReadStream({start,end})` and needs no change.
- If the upstream honors Range (returns `206`), the proxy keeps its current transparent-passthrough behavior — no double-slicing.
