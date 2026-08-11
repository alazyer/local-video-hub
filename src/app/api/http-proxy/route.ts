/**
 * HTTP 视频流代理
 * GET /api/http-proxy?url=xxx
 *
 * 用途：当用户输入的 URL 跨域且目标服务器不返 CORS 头时，
 * 浏览器可以播放但 <video> 进度条无法 seek。
 * 此时通过本代理转发，补充 CORS 头并透传 Range。
 *
 * 安全：
 *  - 仅允许 http/https 协议（拒绝 file://、data:// 等）
 *  - 默认不允许访问本机内网地址（防止 SSRF），可通过 ALLOW_PRIVATE_NETWORK=true 开启
 *
 * 实现：用 Node.js 原生 http/https 模块（避免 fetch 在某些环境对 localhost 解析问题）
 *
 * 用法：
 *  - 前端直连：video.src = "http://localhost:8000/a.mp4"  // 简单，但跨域时 seek 可能受限
 *  - 前端代理：video.src = `/api/http-proxy?url=${encodeURIComponent("http://localhost:8000/a.mp4")}`
 */

import { NextRequest } from "next/server";
import http from "http";
import https from "https";
import { Readable } from "stream";
import {
  parseClientRange,
  formatContentRange,
  createRangeSlicingStream,
} from "@/lib/http-proxy-range";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function inferManifestMimeType(pathname: string): string | null {
  const lower = pathname.toLowerCase();
  if (lower.endsWith(".m3u8")) return "application/vnd.apple.mpegurl";
  if (lower.endsWith(".mpd")) return "application/dash+xml";
  return null;
}

/** 解析目标 URL 并校验安全性 */
function parseTargetUrl(urlStr: string): URL | null {
  let u: URL;
  try {
    u = new URL(urlStr);
  } catch {
    return null;
  }
  if (!["http:", "https:"].includes(u.protocol)) return null;
  return u;
}

/**
 * 检查是否允许访问目标地址（防 SSRF）
 *
 * 默认拒绝私网地址（127.0.0.1 / 10.x / 192.168.x / 172.16-31.x 等）。
 * 用户在 .env 中设置 ALLOW_PRIVATE_NETWORK=true 可放开。
 */
function isAddressAllowed(hostname: string): boolean {
  const allowPrivate =
    process.env.ALLOW_PRIVATE_NETWORK === "true" ||
    process.env.ALLOW_PRIVATE_NETWORK === "1";

  if (allowPrivate) return true;

  // IPv4
  const ipv4Match = hostname.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (ipv4Match) {
    const [, a, b] = ipv4Match.map(Number) as unknown as number[];
    if (a === 10) return false;
    if (a === 127) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 0) return false;
    return true;
  }
  if (hostname === "::1" || hostname === "[::1]") return false;
  if (hostname.startsWith("fe80")) return false;
  if (hostname.startsWith("fc") || hostname.startsWith("fd")) return false;
  if (hostname === "localhost" || hostname.endsWith(".localhost")) return false;
  return true;
}

/**
 * 用 Node 原生 http/https 模块请求目标 URL，返回 ReadableStream + headers + status
 *
 * 关键：强制 family=4（IPv4），避免 Node 把 localhost 解析为 IPv6 ::1 后连接失败
 * （常见场景：python http.server 默认只 bind IPv4）
 */
function fetchViaNode(
  target: URL,
  headers: Record<string, string>,
): Promise<{
  status: number;
  statusText: string;
  headers: Record<string, string | string[] | undefined>;
  body: Readable;
}> {
  return new Promise((resolve, reject) => {
    const isHttps = target.protocol === "https:";
    const lib = isHttps ? https : http;
    // 把 hostname 中的 [] 去掉（IPv6 字面量）
    const host = target.hostname.replace(/^\[|\]$/g, "");

    const options: https.RequestOptions = {
      hostname: host,
      port: target.port || (isHttps ? 443 : 80),
      path: target.pathname + target.search,
      method: "GET",
      headers,
      family: 4, // 强制 IPv4，避免 localhost 解析为 ::1 失败
    };

    const req = lib.request(options, (res) => {
      resolve({
        status: res.statusCode || 200,
        statusText: res.statusMessage || "",
        headers: res.headers as Record<string, string | string[] | undefined>,
        body: res,
      });
    });

    req.on("error", reject);
    req.setTimeout(15000, () => {
      req.destroy(new Error("request timeout (15s)"));
    });
    req.end();
  });
}

