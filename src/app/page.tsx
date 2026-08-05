"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Video,
  Github,
  Sun,
  Moon,
  PanelRightClose,
  PanelRightOpen,
  HardDrive,
  Cloud,
  Server,
  Link as LinkIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTheme } from "next-themes";
import { VideoPlayer } from "@/components/video-player/video-player";
import { Playlist } from "@/components/video-player/playlist";
import { PanBrowser } from "@/components/video-player/pan-browser";
import { ServerBrowser, type ServerVideoInfo } from "@/components/video-player/server-browser";
import { UrlVideos } from "@/components/video-player/url-videos";
import { ErrorBoundary } from "@/components/video-player/error-boundary";
import {
  deleteVideo,
  getVideoFile,
  listMeta,
  updateMeta,
  clearAll,
  type VideoMeta,
} from "@/lib/video-db";
import type { BaiduPanFileInfo } from "@/lib/baidu-pan";
import type { UrlVideo } from "@/lib/url-videos";
import { cn } from "@/lib/utils";

/** 统一的"当前播放视频"模型，兼容本地、网盘、服务器、URL */
interface CurrentPlayback {
  /** 来源：local 本地 IndexedDB / pan 百度网盘 / server 服务器本地 / url 任意 HTTP 地址 */
  source: "local" | "pan" | "server" | "url";
  /** 唯一标识：本地用 video id，网盘用 fs_id，服务器用文件 path */
  id: string;
  /** 显示名称 */
  name: string;
  /** 视频 URL（本地为 blob URL，网盘为流代理 URL） */
  url: string;
  /** 上次播放位置（秒） */
  startPosition: number;
  /** 文件大小（本地有，网盘有） */
  size?: number;
  /** 缩略图 */
  thumbnail?: string;
}

