/**
 * 服务器本地视频文件工具（仅服务端使用）
 *
 * 包含所有需要 Node.js fs/path 模块的逻辑。
 * 客户端代码不要直接引入此文件，应该引入 server-videos-shared.ts。
 *
 * 设计目标：
 *  - 让局域网内的平板浏览器能观看服务器A 上指定目录的视频
 *  - 防止路径穿越攻击（path traversal）
 *  - 支持多根目录配置
 *  - 自动按扩展名过滤视频文件
 *
 * ⚠️ 此文件只能在 server component / API route / server action 中使用
 */

import "server-only";
import fs from "fs/promises";
import fsSync from "fs";
import path from "path";
import {
  VIDEO_EXTENSIONS,
  BROWSER_NATIVE_EXTENSIONS,
  type VideoFileInfo,
} from "./server-videos-shared";

export {
  VIDEO_EXTENSIONS,
  BROWSER_NATIVE_EXTENSIONS,
  getMimeType,
  parseRange,
  formatFileSize,
  type VideoFileInfo,
} from "./server-videos-shared";

/**
 * 获取配置的视频根目录列表
 * 来源：环境变量 VIDEO_ROOT（逗号分隔）或默认 {project}/videos
 */
export function getVideoRoots(): string[] {
  const raw = process.env.VIDEO_ROOT;
  if (!raw) {
    // 默认目录：项目下的 videos 文件夹（方便测试）
    return [path.resolve(process.cwd(), "videos")];
  }
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((p) => path.resolve(p));
}

/**
 * 检查路径是否在允许的根目录下（防止路径穿越）
 * 返回归一化后的绝对路径，或 null 表示不合法
 *
 * 注意：空字符串被视为根目录本身（返回第一个 root）
 */
export function resolveSafePath(inputPath: string): string | null {
  // 空路径：返回第一个根目录
  if (!inputPath || inputPath === "") {
    const roots = getVideoRoots();
    return roots.length > 0 ? roots[0] : null;
  }

  if (typeof inputPath !== "string") return null;

  // 拒绝包含空字节（用于绕过检查的常见手法）
  if (inputPath.includes("\0")) return null;

  const roots = getVideoRoots();

  // 输入可能是：
  //  1. 相对路径：videos/subdir/file.mp4
  //  2. 绝对路径但需在某根目录下：/home/videos/subdir/file.mp4
  //  3. 带 root 前缀的虚拟路径：root1/subdir/file.mp4
  const cleaned = inputPath.replace(/\\/g, "/").replace(/^\/+/, "");

  // 尝试每个根目录
  for (const root of roots) {
    const resolved = path.resolve(root, cleaned);
    // 关键安全检查：resolved 必须以 root + path.sep 开头
    if (resolved === root || resolved.startsWith(root + path.sep)) {
      return resolved;
    }
  }

  return null;
}

/**
 * 列出指定目录下的文件和子目录
 * @param dirPath 相对路径或绝对路径
 */
export async function listDirectory(
  dirPath: string,
): Promise<{ items: VideoFileInfo[]; root: string; relativePath: string }> {
  const absPath = resolveSafePath(dirPath);
  if (!absPath) {
    throw new Error("非法路径");
  }

  const roots = getVideoRoots();
  const root = roots.find((r) => absPath === r || absPath.startsWith(r + path.sep));
  if (!root) {
    throw new Error("路径不在允许的范围内");
  }

  const relativePath = path.relative(root, absPath);

  let entries: fsSync.Dirent[];
  try {
    entries = await fs.readdir(absPath, { withFileTypes: true });
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === "ENOENT") {
      throw new Error("目录不存在");
    }
    if (err.code === "EACCES") {
      throw new Error("无访问权限");
    }
    throw e;
  }

  const items: VideoFileInfo[] = await Promise.all(
    entries.map(async (entry) => {
      const entryAbsPath = path.join(absPath, entry.name);
      const entryRelPath = path.join(relativePath, entry.name);
      const ext = entry.name.split(".").pop()?.toLowerCase() || "";

      if (entry.isDirectory()) {
        return {
          name: entry.name,
          path: entryRelPath,
          size: 0,
          mtime: 0,
          isDirectory: true,
          isVideo: false,
          browserSupported: false,
          ext: "",
        };
      }

      // 文件：获取 stat
      let stat: fsSync.Stats;
      try {
        stat = await fs.stat(entryAbsPath);
      } catch {
        stat = { size: 0, mtimeMs: 0 } as fsSync.Stats;
      }

      const isVideo = VIDEO_EXTENSIONS.includes(ext);
      const browserSupported = BROWSER_NATIVE_EXTENSIONS.includes(ext);

      return {
        name: entry.name,
        path: entryRelPath,
        size: stat.size,
        mtime: stat.mtimeMs,
        isDirectory: false,
        isVideo,
        browserSupported,
        ext,
      };
    }),
  );

  // 排序：目录优先，然后视频，然后按名称
  items.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    if (a.isVideo !== b.isVideo) return a.isVideo ? -1 : 1;
    return a.name.localeCompare(b.name, "zh-CN");
  });

  return { items, root, relativePath };
}
