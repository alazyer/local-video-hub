/**
 * 服务器本地视频文件的常量和工具函数（客户端/服务端共用）
 *
 * 不依赖 Node.js 的 fs/path 模块，可在客户端代码中安全引入。
 * 所有需要 fs/path 的逻辑放在 server-videos.ts 中（仅服务端使用）。
 */

/** 视频扩展名白名单 */
export const VIDEO_EXTENSIONS = [
  "mp4",
  "webm",
  "ogg",
  "ogv",
  "mov",
  "m4v",
  "mkv",
  "avi",
  "flv",
  "wmv",
  "3gp",
  "ts",
  "rmvb",
  "rm",
];

/** 浏览器原生支持的视频扩展名（无需转码） */
export const BROWSER_NATIVE_EXTENSIONS = [
  "mp4",
  "webm",
  "ogg",
  "ogv",
  "mov",
  "m4v",
];

/** 文件信息（前端可见的形态） */
export interface VideoFileInfo {
  name: string;
  /** 相对于根目录的路径（用于前端引用） */
  path: string;
  size: number;
  mtime: number;
  isDirectory: boolean;
  isVideo: boolean;
  /** 浏览器是否原生支持 */
  browserSupported: boolean;
  /** 扩展名（小写无点） */
  ext: string;
}

/** MIME 类型映射 */
export function getMimeType(ext: string): string {
  const e = ext.toLowerCase().replace(/^\./, "");
  switch (e) {
    case "mp4":
    case "m4v":
      return "video/mp4";
    case "webm":
      return "video/webm";
    case "ogg":
    case "ogv":
      return "video/ogg";
    case "mov":
      return "video/quicktime";
    case "mkv":
      return "video/x-matroska";
    case "avi":
      return "video/x-msvideo";
    case "flv":
      return "video/x-flv";
    case "wmv":
      return "video/x-ms-wmv";
    case "3gp":
      return "video/3gpp";
    case "ts":
      return "video/mp2t";
    case "rmvb":
    case "rm":
      return "application/vnd.rn-realmedia-vbr";
    default:
      return "application/octet-stream";
  }
}

/** 解析 Range 头 */
export function parseRange(
  range: string | null,
  fileSize: number,
): { start: number; end: number } | null {
  if (!range || !range.startsWith("bytes=")) return null;
  const parts = range.slice(6).split("-");
  const start = parseInt(parts[0], 10);
  const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
  if (isNaN(start) || isNaN(end) || start < 0 || end >= fileSize || start > end) {
    return null;
  }
  return { start, end };
}

/** 格式化文件大小 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
