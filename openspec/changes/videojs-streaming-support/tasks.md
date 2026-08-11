# Tasks: Video.js Streaming Remediation (Calibrated)

Empirical diagnosis (2026-08-11) confirmed the streaming implementation exists uncommitted and works for server/pan/local sources. The real gap is URL sources whose origin ignores Range. Tasks below reflect the verified remaining work; the prior all-`[x]` state was inaccurate and is replaced.

## Verified complete (no action needed)

- [x] Replace pseudo Video.js adapter with real runtime initialization seam (`src/lib/videojs-adapter.ts`). Verified: loads from CDN, native fallback with explicit status on failure.
- [x] Add DASH runtime/plugin load path behind explicit feature flag.
- [x] Wire runtime-derived DASH capability into `evaluateCapabilities`.
- [x] Update player initialization flow to await runtime adapter setup (`videojs-player.tsx`).
- [x] Restore OpenSpec artifacts in-repo for deterministic verification.
- [x] Add focused tests for capability gating behavior (`tests/capability-evaluator.test.ts`).
- [x] Server-file streaming route returns `206` + correct `Content-Range` and streams via `fs.createReadStream({start,end})`. **Verified at runtime with curl** against a 77.5 MB file (head vs mid byte ranges differ, only requested bytes returned).
- [x] Baidu-pan streaming route forwards `Range` upstream (correct UA) and passes through `Content-Range`/`Accept-Ranges`. Code-verified (no credentials for e2e).

## Remaining work

- [ ] **Implement server-side Range synthesis in `/api/http-proxy`.** When the upstream returns `200` (ignores `Range`) to a client `Range` request, the proxy MUST slice the upstream stream to the requested window and return `206` + synthesized `Content-Range`. Currently it passes the full `200` body through, which forces the browser to buffer the entire file. This is the verified root cause of the user's "downloads whole file before playing" report. See design.md "Server-Side Range Synthesis".
- [ ] Add a unit/runtime test for the http-proxy Range-synthesis path using a Range-incapable upstream fixture.
- [ ] Surface a UI hint on the URL direct path when a source does not honor Range, suggesting the proxy path ("通过代理播放") — see Requirement 5 scenario 2.
- [ ] **Commit the streaming implementation.** All Video.js adapter / routes / player / openspec files are currently uncommitted (`??`/`M` in `git status`). Deliver requires a commit so users running a build actually get the Range-aware routes.
- [ ] Run the runtime verification scenarios in spec.md Requirement 6 (server-source 206 + mid-range; URL-proxy Range synthesis) and record results.
- [ ] Confirm the dev server compiles the new files with zero TypeScript/build errors (excluding cosmetic font-download network warnings).

## Non-deliverable (documented limitation)

- Upstream servers that neither honor Range nor expose a size/seek API cannot be made seekable without transcoding. The proxy Range synthesis (above) covers the common `python http.server` case; exotic non-HTTP sources remain a degraded-mode limitation.
