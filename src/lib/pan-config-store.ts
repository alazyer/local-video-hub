/**
 * 百度网盘配置存储（服务端）
 *
 * ⚠️ 注意：这是一个简化的内存存储实现，仅用于演示和单机部署。
 * 生产环境应该用数据库（如 Prisma + SQLite/PostgreSQL）存储用户配置，
 * 并且 secret_key 必须加密存储，不能明文。
 *
 * 由于网盘配置本质上是 per-user 的，且本应用是单用户本地播放器场景，
 * 内存存储在单实例部署下足够使用。重启服务后会丢失，建议改用持久化存储。
 */

import type { BaiduPanConfig } from "@/lib/baidu-pan";

// 单用户配置（单实例内存）
let currentConfig: BaiduPanConfig | null = null;

export function getPanConfig(): BaiduPanConfig | null {
  return currentConfig;
}

export function setPanConfig(config: BaiduPanConfig | null): void {
  currentConfig = config;
}

export function updatePanConfig(patch: Partial<BaiduPanConfig>): BaiduPanConfig | null {
  if (!currentConfig) return null;
  currentConfig = { ...currentConfig, ...patch };
  return currentConfig;
}

/**
 * 从请求头中读取配置（备用方案：客户端把 token 放 header）
 * 适用于多用户场景，每个请求带自己的 token。
 */
export function getConfigFromRequest(req: Request): BaiduPanConfig | null {
  const appId = req.headers.get("x-pan-app-id");
  const appKey = req.headers.get("x-pan-app-key");
  const secretKey = req.headers.get("x-pan-secret-key");
  const accessToken = req.headers.get("x-pan-access-token");

  if (!accessToken) return null;
  return {
    appId: appId || "",
    appKey: appKey || "",
    secretKey: secretKey || "",
    accessToken,
  };
}
