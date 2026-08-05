/**
 * 百度网盘 OAuth 授权 API
 *
 * 支持两种模式：
 *  1. 手动填 token（推荐开发调试）：直接 POST { accessToken, appKey?, secretKey? }
 *  2. OAuth 跳转授权：
 *     - GET ?action=authorize  → 返回授权 URL
 *     - POST { code, redirectUri } → 用 code 换 token
 */

import { NextRequest, NextResponse } from "next/server";
import {
  buildOAuthUrl,
  exchangeCodeForToken,
} from "@/lib/baidu-pan";
import { setPanConfig, getPanConfig } from "@/lib/pan-config-store";

export const dynamic = "force-dynamic";

/** GET /api/baidu-pan/auth → 返回 OAuth 授权 URL */
export async function GET(req: NextRequest) {
  const action = req.nextUrl.searchParams.get("action");
  const appKey = req.nextUrl.searchParams.get("appKey");
  const redirectUri =
    req.nextUrl.searchParams.get("redirectUri") ||
    `${req.nextUrl.origin}/api/baidu-pan/auth/callback`;

  if (action === "status") {
    const config = getPanConfig();
    return NextResponse.json({
      configured: !!config?.accessToken,
      hasAppKey: !!config?.appKey,
      tokenExpired: config
        ? Date.now() > (config.expiresAt ?? 0) - 5 * 60 * 1000
        : true,
      expiresAt: config?.expiresAt,
    });
  }

  if (action === "authorize") {
    if (!appKey) {
      return NextResponse.json(
        { error: "缺少 appKey 参数" },
        { status: 400 },
      );
    }
    const url = buildOAuthUrl(appKey, redirectUri);
    return NextResponse.json({ authorizeUrl: url });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}

/** POST /api/baidu-pan/auth → 设置/换取 token */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    // 模式 1: 手动填 token
    if (body.accessToken) {
      setPanConfig({
        appId: body.appId || "",
        appKey: body.appKey || "",
        secretKey: body.secretKey || "",
        accessToken: body.accessToken,
        refreshToken: body.refreshToken,
        expiresAt: body.expiresAt,
      });
      return NextResponse.json({ ok: true, mode: "manual" });
    }

    // 模式 2: OAuth code 换 token
    if (body.code) {
      const existing = getPanConfig();
      if (!existing?.appKey || !existing?.secretKey) {
        return NextResponse.json(
          { error: "请先设置 AppKey 和 SecretKey" },
          { status: 400 },
        );
      }
      const result = await exchangeCodeForToken(
        existing.appKey,
        existing.secretKey,
        body.code,
        body.redirectUri,
      );
      setPanConfig({
        ...existing,
        accessToken: result.access_token,
        refreshToken: result.refresh_token,
        expiresAt: result.expires_at,
      });
      return NextResponse.json({ ok: true, mode: "oauth", expiresAt: result.expires_at });
    }

    return NextResponse.json(
      { error: "请求体必须包含 accessToken 或 code" },
      { status: 400 },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/** DELETE /api/baidu-pan/auth → 清除配置 */
export async function DELETE() {
  setPanConfig(null);
  return NextResponse.json({ ok: true });
}
