/**
 * URL 视频管理（纯客户端，localStorage 持久化）
 *
 * 用于添加任意 HTTP/HTTPS 视频地址，例如：
 *  - 本地 python http.server: http://localhost:8000/a.mp4
 *  - 局域网 NAS: http://192.168.1.100/videos/lesson.mp4
 *  - 公网 CDN: https://example.com/path/to/video.mp4
 *
 * 与"本地视频"（IndexedDB）/"服务器视频"（VIDEO_ROOT）/"网盘视频"（百度 API）不同，
 * URL 视频不存储文件本身，只存储地址，由 <video> 直接加载。
 */

const STORAGE_KEY = "video-player:url-videos";

export interface UrlVideo {
  /** 唯一 ID */
  id: string;
  /** 显示名称（用户可自定义，默认从 URL 推导） */
  name: string;
  /** 视频 URL */
  url: string;
  /** 添加时间戳 */
  addedAt: number;
  /** 最近播放时间戳 */
  lastPlayedAt?: number;
  /** 上次播放位置（秒），用于断点续播 */
  lastPosition?: number;
  /** 上次播放时长（秒） */
  duration?: number;
  /** 备注（可选） */
  note?: string;
}

/** 生成唯一 ID */
function generateId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `url-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/** 从 URL 推导默认名称（取最后一段路径） */
export function deriveNameFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const pathname = u.pathname;
    const last = pathname.split("/").filter(Boolean).pop();
    if (last) {
      return decodeURIComponent(last);
    }
    return u.hostname;
  } catch {
    return url.slice(-30);
  }
}

/** 验证 URL 是否合法 */
export function isValidVideoUrl(url: string): {
  valid: boolean;
  reason?: string;
} {
  if (!url || !url.trim()) {
    return { valid: false, reason: "URL 不能为空" };
  }
  try {
    const u = new URL(url.trim());
    if (!["http:", "https:"].includes(u.protocol)) {
      return {
        valid: false,
        reason: `仅支持 http/https 协议，当前为 ${u.protocol}`,
      };
    }
    return { valid: true };
  } catch {
    return { valid: false, reason: "URL 格式不合法" };
  }
}

/** 判断 URL 是否同源（决定是否需要走代理） */
export function isSameOrigin(url: string): boolean {
  try {
    const u = new URL(url);
    if (typeof window === "undefined") return false;
    return u.origin === window.location.origin;
  } catch {
    return false;
  }
}

/** 读取所有 URL 视频 */
export function loadUrlVideos(): UrlVideo[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as UrlVideo[];
  } catch (e) {
    console.warn("读取 URL 视频失败", e);
    return [];
  }
}

/** 保存所有 URL 视频 */
export function saveUrlVideos(videos: UrlVideo[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(videos));
  } catch (e) {
    console.warn("保存 URL 视频失败", e);
  }
}

/** 添加一个 URL 视频 */
export function addUrlVideo(
  url: string,
  name?: string,
  note?: string,
): { success: boolean; video?: UrlVideo; error?: string } {
  const validation = isValidVideoUrl(url);
  if (!validation.valid) {
    return { success: false, error: validation.reason };
  }

  const trimmedUrl = url.trim();
  const existing = loadUrlVideos();
  // 去重：URL 相同则不重复添加
  if (existing.some((v) => v.url === trimmedUrl)) {
    return { success: false, error: "该 URL 已存在" };
  }

  const video: UrlVideo = {
    id: generateId(),
    name: name?.trim() || deriveNameFromUrl(trimmedUrl),
    url: trimmedUrl,
    addedAt: Date.now(),
    note: note?.trim() || undefined,
  };

  saveUrlVideos([video, ...existing]);
  return { success: true, video };
}

/** 删除一个 URL 视频 */
export function deleteUrlVideo(id: string): void {
  const existing = loadUrlVideos();
  saveUrlVideos(existing.filter((v) => v.id !== id));
}

/** 更新 URL 视频（合并） */
export function updateUrlVideo(
  id: string,
  patch: Partial<UrlVideo>,
): void {
  const existing = loadUrlVideos();
  const idx = existing.findIndex((v) => v.id === id);
  if (idx < 0) return;
  existing[idx] = { ...existing[idx], ...patch };
  saveUrlVideos(existing);
}

/** 清空全部 */
export function clearAllUrlVideos(): void {
  saveUrlVideos([]);
}
