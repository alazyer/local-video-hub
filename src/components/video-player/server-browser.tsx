"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Folder,
  FileVideo,
  ChevronRight,
  Home,
  Loader2,
  RefreshCw,
  Server,
  AlertCircle,
  ArrowLeft,
  Monitor,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { cn } from "@/lib/utils";
import { formatFileSize } from "@/lib/server-videos-shared";
import { PagerBar } from "./pager-bar";

export interface ServerVideoInfo {
  name: string;
  path: string;
  size: number;
  mtime: number;
  isDirectory: boolean;
  isVideo: boolean;
  browserSupported: boolean;
  ext: string;
}

interface ServerBrowserProps {
  onSelectVideo: (video: ServerVideoInfo) => void;
  currentPath?: string | null;
}

interface ListResult {
  items: ServerVideoInfo[];
  root: string;
  relativePath: string;
  total?: number;
  page?: number;
  pageSize?: number;
  roots?: Array<{ path: string; name: string }>;
  error?: string;
  hint?: string;
}

export function ServerBrowser({ onSelectVideo, currentPath }: ServerBrowserProps) {
  const [currentDir, setCurrentDir] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [data, setData] = useState<ListResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notConfigured, setNotConfigured] = useState(false);
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 100;

  const fetchList = useCallback(
    async (dir: string, p: number) => {
      setLoading(true);
      setError(null);
      setNotConfigured(false);
      try {
        const params = new URLSearchParams();
        if (dir) params.set("dir", dir);
        params.set("page", String(p));
        params.set("pageSize", String(PAGE_SIZE));
        const url = `/api/server-file/list?${params.toString()}`;
        const res = await fetch(url);
        const json = await res.json();
        if (!res.ok) {
          if (json.error?.includes("VIDEO_ROOT")) {
            setNotConfigured(true);
            return;
          }
          throw new Error(json.error || `加载失败: HTTP ${res.status}`);
        }
        setData(json);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fetchList(currentDir, page);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [currentDir, page, fetchList]);

  const handleEnterDir = (item: ServerVideoInfo) => {
    setHistory((prev) => [...prev, currentDir]);
    setPage(1);
    setCurrentDir(item.path);
  };

  const handleGoBack = () => {
    if (history.length === 0) return;
    const prev = history[history.length - 1];
    setHistory((prev2) => prev2.slice(0, -1));
    setPage(1);
    setCurrentDir(prev);
  };

  const handleGoHome = () => {
    setHistory([]);
    setPage(1);
    setCurrentDir("");
  };

  const handleRefresh = () => {
    void fetchList(currentDir, page);
  };

  // 虚拟根（多 VIDEO_ROOT）不参与分页：服务端在该路径不返回 page/pageSize
  const total = data?.total ?? 0;
  const showPager =
    !!data &&
    data.page != null &&
    data.pageSize != null &&
    total > PAGE_SIZE;
  const pageCount = data?.pageSize
    ? Math.max(1, Math.ceil(total / data.pageSize))
    : 1;

  // ----- 未配置 VIDEO_ROOT -----
  if (notConfigured) {
    return (
      <div className="flex flex-col h-full bg-card">
        <div className="px-3 py-3 border-b flex items-center justify-between">
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <Server className="w-4 h-4" />
            服务器视频
          </h2>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center p-6 text-center text-muted-foreground overflow-y-auto">
          <Server className="w-12 h-12 mb-3 opacity-30" />
          <p className="text-sm font-medium mb-1">未配置视频根目录</p>
          <p className="text-xs mb-4 max-w-[260px]">
            在服务器端设置 <code className="bg-muted px-1 rounded">VIDEO_ROOT</code> 环境变量，指向存放视频的目录
          </p>
          <div className="bg-muted/50 p-3 rounded-md text-left text-[10px] font-mono leading-relaxed max-w-[280px]">
            <div className="text-muted-foreground mb-1"># 方法1：创建 .env 文件</div>
            <div>VIDEO_ROOT=/path/to/your/videos</div>
            <div className="text-muted-foreground mt-2 mb-1"># 方法2：启动时指定</div>
            <div>VIDEO_ROOT=/path/to/videos bun run dev</div>
            <div className="text-muted-foreground mt-2 mb-1"># 多目录用逗号分隔</div>
            <div>VIDEO_ROOT=/videos1,/videos2</div>
          </div>
        </div>
      </div>
    );
  }

  // 路径分段用于面包屑
  const pathSegments = currentDir ? currentDir.split("/").filter(Boolean) : [];

  return (
    <div className="flex flex-col h-full bg-card">
      {/* 顶部 */}
      <div className="px-3 py-2.5 border-b">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <Server className="w-4 h-4" />
            服务器视频
          </h2>
          <Button
            variant="ghost"
            size="icon"
            onClick={handleRefresh}
            disabled={loading}
            className="h-7 w-7"
            title="刷新"
          >
            <RefreshCw className={cn("w-3.5 h-3.5", loading && "animate-spin")} />
          </Button>
        </div>

        {/* 面包屑 */}
        <div className="flex items-center gap-1 text-xs">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleGoBack}
            disabled={history.length === 0 || loading}
            className="h-6 px-1.5"
          >
            <ArrowLeft className="w-3 h-3" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleGoHome}
            disabled={!currentDir || loading}
            className="h-6 px-1.5"
            title="回到根目录"
          >
            <Home className="w-3 h-3" />
          </Button>
          <div className="flex items-center gap-0.5 overflow-x-auto flex-1 min-w-0">
            <button
              onClick={handleGoHome}
              className="px-1 py-0.5 hover:bg-accent rounded text-muted-foreground flex-shrink-0 flex items-center gap-1"
            >
              <Monitor className="w-3 h-3" />
              全部文件
            </button>
            {pathSegments.map((seg, idx) => {
              const fullPath = pathSegments.slice(0, idx + 1).join("/");
              return (
                <div key={fullPath} className="flex items-center gap-0.5 flex-shrink-0">
                  <ChevronRight className="w-3 h-3 text-muted-foreground" />
                  <button
                    onClick={() => {
                      setHistory((prev) => [
                        ...prev,
                        ...pathSegments.slice(0, idx).map((_, i) =>
                          pathSegments.slice(0, i + 1).join("/")
                        ),
                      ]);
                      setPage(1);
                      setCurrentDir(fullPath);
                    }}
                    className={cn(
                      "px-1 py-0.5 hover:bg-accent rounded truncate max-w-[100px]",
                      idx === pathSegments.length - 1
                        ? "text-foreground font-medium"
                        : "text-muted-foreground",
                    )}
                    title={seg}
                  >
                    {seg}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* 错误提示 */}
      {error && (
        <Alert variant="destructive" className="m-3">
          <AlertCircle className="w-4 h-4" />
          <AlertDescription className="text-xs">
            {error}
            <Button
              variant="ghost"
              size="sm"
              onClick={handleRefresh}
              className="h-6 ml-2 px-2 text-xs"
            >
              重试
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {/* 文件列表 */}
      <ScrollArea className="flex-1 min-h-0">
        {loading && !data ? (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <Loader2 className="w-6 h-6 mb-2 animate-spin" />
            <p className="text-xs">加载中...</p>
          </div>
        ) : data ? (
          <ul className="p-2 space-y-0.5">
            {/* 目录优先 */}
            {data.items
              .filter((item) => item.isDirectory)
              .map((dir) => (
                <li key={dir.path}>
                  <button
                    onClick={() => handleEnterDir(dir)}
                    disabled={loading}
                    className="w-full flex items-center gap-2 p-2 rounded-lg text-left text-sm hover:bg-accent transition-colors group disabled:opacity-50"
                  >
                    <Folder className="w-4 h-4 text-amber-500 flex-shrink-0" />
                    <span className="flex-1 truncate" title={dir.name}>
                      {dir.name}
                    </span>
                    <ChevronRight className="w-3.5 h-3.5 text-muted-foreground opacity-0 group-hover:opacity-100" />
                  </button>
                </li>
              ))}

            {/* 视频文件 */}
            {data.items
              .filter((item) => item.isVideo)
              .map((video) => {
                const isActive = video.path === currentPath;
                const notSupported = !video.browserSupported;
                return (
                  <li key={video.path}>
                    <button
                      onClick={() => onSelectVideo(video)}
                      disabled={loading}
                      className={cn(
                        "w-full flex gap-3 p-2 rounded-lg text-left transition-colors group disabled:opacity-50",
                        isActive
                          ? "bg-primary/10 ring-1 ring-primary/30"
                          : "hover:bg-accent",
                      )}
                    >
                      <div className="relative flex-shrink-0 w-20 h-12 bg-muted rounded overflow-hidden flex items-center justify-center text-muted-foreground">
                        <FileVideo className="w-5 h-5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p
                          className={cn(
                            "text-sm font-medium truncate flex items-center gap-1",
                            isActive ? "text-primary" : "text-foreground",
                          )}
                          title={video.name}
                        >
                          <span className="truncate">{video.name}</span>
                          {notSupported && (
                            <Badge
                              variant="outline"
                              className="text-[9px] py-0 px-1 h-3.5 flex-shrink-0 text-amber-600 border-amber-300"
                              title="此格式浏览器可能不支持播放，需要转码为 MP4"
                            >
                              ?
                            </Badge>
                          )}
                        </p>
                        <div className="flex items-center gap-2 mt-1 text-[11px] text-muted-foreground">
                          <span>{formatFileSize(video.size)}</span>
                          {video.mtime > 0 && (
                            <span>
                              {new Date(video.mtime).toLocaleDateString("zh-CN")}
                            </span>
                          )}
                          <Badge
                            variant="outline"
                            className="text-[9px] py-0 px-1 h-3.5"
                          >
                            服务器
                          </Badge>
                        </div>
                      </div>
                    </button>
                  </li>
                );
              })}

            {/* 其他文件（折叠显示数量） */}
            {data.items.filter((i) => !i.isDirectory && !i.isVideo).length > 0 && (
              <li className="px-2 py-1.5 text-[11px] text-muted-foreground">
                另有{" "}
                {data.items.filter((i) => !i.isDirectory && !i.isVideo).length}{" "}
                个非视频文件已隐藏
              </li>
            )}

            {/* 空目录 */}
            {data.items.length === 0 && (
              <li className="py-12 text-center text-xs text-muted-foreground">
                此目录为空
              </li>
            )}
          </ul>
        ) : (
          <div className="py-12 text-center text-xs text-muted-foreground">
            点击刷新加载
          </div>
        )}
      </ScrollArea>

      {/* 分页（虚拟根目录不参与分页） */}
      {showPager && data && (
        <div className="border-t">
          <PagerBar
            page={page}
            pageCount={pageCount}
            hasPrev={page > 1}
            hasNext={page < pageCount}
            onPrev={() => setPage((p) => Math.max(1, p - 1))}
            onNext={() => setPage((p) => Math.min(pageCount, p + 1))}
          />
        </div>
      )}

      {/* 底部提示 */}
      {data?.root && (
        <div className="px-3 py-1.5 border-t text-[10px] text-muted-foreground truncate" title={data.root}>
          根目录: {data.root}
        </div>
      )}
    </div>
  );
}
