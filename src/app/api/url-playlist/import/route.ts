import { NextRequest, NextResponse } from "next/server";
import { fetchRemotePlaylist } from "@/lib/url-playlist-import";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface ImportRequestBody {
  url?: string;
}

export async function POST(req: NextRequest) {
  let body: ImportRequestBody;

  try {
    body = (await req.json()) as ImportRequestBody;
  } catch {
    return NextResponse.json({ error: "请求体必须是合法 JSON" }, { status: 400 });
  }

  const url = typeof body.url === "string" ? body.url.trim() : "";
  if (!url) {
    return NextResponse.json({ error: "url 不能为空" }, { status: 400 });
  }

  const result = await fetchRemotePlaylist(url);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({ payload: result.payload });
}