export async function GET(req: NextRequest) {
  const targetUrl = req.nextUrl.searchParams.get("url");
  if (!targetUrl) {
    return new Response("Missing url parameter", { status: 400 });
  }

  const target = parseTargetUrl(targetUrl);
  if (!target) {
    return new Response("Invalid url (only http/https allowed)", {
      status: 400,
    });
  }

  if (!isAddressAllowed(target.hostname)) {
    return new Response(
      "Target address not allowed (private network blocked). " +
        "Set ALLOW_PRIVATE_NETWORK=true in .env to allow.",
      { status: 403 },
    );
  }

  // 构造转发请求头
  const upstreamHeaders: Record<string, string> = {
    Accept: "*/*",
    "User-Agent": "Mozilla/5.0 (compatible; VideoPlayerProxy/1.0)",
  };
  const range = req.headers.get("range");
  if (range) {
    upstreamHeaders["Range"] = range;
  }

  try {
    const { status, headers: upstreamHeadersRaw, body } = await fetchViaNode(
      target,
      upstreamHeaders,
    );

    if (status >= 400 && status !== 416) {
      return new Response(`Upstream returned ${status}`, { status });
    }

    // 构造响应头：透传 + 补 CORS
    const respHeaders = new Headers();
    const passthroughHeaders = [
      "content-type",
      "content-length",
      "content-range",
      "accept-ranges",
      "last-modified",
      "etag",
      "cache-control",
      "expires",
    ];
    for (const h of passthroughHeaders) {
      const v = upstreamHeadersRaw[h];
      if (v) {
        respHeaders.set(h, Array.isArray(v) ? v[0] : v);
      }
    }
    const manifestMimeType = inferManifestMimeType(target.pathname);
    if (manifestMimeType) {
      respHeaders.set("content-type", manifestMimeType);
    }
    if (!respHeaders.has("content-type")) {
      respHeaders.set("content-type", "application/octet-stream");
    }
    if (!respHeaders.has("accept-ranges")) {
      respHeaders.set("accept-ranges", "bytes");
    }
    respHeaders.set("access-control-allow-origin", "*");
    respHeaders.set("access-control-allow-methods", "GET, HEAD, OPTIONS");
    respHeaders.set("access-control-allow-headers", "Range");
    respHeaders.set(
      "access-control-expose-headers",
      "Content-Range, Content-Length, Accept-Ranges",
    );
    // 允许浏览器按字节分段缓存（边下边播时更友好），
    // 若上游未提供缓存策略，则给一个温和的默认值。
    if (!respHeaders.has("cache-control")) {
      respHeaders.set("cache-control", "public, max-age=3600, stale-while-revalidate=86400");
    }
    // Range 请求和非 Range 请求应区分缓存键。
    respHeaders.set("vary", "Range");
    if (manifestMimeType) {
      respHeaders.set("x-streaming-diagnostic", "manifest-proxied-with-cors");
    }

    const webStream = nodeStreamToWebStream(body);

    // ── 服务端 Range 合成 ─────────────────────────────────────────────
    // 当客户端发送了 Range 但上游返回 200（忽略 Range，整文件下载）时，
    // 代理自行切片合成 206/Content-Range，只输出请求的字节窗口。
    // 上游已返回 206 时保持透明透传不变（不重复切片）。
    const clientRange = range;
    const upstreamIgnoredRange =
      clientRange && status === 200 && !respHeaders.has("content-range");

    if (clientRange && upstreamIgnoredRange) {
      const upstreamContentLength = respHeaders.get("content-length");
      const total =
        upstreamContentLength != null
          ? parseInt(upstreamContentLength, 10)
          : null;

      const rangeParsed = parseClientRange(clientRange, total);

      if (rangeParsed) {
        const { start, end } = rangeParsed;
        const windowSize = end - start + 1;

        // 覆盖响应为合成 206
        respHeaders.set("content-range", formatContentRange(start, end, total));
        respHeaders.set("content-length", String(windowSize));
        respHeaders.set("accept-ranges", "bytes");
        // 200 整文件响应不应被 Range 合成结果缓存命中为不同请求
        respHeaders.set("cache-control", "no-store");
        respHeaders.delete("vary");
        respHeaders.set("vary", "Range");
        respHeaders.set("x-streaming-diagnostic", "range-synthesized");

        // 切片流：丢弃 start 前字节，输出窗口字节，输出 end 后取消上游读取
        const slicingStream = createRangeSlicingStream(start, end, () => {
          // 输出窗口后销毁上游 node stream，停止读取剩余字节
          try {
            body.destroy();
          } catch {
            // 已销毁，忽略
          }
        });

        const synthesized = webStream.pipeThrough(slicingStream);

        return new Response(synthesized, {
          status: 206,
          statusText: "Partial Content",
          headers: respHeaders,
        });
      }
      // 无效/畸形 Range → 回退到下方 200 透传
    }
    // ──────────────────────────────────────────────────────────────

    return new Response(webStream, {
      status,
      headers: respHeaders,
    });
  } catch (e) {
    const err = e as Error & { code?: string; cause?: Error };
    const msg = err.message || String(e);
    const code = err.code || "";
    console.error("[http-proxy] failed:", JSON.stringify({ msg, code, cause: err.cause?.message }), "url:", target.toString());
    return new Response(`Proxy failed: ${msg}${code ? ` (code: ${code})` : ""}`, { status: 502 });
  }
}

/** 处理 CORS 预检 */
export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, HEAD, OPTIONS",
      "access-control-allow-headers": "Range",
      "access-control-max-age": "86400",
    },
  });
}

/**
 * Node ReadableStream → Web ReadableStream
 * 加 closed 标记防御 cancel 后再触发事件导致 Fast Refresh 全量重载
 */
function nodeStreamToWebStream(
  nodeStream: Readable,
): ReadableStream<Uint8Array> {
  let closed = false;

  return new ReadableStream({
    start(controller) {
      nodeStream.on("data", (chunk: Buffer) => {
        if (closed) return;
        try {
          controller.enqueue(new Uint8Array(chunk));
        } catch (e) {
          closed = true;
          console.debug("[http-proxy] enqueue after close:", e);
        }
      });
      nodeStream.on("end", () => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch (e) {
          console.debug("[http-proxy] close after close:", e);
        }
      });
      nodeStream.on("error", (err: Error) => {
        if (closed) return;
        closed = true;
        try {
          controller.error(err);
        } catch (e) {
          console.debug("[http-proxy] error after close:", e);
        }
      });
    },
    cancel() {
      closed = true;
      nodeStream.destroy();
    },
  });
}
