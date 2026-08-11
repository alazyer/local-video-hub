/**
 * 百度网盘视频流代理
 *
 * 这是整个网盘视频播放方案的核心。由于百度 CDN：
 *  1. 对 >20MB 文件强制校验 User-Agent: pan.baidu.com（浏览器无法自定义）
 *  2. 不返回 CORS 头，浏览器跨域加载会失败
 *  3. 有 Referer 防盗链
 *
 * 所以后端必须作为流代理：
 *  - 接收前端 <video> 的请求（含 Range 头用于拖动进度条）
 *  - 用正确 UA 请求百度 CDN
 *  - 将响应流式转发回前端，并补充 CORS 头
 *  - 透传 Content-Range / Accept-Ranges / Content-Length
 *
 * URL 格式：
 *   GET /api/baidu-pan/stream?fsId=123456789
 *   GET /api/baidu-pan/stream?fsId=123456789
 *   Headers: Range: bytes=0-1048575
 */

import { NextRequest } from "next/server";
import { getFileDlink } from "@/lib/baidu-pan";
import { getPanConfig } from "@/lib/pan-config-store";

export const dynamic = "force-dynamic";

// 禁用 body 解析，纯流式转发
export const runtime = "nodejs";

// 直链缓存（避免每次拖进度都重新获取 dlink）
interface DlinkCacheEntry {
  dlink: string;
  expireAt: number;
}
const dlinkCache = new Map<string, DlinkCacheEntry>();
const DLINK_CACHE_TTL = 7 * 60 * 60 * 1000; // 7 小时（百度直链 8 小时过期，留 1h 余量）

function inferManifestMimeType(url: string): string | null {
  const lower = url.toLowerCase();
  if (lower.includes(".m3u8")) return "application/vnd.apple.mpegurl";
  if (lower.includes(".mpd")) return "application/dash+xml";
  return null;
}

async function getCachedDlink(fsId: string): Promise<string> {
  const cached = dlinkCache.get(fsId);
  if (cached && Date.now() < cached.expireAt) {
    return cached.dlink;
  }
  const config = getPanConfig();
  if (!config?.accessToken) {
    throw new Error("未配置百度网盘");
  }
  const dlink = await getFileDlink(config, fsId);
  dlinkCache.set(fsId, {
    dlink,
    expireAt: Date.now() + DLINK_CACHE_TTL,
  });
  return dlink;
}

export async function GET(req: NextRequest) {
  const fsId = req.nextUrl.searchParams.get("fsId");
  if (!fsId) {
    return new Response("Missing fsId", { status: 400 });
  }

  const config = getPanConfig();
  if (!config?.accessToken) {
    return new Response("未配置百度网盘，请先在设置中填写 Access Token", {
      status: 401,
    });
  }

  try {
    // 1. 获取直链（带缓存）
    const dlink = await getCachedDlink(fsId);

    // 2. 构造转发请求头（核心：必须带 pan.baidu.com UA）
    const upstreamHeaders: Record<string, string> = {
      "User-Agent": "pan.baidu.com",
      // 透传 Range 头，支持视频拖动进度条
      Accept: "*/*",
    };

    const range = req.headers.get("range");
    if (range) {
      upstreamHeaders["Range"] = range;
    }

    // 3. 请求百度 CDN
    const upstreamRes = await fetch(dlink, {
      headers: upstreamHeaders,
      redirect: "follow",
    });

    if (!upstreamRes.ok && upstreamRes.status !== 206) {
      const errText = await upstreamRes.text().catch(() => "");
      return new Response(
        `百度 CDN 请求失败: HTTP ${upstreamRes.status}\n${errText.slice(0, 500)}`,
        { status: upstreamRes.status },
      );
    }

    // 4. 构造响应头：透传视频相关头 + 补充 CORS
    const respHeaders = new Headers();
    const passthroughHeaders = [
      "content-type",
      "content-length",
      "content-range",
      "accept-ranges",
      "last-modified",
      "etag",
    ];
    for (const h of passthroughHeaders) {
      const v = upstreamRes.headers.get(h);
      if (v) {
        respHeaders.set(h, v);
      }
    }
    // 默认 Content-Type 兜底
    const manifestMimeType = inferManifestMimeType(dlink);
    if (manifestMimeType) {
      respHeaders.set("content-type", manifestMimeType);
      respHeaders.set("x-streaming-diagnostic", "manifest-proxied-with-cors");
    } else if (!respHeaders.has("content-type")) {
      respHeaders.set("content-type", "video/mp4");
    }
    // 必须声明支持 Range，否则 <video> 不能拖动
    if (!respHeaders.has("accept-ranges")) {
      respHeaders.set("accept-ranges", "bytes");
    }
    // CORS 头
    respHeaders.set("access-control-allow-origin", "*");
    respHeaders.set("access-control-allow-methods", "GET, HEAD, OPTIONS");
    respHeaders.set("access-control-allow-headers", "Range");
    respHeaders.set("access-control-expose-headers", "Content-Range, Content-Length");
    // 缓存策略：不缓存，因为每次 Range 不同
    respHeaders.set("cache-control", "no-store");

    // 5. 流式转发 body
    if (!upstreamRes.body) {
      return new Response("Upstream returned no body", { status: 502 });
    }

    return new Response(upstreamRes.body, {
      status: upstreamRes.status,
      statusText: upstreamRes.statusText,
      headers: respHeaders,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(`流代理失败: ${msg}`, { status: 500 });
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
