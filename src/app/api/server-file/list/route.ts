/**
 * 列出服务器本地视频目录
 * GET /api/server-file/list?dir=relative/path
 *
 * 如果不带 dir 参数，返回根目录列表 + 所有配置的根目录信息
 */

import { NextRequest, NextResponse } from "next/server";
import { listDirectory, getVideoRoots } from "@/lib/server-videos";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const dir = req.nextUrl.searchParams.get("dir") || "";

  try {
    // 如果 dir 为空，返回根目录列表
    if (!dir) {
      const roots = getVideoRoots();
      if (roots.length === 0) {
        return NextResponse.json({
          error: "未配置 VIDEO_ROOT 环境变量",
          hint: "请在 .env 中设置 VIDEO_ROOT=/path/to/your/videos",
          items: [],
          root: "",
          relativePath: "",
        });
      }

      // 如果只有一个根目录，直接列出该目录
      if (roots.length === 1) {
        const result = await listDirectory("");
        return NextResponse.json({
          ...result,
          roots: roots.map((r) => ({ path: r, name: r.split("/").pop() || r })),
        });
      }

      // 多根目录：返回虚拟根列表
      return NextResponse.json({
        items: roots.map((r, i) => ({
          name: r.split("/").pop() || `根目录${i + 1}`,
          path: `__root_${i}__`,
          absPath: r,
          size: 0,
          mtime: 0,
          isDirectory: true,
          isVideo: false,
          browserSupported: false,
          ext: "",
        })),
        root: "",
        relativePath: "",
        roots: roots.map((r) => ({ path: r, name: r.split("/").pop() || r })),
      });
    }

    const result = await listDirectory(dir);
    return NextResponse.json({
      ...result,
      roots: getVideoRoots().map((r) => ({
        path: r,
        name: r.split("/").pop() || r,
      })),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
