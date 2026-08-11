# Proposal: Video.js Streaming Support — Diagnosis & Spec Calibration

## Summary

The streaming + seek implementation (Video.js adapter, Range-aware streaming routes, capability evaluator) already exists uncommitted in the working tree. Empirical runtime testing confirms it works for server/pan/local sources, but reveals a real gap for URL sources whose origin server ignores HTTP Range — the most common being `python -m http.server`, which the README itself recommends. This change calibrates the spec to the verified behavior and adds a requirement for server-side Range synthesis in the URL proxy.

## Problem

Users report that large videos "download the entire file before playback starts" and cannot seek. Empirical diagnosis isolates the root cause:

1. **URL sources pointing to Range-incapable servers.** `python -m http.server` (SimpleHTTP/0.6) ignores the `Range` header and returns `200 OK` + the full file. The `/api/http-proxy` route faithfully forwards `Range` upstream and transparently passes back whatever the upstream returns — so when the upstream returns `200` (full file) instead of `206` (partial), the proxy returns the full file too. The browser must buffer it entirely. Verified: a `Range: bytes=0-1023` request through the proxy against `python http.server` returned `200` with all 77,487,291 bytes.
2. **All streaming code is uncommitted.** `git status` shows the Video.js adapter, the three Range-aware routes, and `videojs-player.tsx` as `??`/`M`. A user running the last commit (`dde7733`) would have the old `video-player.tsx` (deleted in the working tree) which may lack these routes.
3. **Video.js CDN may be unreachable** in restricted networks. The native fallback path preserves seek by setting `video.src` directly — but inherits the same upstream-Range dependency, so it does not cure cause #1.

Server (`/api/server-file/stream`), pan (`/api/baidu-pan/stream`), and local (IndexedDB `blob:`) sources are empirically verified to stream and seek correctly.

## Scope

1. Calibrate the OpenSpec artifacts to match verified runtime behavior.
2. Add a normative requirement: the URL proxy MUST synthesize `206`/`Content-Range` server-side when the upstream ignores `Range`, so seek works regardless of origin server capability.
3. Add a requirement that the native fallback path MUST preserve Range-based seek.
4. Reflect the real remaining work in `tasks.md` (commit + verify + the proxy Range-synthesis gap), removing the stale all-`[x]` state.

## Out of Scope

1. Full DRM key-system implementation (gated behind feature flag, not needed for progressive/HLS).
2. Transcoding upstream sources that neither honor Range nor expose a size/seek API — documented as a degraded-mode limitation, not a code deliverable.
3. Guaranteed package installation in restricted registry environments.
