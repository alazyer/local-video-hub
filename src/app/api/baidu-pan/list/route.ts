/**
 * 百度网盘文件列表 API
 * GET /api/baidu-pan/list?dir=/path/to/dir&page=1
 *
 * 百度 API 不返回总条数，因此不提供真实 total：
 * 以 list.length < pageSize 判定已到末页，返回 hasMore 供前端禁用「下一页」。
 */

import { NextRequest, NextResponse } from "next/server";
import { listFiles, isVideoByCategory } from "@/lib/baidu-pan";
import { getPanConfig } from "@/lib/pan-config-store";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 100;

export async function GET(req: NextRequest) {
  const config = getPanConfig();
  if (!config?.accessToken) {
    return NextResponse.json(
      { error: "未配置百度网盘，请先在设置中填写 Access Token" },
      { status: 401 },
    );
  }

  const dir = req.nextUrl.searchParams.get("dir") || "/";
  const page = Math.max(1, parseInt(req.nextUrl.searchParams.get("page") || "1", 10));

  try {
    const data = await listFiles(config, dir, page, PAGE_SIZE);

    if (data.errno !== 0) {
      return NextResponse.json(
        { error: `百度网盘 API 返回错误: errno=${data.errno}` },
        { status: 502 },
      );
    }

    // 百度 API 不返回总条数：返回数 < 每页大小 → 已到末页（无更多）
    const hasMore = data.list.length >= PAGE_SIZE;

    // 分类：目录 / 视频 / 其他
    const dirs = data.list.filter((f) => f.isdir === 1);
    const videos = data.list.filter((f) => f.isdir === 0 && isVideoByCategory(f));
    const others = data.list.filter(
      (f) => f.isdir === 0 && !isVideoByCategory(f),
    );

    return NextResponse.json({
      dir,
      page,
      pageSize: PAGE_SIZE,
      hasMore,
      dirs,
      videos,
      others,
      // 同时返回完整 list，前端可自行筛选
      list: data.list,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
