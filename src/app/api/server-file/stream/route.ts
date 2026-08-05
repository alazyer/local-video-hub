/**
 * 服务器本地视频流代理
 * GET /api/server-file/stream?path=relative/path/to/video.mp4
 *
 * 安全：
 *  - 路径必须解析到 VIDEO_ROOT 配置的根目录下
 *  - 拒绝包含 .. / 绝对路径 / 空字节的输入
 *
 * 流式：
 *  - 透传 Range 头，支持视频拖动进度条
 *  - 返回 206 Partial Content + Content-Range
 *  - 用 fs.createReadStream 流式读取，不缓冲整个文件到内存
 *
 * CORS：
 *  - 补充 CORS 头，允许局域网内任意浏览器访问
 */

import { NextRequest } from "next/server";
import { createReadStream } from "fs";
import { stat } from "fs/promises";
import path from "path";
import type { Readable } from "stream";
import {
  resolveSafePath,
  getMimeType,
  parseRange,
} from "@/lib/server-videos";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const filePath = req.nextUrl.searchParams.get("path");

  if (!filePath) {
    return new Response("Missing path parameter", { status: 400 });
  }

  // 1. 安全检查：路径必须解析到允许的根目录下
  const absPath = resolveSafePath(filePath);
  if (!absPath) {
    return new Response("Forbidden: path outside allowed roots", { status: 403 });
  }

  // 2. 获取文件信息
  let fileStat;
  try {
    fileStat = await stat(absPath);
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === "ENOENT") {
      return new Response("File not found", { status: 404 });
    }
    if (err.code === "EACCES") {
      return new Response("Permission denied", { status: 403 });
    }
    return new Response(`Stat failed: ${err.message}`, { status: 500 });
  }

  if (!fileStat.isFile()) {
    return new Response("Not a file", { status: 400 });
  }

  // 3. 解析 Range
  const fileSize = fileStat.size;
  const range = parseRange(req.headers.get("range"), fileSize);
  const ext = path.extname(absPath).slice(1);
  const contentType = getMimeType(ext);

  // 4. 构造响应头
  const headers = new Headers();
  headers.set("Content-Type", contentType);
  headers.set("Accept-Ranges", "bytes");
  headers.set("Last-Modified", fileStat.mtime.toUTCString());
  // 缓存：文件不大变，但 Range 不同，所以用 no-store 兜底
  headers.set("Cache-Control", "no-store");
  // CORS：允许局域网内任意源访问
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Range");
  headers.set(
    "Access-Control-Expose-Headers",
    "Content-Range, Content-Length, Accept-Ranges",
  );

  // 5. 处理 Range 请求 vs 完整文件
  if (range) {
    // 206 Partial Content
    const { start, end } = range;
    const chunkSize = end - start + 1;
    headers.set("Content-Range", `bytes ${start}-${end}/${fileSize}`);
    headers.set("Content-Length", String(chunkSize));

    const stream = createReadStream(absPath, { start, end });
    const webStream = nodeStreamToWebStream(stream);

    return new Response(webStream, {
      status: 206,
      statusText: "Partial Content",
      headers,
    });
  } else {
    // 200 OK - 完整文件
    headers.set("Content-Length", String(fileSize));
    const stream = createReadStream(absPath);
    const webStream = nodeStreamToWebStream(stream);

    return new Response(webStream, {
      status: 200,
      headers,
    });
  }
}

/** 处理 CORS 预检 */
export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
      "Access-Control-Allow-Headers": "Range",
      "Access-Control-Max-Age": "86400",
    },
  });
}

/**
 * 将 Node.js ReadableStream 转换为 Web ReadableStream
 *
 * 关键防御点：
 *  - 用 closed 标记防止 controller 已 close/cancel 后再调用 enqueue/error（会抛 TypeError）
 *  - 这种 TypeError 在 React Dev 模式下会被 Fast Refresh 捕获，触发页面全量重载
 *  - 当用户切换视频/拖动进度条时浏览器会取消 stream，必须优雅处理
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
          // controller 可能已被 close，忽略
          closed = true;
          console.debug("enqueue after close, ignoring:", e);
        }
      });
      nodeStream.on("end", () => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch (e) {
          console.debug("close after close, ignoring:", e);
        }
      });
      nodeStream.on("error", (err: Error) => {
        if (closed) return;
        closed = true;
        try {
          controller.error(err);
        } catch (e) {
          console.debug("error after close, ignoring:", e);
        }
      });
    },
    cancel() {
      closed = true;
      // destroy 时不再 emit error 事件（避免触发上面的 error 处理）
      nodeStream.destroy();
    },
  });
}
