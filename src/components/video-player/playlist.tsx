"use client";

import { useMemo, useState } from "react";
import {
  Trash2,
  Play,
  Search,
  FolderOpen,
  FileVideo,
  Calendar,
  Clock,
  HardDrive,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AddVideos } from "./add-videos";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
  ContextMenuSeparator,
} from "@/components/ui/context-menu";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  formatDuration,
  formatSize,
  type VideoMeta,
} from "@/lib/video-db";
import { usePagination } from "@/hooks/use-pagination";
import { PagerBar } from "./pager-bar";

interface PlaylistProps {
  videos: VideoMeta[];
  currentId: string | null;
  onSelect: (video: VideoMeta) => void;
  onDelete: (id: string) => void;
  onClearAll: () => void;
  /** 添加视频回调（接收新加的视频列表，与 AddVideos 组件接口对齐） */
  onAdd?: (videos: VideoMeta[]) => void;
  totalCount: number;
  totalSize: number;
}

type SortMode = "added" | "name" | "lastPlayed";

export function Playlist({
  videos,
  currentId,
  onSelect,
  onDelete,
  onClearAll,
  onAdd,
  totalCount,
  totalSize,
}: PlaylistProps) {
  const [search, setSearch] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>("added");

  const filtered = useMemo(() => {
    const result = videos.filter((v) =>
      v.name.toLowerCase().includes(search.trim().toLowerCase()),
    );
    const sorted = [...result];
    switch (sortMode) {
      case "name":
        sorted.sort((a, b) => a.name.localeCompare(b.name));
        break;
      case "lastPlayed":
        sorted.sort(
          (a, b) => (b.lastPlayedAt ?? 0) - (a.lastPlayedAt ?? 0),
        );
        break;
      case "added":
      default:
        sorted.sort((a, b) => b.addedAt - a.addedAt);
        break;
    }
    // 把当前播放的放到最前面（如果存在于过滤结果中）
    const currentIdx = sorted.findIndex((v) => v.id === currentId);
    if (currentIdx > 0) {
      const [cur] = sorted.splice(currentIdx, 1);
      sorted.unshift(cur);
    }
    return sorted;
  }, [videos, search, sortMode, currentId]);

  const PAGE_SIZE = 50;
  const {
    paginatedItems,
    page,
    pageCount,
    nextPage,
    prevPage,
  } = usePagination(filtered, PAGE_SIZE);

  return (
    <div className="flex flex-col h-full bg-card">
      {/* 顶部统计 + 添加按钮（与其他 Tab 的入口按钮位置一致） */}
      <div className="px-3 py-3 border-b">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <FileVideo className="w-4 h-4" />
            播放列表
          </h2>
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="text-xs">
              {totalCount} 个
            </Badge>
            {onAdd && <AddVideos onAdded={onAdd} />}
          </div>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <HardDrive className="w-3 h-3" />
            {formatSize(totalSize)}
          </span>
        </div>
      </div>

      {/* 搜索 */}
      <div className="px-3 py-2 border-b space-y-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input
            placeholder="搜索视频..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 pl-8 text-sm"
          />
        </div>
        <div className="flex gap-1 text-xs">
          <SortButton
            active={sortMode === "added"}
            onClick={() => setSortMode("added")}
          >
            最近添加
          </SortButton>
          <SortButton
            active={sortMode === "name"}
            onClick={() => setSortMode("name")}
          >
            名称
          </SortButton>
          <SortButton
            active={sortMode === "lastPlayed"}
            onClick={() => setSortMode("lastPlayed")}
          >
            最近播放
          </SortButton>
        </div>
      </div>

      {/* 列表 */}
      <ScrollArea className="flex-1 min-h-0">
        {filtered.length === 0 ? (
          <EmptyPlaylist
            hasVideos={totalCount > 0}
            search={search}
          />
        ) : (
          <ul className="p-2 space-y-1">
            {paginatedItems.map((video) => (
              <PlaylistItem
                key={video.id}
                video={video}
                isActive={video.id === currentId}
                onSelect={() => onSelect(video)}
                onDelete={() => onDelete(video.id)}
              />
            ))}
          </ul>
        )}
      </ScrollArea>

      {/* 分页（条数 ≤ 每页时隐藏） */}
      {filtered.length > PAGE_SIZE && (
        <div className="border-t">
          <PagerBar
            page={page}
            pageCount={pageCount}
            hasPrev={page > 1}
            hasNext={page < pageCount}
            onPrev={prevPage}
            onNext={nextPage}
          />
        </div>
      )}

      {/* 底部操作 */}
      {totalCount > 0 && (
        <div className="px-3 py-2 border-t">
          <Button
            variant="ghost"
            size="sm"
            onClick={onClearAll}
            className="w-full text-destructive hover:text-destructive hover:bg-destructive/10 h-8 text-xs"
          >
            <Trash2 className="w-3.5 h-3.5 mr-1.5" />
            清空全部 ({totalCount})
          </Button>
        </div>
      )}
    </div>
  );
}

function SortButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "px-2 py-1 rounded-md transition-colors",
        active
          ? "bg-primary text-primary-foreground"
          : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
      )}
    >
      {children}
    </button>
  );
}

function PlaylistItem({
  video,
  isActive,
  onSelect,
  onDelete,
}: {
  video: VideoMeta;
  isActive: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) {
  const addedDate = useMemo(
    () => new Date(video.addedAt).toLocaleDateString("zh-CN"),
    [video.addedAt],
  );
  const lastPlayed = useMemo(() => {
    if (!video.lastPlayedAt) return null;
    const diff = Date.now() - video.lastPlayedAt;
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return "刚刚";
    if (minutes < 60) return `${minutes} 分钟前`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} 小时前`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days} 天前`;
    return new Date(video.lastPlayedAt).toLocaleDateString("zh-CN");
  }, [video.lastPlayedAt]);

  const progress =
    video.duration > 0 && video.lastPosition
      ? Math.min(100, (video.lastPosition / video.duration) * 100)
      : 0;

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <li>
          <button
            onClick={onSelect}
            className={cn(
              "w-full flex gap-3 p-2 rounded-lg text-left transition-colors group",
              isActive
                ? "bg-primary/10 ring-1 ring-primary/30"
                : "hover:bg-accent",
            )}
          >
            {/* 缩略图 */}
            <div className="relative flex-shrink-0 w-20 h-12 bg-muted rounded overflow-hidden">
              {video.thumbnail ? (
                <img
                  src={video.thumbnail}
                  alt={video.name}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                  <FileVideo className="w-5 h-5" />
                </div>
              )}
              {/* 时长标签 */}
              {video.duration > 0 && (
                <span className="absolute bottom-0.5 right-0.5 px-1 py-0.5 bg-black/75 text-white text-[10px] font-mono rounded">
                  {formatDuration(video.duration)}
                </span>
              )}
              {/* 当前播放标记 */}
              {isActive && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                  <Play className="w-5 h-5 text-white fill-white" />
                </div>
              )}
            </div>

            {/* 信息 */}
            <div className="flex-1 min-w-0">
              <p
                className={cn(
                  "text-sm font-medium truncate",
                  isActive ? "text-primary" : "text-foreground",
                )}
                title={video.name}
              >
                {video.name}
              </p>
              <div className="flex items-center gap-2 mt-1 text-[11px] text-muted-foreground">
                <span className="flex items-center gap-0.5" title="文件大小">
                  <HardDrive className="w-2.5 h-2.5" />
                  {formatSize(video.size)}
                </span>
                <span className="flex items-center gap-0.5" title="添加时间">
                  <Calendar className="w-2.5 h-2.5" />
                  {addedDate}
                </span>
              </div>
              {/* 断点续播进度 */}
              {progress > 5 && progress < 95 && (
                <div className="mt-1.5">
                  <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                    <Clock className="w-2.5 h-2.5" />
                    <span>上次播放到 {formatDuration(video.lastPosition ?? 0)}</span>
                  </div>
                  <div className="mt-0.5 h-0.5 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary/60"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                </div>
              )}
              {/* 来源标签 */}
              {video.source === "scan" && (
                <Badge variant="outline" className="mt-1 text-[9px] py-0 px-1 h-3.5">
                  扫描
                </Badge>
              )}
            </div>
          </button>
        </li>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onClick={onSelect}>
          <Play className="w-3.5 h-3.5 mr-2" />
          播放
        </ContextMenuItem>
        {lastPlayed && (
          <ContextMenuItem disabled className="text-xs text-muted-foreground">
            <Clock className="w-3.5 h-3.5 mr-2" />
            最近播放：{lastPlayed}
          </ContextMenuItem>
        )}
        <ContextMenuSeparator />
        <ContextMenuItem
          onClick={onDelete}
          className="text-destructive focus:text-destructive"
        >
          <Trash2 className="w-3.5 h-3.5 mr-2" />
          删除
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

function EmptyPlaylist({
  hasVideos,
  search,
}: {
  hasVideos: boolean;
  search: string;
}) {
  if (hasVideos && search) {
    return (
      <div className="flex flex-col items-center justify-center py-16 px-4 text-center text-muted-foreground">
        <Search className="w-10 h-10 mb-3 opacity-40" />
        <p className="text-sm font-medium">未找到匹配的视频</p>
        <p className="text-xs mt-1">尝试调整搜索关键词</p>
      </div>
    );
  }
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4 text-center text-muted-foreground">
      <FolderOpen className="w-12 h-12 mb-3 opacity-30" />
      <p className="text-sm font-medium">播放列表为空</p>
      <p className="text-xs mt-1 max-w-[200px]">
        点击顶部「添加视频」按钮选择文件，或使用「扫描文件夹」自动发现视频
      </p>
    </div>
  );
}
