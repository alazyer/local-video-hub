/**
 * 百度网盘开放平台 API 封装
 *
 * 文档：https://pan.baidu.com/union/doc
 *
 * 关键接口：
 *  - OAuth 授权：https://openapi.baidu.com/oauth/2.0/authorize
 *  - 换取 token：https://openapi.baidu.com/oauth/2.0/token
 *  - 文件列表：https://pan.baidu.com/rest/2.0/xpan/multimedia?method=list
 *  - 文件详情（dlink）：https://pan.baidu.com/rest/2.0/xpan/multimedia?method=filemetas
 *
 * 直链获取后需带 User-Agent: pan.baidu.com 才能访问（>20MB 文件强校验）
 * 因此必须由后端流代理转发，浏览器无法直接播放。
 */

export interface BaiduPanConfig {
  appId: string;
  appKey: string;
  secretKey: string;
  accessToken: string;
  refreshToken?: string;
  /** token 过期时间戳（毫秒） */
  expiresAt?: number;
}

export interface BaiduPanFileInfo {
  fs_id: number | string;
  path: string;
  server_filename: string;
  size: number;
  isdir: number; // 0 文件 / 1 目录
  category: number; // 文件分类，6 = 视频
  thumbnail?: string; // 缩略图 URL（小图）
  thumburl?: string; // 缩略图 URL（大图）
  dir_empty?: number;
}

export interface BaiduPanListResponse {
  errno: number;
  list: BaiduPanFileInfo[];
  guid?: string;
}

export interface BaiduPanDlinkResponse {
  errno: number;
  list: Array<{
    fs_id: number | string;
    dlink: string;
    filename: string;
    size: number;
  }>;
}

/** 网盘开放平台 API 基础地址 */
const API_BASE = "https://pan.baidu.com";

/** 检查 token 是否过期（提前 5 分钟刷新） */
export function isTokenExpired(config: BaiduPanConfig): boolean {
  if (!config.expiresAt) return true;
  return Date.now() > config.expiresAt - 5 * 60 * 1000;
}

/**
 * 构造 OAuth 授权 URL（前端跳转用）
 * 文档：https://pan.baidu.com/union/doc/fl1ka3mqf
 */
export function buildOAuthUrl(
  appKey: string,
  redirectUri: string,
  state: string = "baidu-pan-auth",
): string {
  const params = new URLSearchParams({
    client_id: appKey,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "basic,netdisk",
    q: "force",
    state,
  });
  return `https://openapi.baidu.com/oauth/2.0/authorize?${params.toString()}`;
}

/**
 * 用授权码换取 access_token（后端调用）
 * 文档：https://pan.baidu.com/union/doc/fl1ka3mqf
 */
export async function exchangeCodeForToken(
  appKey: string,
  secretKey: string,
  code: string,
  redirectUri: string,
): Promise<{
  access_token: string;
  refresh_token: string;
  expires_in: number;
  expires_at: number;
}> {
  const url = `${API_BASE}/oauth/2.0/token`;
  const params = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    client_id: appKey,
    client_secret: secretKey,
    redirect_uri: redirectUri,
  });
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  if (!res.ok) {
    throw new Error(`换取 token 失败: HTTP ${res.status}`);
  }
  const data = await res.json();
  if (data.error) {
    throw new Error(`换取 token 失败: ${data.error} - ${data.error_description}`);
  }
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_in: data.expires_in,
    expires_at: Date.now() + data.expires_in * 1000,
  };
}

/**
 * 列出指定目录下的文件
 * 文档：https://pan.baidu.com/union/doc/al0rwqzzr
 */
export async function listFiles(
  config: BaiduPanConfig,
  dir: string = "/",
  page: number = 1,
  pageSize: number = 100,
): Promise<BaiduPanListResponse> {
  const url = new URL(`${API_BASE}/rest/2.0/xpan/multimedia`);
  url.searchParams.set("method", "list");
  url.searchParams.set("access_token", config.accessToken);
  url.searchParams.set("dir", dir);
  url.searchParams.set("order", "time"); // 按时间倒序
  url.searchParams.set("start", String((page - 1) * pageSize));
  url.searchParams.set("limit", String(pageSize));
  url.searchParams.set("web", "1"); // web=1 时返回缩略图字段
  url.searchParams.set("folder", "0"); // folder=0 不返回子目录中的文件

  const res = await fetch(url.toString(), {
    headers: {
      "User-Agent": "pan.baidu.com",
    },
  });
  if (!res.ok) {
    throw new Error(`列出文件失败: HTTP ${res.status}`);
  }
  return res.json();
}

/**
 * 获取文件的下载直链（dlink）
 * 文档：https://pan.baidu.com/union/doc/al0rwqzzr
 */
export async function getFileDlink(
  config: BaiduPanConfig,
  fsId: number | string,
): Promise<string> {
  const url = new URL(`${API_BASE}/rest/2.0/xpan/multimedia`);
  url.searchParams.set("method", "filemetas");
  url.searchParams.set("access_token", config.accessToken);
  url.searchParams.set("fsids", `[${fsId}]`);
  url.searchParams.set("dlink", "1");

  const res = await fetch(url.toString(), {
    headers: {
      "User-Agent": "pan.baidu.com",
    },
  });
  if (!res.ok) {
    throw new Error(`获取直链失败: HTTP ${res.status}`);
  }
  const data: BaiduPanDlinkResponse = await res.json();
  if (data.errno !== 0 || !data.list || data.list.length === 0) {
    throw new Error(`获取直链失败: errno=${data.errno}`);
  }
  // dlink 需要追加 access_token 才能访问
  const dlink = data.list[0].dlink;
  return `${dlink}&access_token=${config.accessToken}`;
}

/** 判断文件是否为视频（按 category 或扩展名） */
export function isVideoByCategory(file: BaiduPanFileInfo): boolean {
  if (file.category === 6) return true;
  return /\.(mp4|webm|ogg|mov|m4v|mkv|avi|flv|wmv|3gp|ts|rmvb|rm)$/i.test(
    file.server_filename,
  );
}

/** 格式化时长为 mm:ss 或 hh:mm:ss（用于网盘视频，虽然没有时长字段，预留） */
export function formatPanDuration(seconds: number): string {
  if (!isFinite(seconds) || seconds <= 0) return "00:00";
  const s = Math.floor(seconds % 60);
  const m = Math.floor((seconds / 60) % 60);
  const h = Math.floor(seconds / 3600);
  const pad = (n: number) => String(n).padStart(2, "0");
  if (h > 0) return `${pad(h)}:${pad(m)}:${pad(s)}`;
  return `${pad(m)}:${pad(s)}`;
}

/** 格式化文件大小 */
export function formatPanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
