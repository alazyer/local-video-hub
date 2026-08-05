"use client";

import { useRef, useState, useCallback } from "react";
import {
  Upload,
  FolderSearch,
  Loader2,
  ChevronDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { isVideoFile, saveVideo, type VideoMeta } from "@/lib/video-db";

interface AddVideosProps {
  onAdded: (videos: VideoMeta[]) => void;
}

// File System Access API 类型定义（部分浏览器原生支持）
interface FileSystemHandlePermissionDescriptor {
  mode?: "read" | "readwrite";
}
interface FileSystemHandle {
  queryPermission: (
    descriptor?: FileSystemHandlePermissionDescriptor,
  ) => Promise<PermissionState>;
  requestPermission: (
    descriptor?: FileSystemHandlePermissionDescriptor,
  ) => Promise<PermissionState>;
}
interface FileSystemDirectoryHandle {
  kind: "directory";
  name: string;
  values: () => AsyncIterableIterator<FileSystemHandle | FileSystemDirectoryHandle>;
  [Symbol.asyncIterator]: () => AsyncIterableIterator<
    FileSystemHandle | FileSystemDirectoryHandle
  >;
}
interface FileSystemFileHandle {
  kind: "file";
  name: string;
  getFile: () => Promise<File>;
}
interface WindowWithFSAccess extends Window {
  showOpenFilePicker?: (opts: {
    multiple?: boolean;
    types?: Array<{
      description?: string;
      accept: Record<string, string[]>;
    }>;
  }) => Promise<FileSystemFileHandle[]>;
  showDirectoryPicker?: (opts?: {
    mode?: "read" | "readwrite";
  }) => Promise<FileSystemDirectoryHandle>;
}

export function AddVideos({ onAdded }: AddVideosProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [importMessage, setImportMessage] = useState<string>("");

  // 检测是否支持 File System Access API
  const supportsDirectoryPicker =
    typeof window !== "undefined" &&
    "showDirectoryPicker" in window;

  const supportsFilePicker =
    typeof window !== "undefined" &&
    "showOpenFilePicker" in window;

  // ----- 通用：批量保存视频文件 -----
  const saveFiles = useCallback(
    async (
      files: File[],
      source: "manual" | "scan",
      onProgress?: (msg: string) => void,
    ): Promise<VideoMeta[]> => {
      const videoFiles = files.filter(isVideoFile);
      if (videoFiles.length === 0) {
        onProgress?.("未发现视频文件");
        return [];
      }
      onProgress?.(`正在导入 ${videoFiles.length} 个视频...`);
      const metas: VideoMeta[] = [];
      let successCount = 0;
      let failCount = 0;
      for (let i = 0; i < videoFiles.length; i++) {
        try {
          onProgress?.(
            `正在导入 (${i + 1}/${videoFiles.length}): ${videoFiles[i].name}`,
          );
          const meta = await saveVideo(videoFiles[i], source);
          metas.push(meta);
          successCount++;
        } catch (e) {
          console.error("保存失败", videoFiles[i].name, e);
          failCount++;
        }
      }
      onProgress?.(
        `导入完成：成功 ${successCount}${
          failCount > 0 ? `，失败 ${failCount}` : ""
        }`,
      );
      return metas;
    },
    [],
  );

  // ----- 1. 通过原生 File Input 选择文件 -----
  const handleFileInputChange = async (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    setIsImporting(true);
    setImportMessage("正在导入...");
    try {
      const metas = await saveFiles(files, "manual", setImportMessage);
      if (metas.length > 0) onAdded(metas);
    } finally {
      setIsImporting(false);
      // 清空 input 以便重复选择同一文件
      if (fileInputRef.current) fileInputRef.current.value = "";
      // 3 秒后清除消息
      setTimeout(() => setImportMessage(""), 3000);
    }
  };

  // ----- 2. 使用 File System Access API 选择文件 -----
  const handlePickFiles = async () => {
    const w = window as WindowWithFSAccess;
    if (!w.showOpenFilePicker) {
      // 回退到普通 input
      fileInputRef.current?.click();
      return;
    }
    setIsImporting(true);
    setImportMessage("请选择视频文件...");
    try {
      const handles = await w.showOpenFilePicker({
        multiple: true,
        types: [
          {
            description: "视频文件",
            accept: {
              "video/*": [
                ".mp4",
                ".webm",
                ".ogg",
                ".mov",
                ".m4v",
                ".mkv",
                ".avi",
                ".flv",
                ".wmv",
                ".3gp",
                ".ts",
              ],
            },
          },
        ],
      });
      const files: File[] = [];
      for (const h of handles) {
        try {
          files.push(await h.getFile());
        } catch (e) {
          console.warn("读取文件失败", e);
        }
      }
      const metas = await saveFiles(files, "manual", setImportMessage);
      if (metas.length > 0) onAdded(metas);
    } catch (e) {
      // 用户取消时不报错
      if ((e as Error).name !== "AbortError") {
        console.error(e);
        setImportMessage("选择文件失败");
      }
    } finally {
      setIsImporting(false);
      setTimeout(() => setImportMessage(""), 3000);
    }
  };

  // ----- 3. 自动扫描文件夹（递归） -----
  const handleScanFolder = async () => {
    const w = window as WindowWithFSAccess;
    if (!w.showDirectoryPicker) return;
    setIsImporting(true);
    setImportMessage("请选择要扫描的文件夹...");
    try {
      const dirHandle = await w.showDirectoryPicker({ mode: "read" });
      setImportMessage("正在扫描文件夹...");
      const collected: File[] = [];
      await collectVideoFiles(dirHandle, collected, setImportMessage, 0);
      setImportMessage(
        `扫描完成，发现 ${collected.length} 个视频文件，开始导入...`,
      );
      const metas = await saveFiles(collected, "scan", setImportMessage);
      if (metas.length > 0) onAdded(metas);
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        console.error(e);
        setImportMessage("扫描失败");
      }
    } finally {
      setIsImporting(false);
      setTimeout(() => setImportMessage(""), 3000);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <input
        ref={fileInputRef}
        type="file"
        accept="video/*,.mkv,.flv,.wmv,.avi,.3gp,.ts,.mov,.m4v"
        multiple
        className="hidden"
        onChange={handleFileInputChange}
      />

      {/* 主操作：添加视频（下拉菜单）
          样式与其他 Tab 的入口按钮（h-7）对齐，保持视觉一致 */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button disabled={isImporting} size="sm" className="h-7 px-2 text-xs">
            {isImporting ? (
              <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
            ) : (
              <Upload className="w-3.5 h-3.5 mr-1" />
            )}
            {isImporting ? "处理中..." : "添加视频"}
            {!isImporting && <ChevronDown className="w-3 h-3 ml-0.5" />}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel className="text-xs text-muted-foreground">
            选择导入方式
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={handlePickFiles}
            className="cursor-pointer"
          >
            <Upload className="w-4 h-4 mr-2" />
            <div className="flex flex-col">
              <span className="text-sm font-medium">手动选择文件</span>
              <span className="text-xs text-muted-foreground">
                选择一个或多个视频文件
              </span>
            </div>
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={handleScanFolder}
            disabled={!supportsDirectoryPicker}
            className="cursor-pointer"
          >
            <FolderSearch className="w-4 h-4 mr-2" />
            <div className="flex flex-col">
              <span className="text-sm font-medium">扫描文件夹</span>
              <span className="text-xs text-muted-foreground">
                {supportsDirectoryPicker
                  ? "自动发现文件夹内所有视频"
                  : "当前浏览器不支持，请使用 Chrome/Edge"}
              </span>
            </div>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* 状态消息 */}
      {importMessage && (
        <span className="text-xs text-muted-foreground hidden md:inline-flex items-center gap-1.5 max-w-[280px]">
          {isImporting && (
            <Loader2 className="w-3 h-3 animate-spin flex-shrink-0" />
          )}
          <span className="truncate">{importMessage}</span>
        </span>
      )}
    </div>
  );
}

/** 递归收集目录中的视频文件（最多 3 层） */
async function collectVideoFiles(
  dir: FileSystemDirectoryHandle,
  collected: File[],
  onProgress: (msg: string) => void,
  depth: number,
) {
  if (depth > 3) return; // 防止过深递归
  for await (const entry of dir.values()) {
    if (entry.kind === "file") {
      const fileHandle = entry as FileSystemFileHandle;
      if (isVideoFileByName(fileHandle.name)) {
        try {
          const file = await fileHandle.getFile();
          collected.push(file);
          if (collected.length % 10 === 0) {
            onProgress?.(`已扫描到 ${collected.length} 个视频...`);
          }
        } catch (e) {
          console.warn("读取文件失败", fileHandle.name, e);
        }
      }
    } else if (entry.kind === "directory") {
      await collectVideoFiles(
        entry as FileSystemDirectoryHandle,
        collected,
        onProgress,
        depth + 1,
      );
    }
  }
}

function isVideoFileByName(name: string): boolean {
  return /\.(mp4|webm|ogg|mov|m4v|mkv|avi|flv|wmv|3gp|ts)$/i.test(name);
}