export default function Home() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  // 本地视频列表
  const [videos, setVideos] = useState<VideoMeta[]>([]);
  const [isLoadingList, setIsLoadingList] = useState(true);

  // 当前播放
  const [current, setCurrent] = useState<CurrentPlayback | null>(null);

  // 侧边栏
  const [sidebarOpen, setSidebarOpen] = useState(true);
  /** 侧边栏激活的 Tab：local 本地 / url URL / server 服务器 / pan 网盘
   *  持久化到 localStorage，避免页面意外刷新后回到默认 Tab */
  const [activeTab, setActiveTabState] = useState<"local" | "url" | "server" | "pan">(
    () => {
      if (typeof window === "undefined") return "local";
      const saved = window.localStorage.getItem("video-player:active-tab");
      if (saved === "local" || saved === "url" || saved === "server" || saved === "pan") {
        return saved;
      }
      return "local";
    },
  );
  const setActiveTab = useCallback(
    (tab: "local" | "url" | "server" | "pan") => {
      setActiveTabState(tab);
      try {
        window.localStorage.setItem("video-player:active-tab", tab);
      } catch (e) {
        // localStorage 不可用时静默失败
        console.debug("localStorage 不可用", e);
      }
    },
    [],
  );

  // 用于在切换视频前释放上一个 ObjectURL（仅本地视频需要）
  const previousLocalUrlRef = useRef<string | null>(null);
  // 持久化播放位置的节流时间戳
  const lastPersistRef = useRef(0);

  useEffect(() => {
    setMounted(true);
  }, []);

  // 加载本地视频列表
  const refreshList = useCallback(async () => {
    setIsLoadingList(true);
    try {
      const list = await listMeta();
      setVideos(list);
    } catch (e) {
      console.error("加载视频列表失败", e);
    } finally {
      setIsLoadingList(false);
    }
  }, []);

  useEffect(() => {
    void refreshList();
  }, [refreshList]);

  // 当前视频对象（本地）
  const currentLocalVideo = useMemo(
    () => videos.find((v) => v.id === current?.id) ?? null,
    [videos, current],
  );

  // 当前视频在本地列表中的位置
  const currentIdx = useMemo(
    () => videos.findIndex((v) => v.id === current?.id),
    [videos, current],
  );
  const hasPrev = current?.source === "local" && currentIdx > 0;
  const hasNext =
    current?.source === "local" && currentIdx >= 0 && currentIdx < videos.length - 1;

  // ----- 选择本地视频 -----
  const selectLocalVideo = useCallback(async (video: VideoMeta) => {
    try {
      const file = await getVideoFile(video.id);
      if (!file) {
        console.warn("视频文件不存在", video.id);
        return;
      }
      // 释放上一个本地 ObjectURL
      if (previousLocalUrlRef.current) {
        URL.revokeObjectURL(previousLocalUrlRef.current);
        previousLocalUrlRef.current = null;
      }
      const url = URL.createObjectURL(file);
      previousLocalUrlRef.current = url;

      setCurrent({
        source: "local",
        id: video.id,
        name: video.name,
        url,
        startPosition: video.lastPosition ?? 0,
        size: video.size,
        thumbnail: video.thumbnail,
      });
      void updateMeta(video.id, { lastPlayedAt: Date.now() });
    } catch (e) {
      console.error("加载本地视频失败", e);
    }
  }, []);

  // ----- 选择网盘视频 -----
  const selectPanVideo = useCallback((video: BaiduPanFileInfo) => {
    // 释放上一个本地 ObjectURL（切到网盘时本地 URL 无用了）
    if (previousLocalUrlRef.current) {
      URL.revokeObjectURL(previousLocalUrlRef.current);
      previousLocalUrlRef.current = null;
    }
    // 网盘视频走流代理 URL
    const streamUrl = `/api/baidu-pan/stream?fsId=${video.fs_id}`;
    setCurrent({
      source: "pan",
      id: String(video.fs_id),
      name: video.server_filename,
      url: streamUrl,
      startPosition: 0, // 网盘视频暂不支持断点续播（无法持久化到 IndexedDB）
      size: video.size,
      thumbnail: video.thumbnail,
    });
  }, []);

  // ----- 选择服务器视频 -----
  const selectServerVideo = useCallback((video: ServerVideoInfo) => {
    // 释放上一个本地 ObjectURL（切到服务器视频时本地 URL 无用了）
    if (previousLocalUrlRef.current) {
      URL.revokeObjectURL(previousLocalUrlRef.current);
      previousLocalUrlRef.current = null;
    }
    // 服务器视频走本地文件流代理 URL（带 path 参数，URL 编码）
    const streamUrl = `/api/server-file/stream?path=${encodeURIComponent(video.path)}`;
    setCurrent({
      source: "server",
      id: video.path,
      name: video.name,
      url: streamUrl,
      startPosition: 0, // 服务器视频暂不支持断点续播
      size: video.size,
    });
  }, []);

  // ----- 选择 URL 视频 -----
  // useProxy=true 时走 /api/http-proxy 代理（解决跨域 seek 问题）
  // useProxy=false 时直连（性能最佳，多数情况可用）
  const selectUrlVideo = useCallback(
    (video: UrlVideo, useProxy: boolean) => {
      // 释放上一个本地 ObjectURL
      if (previousLocalUrlRef.current) {
        URL.revokeObjectURL(previousLocalUrlRef.current);
        previousLocalUrlRef.current = null;
      }
      const finalUrl = useProxy
        ? `/api/http-proxy?url=${encodeURIComponent(video.url)}`
        : video.url;
      setCurrent({
        source: "url",
        id: video.id,
        name: video.name,
        url: finalUrl,
        startPosition: video.lastPosition ?? 0,
      });
    },
    [],
  );

  // ----- 切换上一个/下一个（仅本地列表） -----
  const goToPrev = useCallback(() => {
    if (!hasPrev) return;
    void selectLocalVideo(videos[currentIdx - 1]);
  }, [hasPrev, currentIdx, videos, selectLocalVideo]);

  const goToNext = useCallback(() => {
    if (!hasNext) return;
    void selectLocalVideo(videos[currentIdx + 1]);
  }, [hasNext, currentIdx, videos, selectLocalVideo]);

  // ----- 播放结束自动下一个（仅本地列表有下一个时） -----
  const handleEnded = useCallback(() => {
    if (hasNext) {
      setTimeout(() => void selectLocalVideo(videos[currentIdx + 1]), 800);
    }
  }, [hasNext, currentIdx, videos, selectLocalVideo]);

  // ----- 持久化播放位置（仅本地视频） -----
  const handlePositionChange = useCallback(
    (time: number) => {
      if (!current) return;
      // 节流：5 秒最多一次
      const now = Date.now();
      if (now - lastPersistRef.current < 5000) return;
      lastPersistRef.current = now;

      if (current.source === "local") {
        void updateMeta(current.id, { lastPosition: time });
      } else if (current.source === "url") {
        // URL 视频：更新 localStorage
        // 动态 import 避免客户端组件初次加载时引入
        void import("@/lib/url-videos").then(({ updateUrlVideo }) => {
          updateUrlVideo(current.id, { lastPosition: time, lastPlayedAt: now });
        });
      }
      // server / pan 暂不支持断点续播
    },
    [current],
  );

  // ----- 删除本地视频 -----
  const handleDelete = useCallback(
    async (id: string) => {
      await deleteVideo(id);
      if (current?.source === "local" && current.id === id) {
        if (previousLocalUrlRef.current) {
          URL.revokeObjectURL(previousLocalUrlRef.current);
          previousLocalUrlRef.current = null;
        }
        setCurrent(null);
      }
      await refreshList();
    },
    [current, refreshList],
  );

  // ----- 清空全部本地视频 -----
  const handleClearAll = useCallback(async () => {
    if (!confirm("确定要清空所有本地视频吗？此操作不可恢复。")) return;
    await clearAll();
    if (previousLocalUrlRef.current) {
      URL.revokeObjectURL(previousLocalUrlRef.current);
      previousLocalUrlRef.current = null;
    }
    if (current?.source === "local") {
      setCurrent(null);
    }
    await refreshList();
  }, [refreshList, current]);

  // ----- 新增本地视频后回调 -----
  const handleAdded = useCallback(
    (_videos: VideoMeta[]) => {
      void refreshList();
    },
    [refreshList],
  );

  // 组件卸载时释放 URL
  useEffect(() => {
    return () => {
      if (previousLocalUrlRef.current) {
        URL.revokeObjectURL(previousLocalUrlRef.current);
      }
    };
  }, []);

  const totalLocalSize = useMemo(
    () => videos.reduce((sum, v) => sum + v.size, 0),
    [videos],
  );

  return (
    <div className="flex flex-col h-screen bg-background overflow-hidden">
      {/* 顶部 Header */}
      <header className="flex-shrink-0 h-14 border-b bg-background flex items-center justify-between px-3 md:px-4 gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-8 h-8 rounded-md bg-primary flex items-center justify-center flex-shrink-0">
            <Video className="w-4 h-4 text-primary-foreground" />
          </div>
          <div className="min-w-0">
            <h1 className="text-sm font-semibold truncate">家庭视频播放器</h1>
            <p className="text-[10px] text-muted-foreground hidden sm:block">
              Local + Server + 百度网盘 · 局域网共享 · 离线可用
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* 主题切换 */}
          {mounted && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              className="h-9 w-9"
              title="切换主题"
            >
              {theme === "dark" ? (
                <Sun className="w-4 h-4" />
              ) : (
                <Moon className="w-4 h-4" />
              )}
            </Button>
          )}

          {/* 侧边栏开关（移动端） */}
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="h-9 w-9 lg:hidden"
            title={sidebarOpen ? "隐藏列表" : "显示列表"}
          >
            {sidebarOpen ? (
              <PanelRightClose className="w-4 h-4" />
            ) : (
              <PanelRightOpen className="w-4 h-4" />
            )}
          </Button>
        </div>
      </header>

      {/* 主体：左视频 + 右列表 */}
      <div className="flex-1 flex min-h-0">
        {/* 视频区 */}
        <main className="flex-1 min-w-0 flex flex-col bg-black">
          <div className="flex-1 min-h-0 relative">
            <ErrorBoundary
              fallback={(error, reset) => (
                <div className="flex flex-col items-center justify-center h-full bg-black p-8 text-center">
                  <p className="text-sm font-medium text-white mb-1">播放器发生错误</p>
                  <p className="text-xs text-white/60 mb-4 max-w-md break-words">
                    {error.message}
                  </p>
                  <Button onClick={reset} size="sm" variant="secondary">
                    重试
                  </Button>
                </div>
              )}
            >
              <VideoPlayer
                src={current?.url ?? null}
                title={current?.name}
                startPosition={current?.startPosition ?? 0}
                onPositionChange={handlePositionChange}
                onEnded={handleEnded}
                hasPrev={hasPrev}
                hasNext={hasNext}
                onPrev={goToPrev}
                onNext={goToNext}
              />
            </ErrorBoundary>
          </div>

          {/* 当前播放信息条 */}
          {current && (
            <div className="flex-shrink-0 bg-background border-t px-3 md:px-4 py-2 flex items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate flex items-center gap-2">
                  {current.source === "pan" && (
                    <Cloud className="w-3.5 h-3.5 text-blue-500 flex-shrink-0" />
                  )}
                  {current.source === "local" && (
                    <HardDrive className="w-3.5 h-3.5 text-green-500 flex-shrink-0" />
                  )}
                  {current.source === "server" && (
                    <Server className="w-3.5 h-3.5 text-purple-500 flex-shrink-0" />
                  )}
                  {current.source === "url" && (
                    <LinkIcon className="w-3.5 h-3.5 text-orange-500 flex-shrink-0" />
                  )}
                  <span className="truncate">{current.name}</span>
                </p>
                <p className="text-xs text-muted-foreground truncate">
                  {current.source === "pan"
                    ? "正在播放 · 百度网盘（通过流代理）"
                    : current.source === "server"
                      ? "正在播放 · 服务器文件（局域网流式传输）"
                      : current.source === "url"
                        ? `正在播放 · URL${current.url.startsWith("/api/http-proxy") ? "（代理模式）" : ""}`
                        : currentLocalVideo?.lastPosition && currentLocalVideo?.duration
                          ? `正在播放 · 上次播放到 ${Math.floor(currentLocalVideo.lastPosition)}s`
                          : "正在播放 · 本地"}
                </p>
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={goToPrev}
                  disabled={!hasPrev}
                  className="h-8"
                >
                  上一个
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={goToNext}
                  disabled={!hasNext}
                  className="h-8"
                >
                  下一个
                </Button>
              </div>
            </div>
          )}
        </main>

        {/* 侧边栏：本地 + 网盘 Tab */}
        {sidebarOpen && (
          <aside
            className="flex-shrink-0 w-full max-w-xs border-l bg-card absolute lg:relative right-0 top-14 bottom-0 lg:top-0 z-20 lg:z-auto flex flex-col"
            style={{ width: "min(320px, 100vw)" }}
          >
            {/* Tab 切换 */}
            <div className="flex-shrink-0 grid grid-cols-4 border-b bg-muted/30">
              <button
                onClick={() => setActiveTab("local")}
                className={cn(
                  "py-2 px-1 text-xs font-medium flex items-center justify-center gap-1 transition-colors border-b-2",
                  activeTab === "local"
                    ? "border-primary text-primary bg-background"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
                title="本地视频（存储于浏览器 IndexedDB）"
              >
                <HardDrive className="w-3.5 h-3.5" />
                本地
                {videos.length > 0 && (
                  <span className="text-[10px] bg-muted px-1 py-0.5 rounded-full">
                    {videos.length}
                  </span>
                )}
              </button>
              <button
                onClick={() => setActiveTab("url")}
                className={cn(
                  "py-2 px-1 text-xs font-medium flex items-center justify-center gap-1 transition-colors border-b-2",
                  activeTab === "url"
                    ? "border-primary text-primary bg-background"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
                title="URL 视频（任意 HTTP 地址，如 python http.server）"
              >
                <LinkIcon className="w-3.5 h-3.5" />
                URL
              </button>
              <button
                onClick={() => setActiveTab("server")}
                className={cn(
                  "py-2 px-1 text-xs font-medium flex items-center justify-center gap-1 transition-colors border-b-2",
                  activeTab === "server"
                    ? "border-primary text-primary bg-background"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
                title="服务器视频（局域网共享，需配置 VIDEO_ROOT）"
              >
                <Server className="w-3.5 h-3.5" />
                服务器
              </button>
              <button
                onClick={() => setActiveTab("pan")}
                className={cn(
                  "py-2 px-1 text-xs font-medium flex items-center justify-center gap-1 transition-colors border-b-2",
                  activeTab === "pan"
                    ? "border-primary text-primary bg-background"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
                title="百度网盘"
              >
                <Cloud className="w-3.5 h-3.5" />
                网盘
              </button>
            </div>

            {/* Tab 内容 */}
            <div className="flex-1 min-h-0">
              {activeTab === "local" ? (
                <Playlist
                  videos={videos}
                  currentId={current?.source === "local" ? current.id : null}
                  onSelect={(v) => void selectLocalVideo(v)}
                  onDelete={(id) => void handleDelete(id)}
                  onClearAll={() => void handleClearAll()}
                  onAdd={handleAdded}
                  totalCount={videos.length}
                  totalSize={totalLocalSize}
                />
              ) : activeTab === "url" ? (
                <UrlVideos
                  onSelectVideo={selectUrlVideo}
                  currentId={current?.source === "url" ? current.id : null}
                />
              ) : activeTab === "server" ? (
                <ServerBrowser
                  onSelectVideo={selectServerVideo}
                  currentPath={current?.source === "server" ? current.id : null}
                />
              ) : (
                <PanBrowser
                  onSelectVideo={selectPanVideo}
                  currentFsId={current?.source === "pan" ? current.id : null}
                />
              )}
            </div>
          </aside>
        )}
      </div>

      {/* 移动端遮罩 */}
      {sidebarOpen && (
        <div
          className="lg:hidden fixed inset-0 top-14 bg-black/40 z-10"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* 加载中遮罩 */}
      {isLoadingList && activeTab === "local" && (
        <div className="absolute inset-0 top-14 flex items-center justify-center bg-background/50 z-30 pointer-events-none">
          <div className="text-sm text-muted-foreground">加载视频列表...</div>
        </div>
      )}

      {/* 底部 Footer */}
      <footer className="flex-shrink-0 h-7 border-t bg-background px-3 md:px-4 flex items-center justify-between text-[10px] text-muted-foreground">
        <span>
          本地视频播放器 · 本地文件存于浏览器，服务器与网盘视频通过后端流代理播放
        </span>
        <span className="hidden sm:flex items-center gap-1">
          <Github className="w-3 h-3" />
          可通过 Capacitor 打包为 Android 应用
        </span>
      </footer>
    </div>
  );
}
