"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Folder,
  FileVideo,
  ChevronRight,
  Home,
  Loader2,
  RefreshCw,
  Cloud,
  AlertCircle,
  ArrowLeft,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  formatPanSize,
  type BaiduPanFileInfo,
} from "@/lib/baidu-pan";
import { cn } from "@/lib/utils";
import { BaiduPanSettings } from "./baidu-pan-settings";

interface PanBrowserProps {
  onSelectVideo: (video: BaiduPanFileInfo) => void;
  currentFsId?: number | string | null;
}

interface ListResult {
  dir: string;
  page: number;
  total: number;
  dirs: BaiduPanFileInfo[];
  videos: BaiduPanFileInfo[];
  others: BaiduPanFileInfo[];
  list: BaiduPanFileInfo[];
}

export function PanBrowser({ onSelectVideo, currentFsId }: PanBrowserProps) {
  const [currentDir, setCurrentDir] = useState("/");
  const [history, setHistory] = useState<string[]>([]);
  const [data, setData] = useState<ListResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notConfigured, setNotConfigured] = useState(false);
  const [configVersion, setConfigVersion] = useState(0);

  const fetchList = useCallback(
    async (dir: string) => {
      setLoading(true);
      setError(null);
      setNotConfigured(false);
      try {
        const res = await fetch(
          `/api/baidu-pan/list?dir=${encodeURIComponent(dir)}`,
        );
        const json = await res.json();
        if (res.status === 401) {
          setNotConfigured(true);
          return;
        }
        if (!res.ok) {
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
    void fetchList(currentDir);
  }, [currentDir, configVersion, fetchList]);

  const handleEnterDir = (dir: BaiduPanFileInfo) => {
    setHistory((prev) => [...prev, currentDir]);
    setCurrentDir(dir.path);
  };

  const handleGoBack = () => {
    if (history.length === 0) return;
    const prev = history[history.length - 1];
    setHistory((prev2) => prev2.slice(0, -1));
    setCurrentDir(prev);
  };

  const handleGoHome = () => {
    setHistory([]);
    setCurrentDir("/");
  };

  const handleRefresh = () => {
    void fetchList(currentDir);
  };

  const handleConfigChange = () => {
    setConfigVersion((v) => v + 1);
  };

  const pathSegments = currentDir.split("/").filter(Boolean);

  // ----- 未配置网盘 -----
  if (notConfigured) {
    return (
      <div className="flex flex-col h-full bg-card">
        <div className="px-3 py-3 border-b flex items-center justify-between">
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <Cloud className="w-4 h-4" />
            百度网盘
          </h2>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center p-6 text-center text-muted-foreground">
          <Cloud className="w-12 h-12 mb-3 opacity-30" />
          <p className="text-sm font-medium mb-1">未配置百度网盘</p>
          <p className="text-xs mb-4 max-w-[240px]">
            点击下方按钮配置 AppKey 和 Access Token，配置完成后即可浏览网盘视频
          </p>
          <BaiduPanSettings onConfigChange={handleConfigChange} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-card">
      {/* 顶部 */}
      <div className="px-3 py-2.5 border-b">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <Cloud className="w-4 h-4" />
            百度网盘
          </h2>
          <div className="flex items-center gap-1">
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
            <BaiduPanSettings onConfigChange={handleConfigChange} />
          </div>
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
            disabled={currentDir === "/" || loading}
            className="h-6 px-1.5"
            title="回到根目录"
          >
            <Home className="w-3 h-3" />
          </Button>
          <div className="flex items-center gap-0.5 overflow-x-auto flex-1 min-w-0">
            <button
              onClick={handleGoHome}
              className="px-1 py-0.5 hover:bg-accent rounded text-muted-foreground flex-shrink-0"
            >
              全部文件
            </button>
            {pathSegments.map((seg, idx) => {
              const fullPath = "/" + pathSegments.slice(0, idx + 1).join("/");
              return (
                <div key={fullPath} className="flex items-center gap-0.5 flex-shrink-0">
                  <ChevronRight className="w-3 h-3 text-muted-foreground" />
                  <button
                    onClick={() => {
                      setHistory((prev) => [
                        ...prev,
                        ...pathSegments.slice(0, idx).map(
                          (_, i) => "/" + pathSegments.slice(0, i + 1).join("/"),
                        ),
                      ]);
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
      <ScrollArea className="flex-1">
        {loading && !data ? (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <Loader2 className="w-6 h-6 mb-2 animate-spin" />
            <p className="text-xs">加载中...</p>
          </div>
        ) : data ? (
          <ul className="p-2 space-y-0.5">
            {/* 目录优先 */}
            {data.dirs.map((dir) => (
              <li key={dir.fs_id}>
                <button
                  onClick={() => handleEnterDir(dir)}
                  disabled={loading}
                  className="w-full flex items-center gap-2 p-2 rounded-lg text-left text-sm hover:bg-accent transition-colors group disabled:opacity-50"
                >
                  <Folder className="w-4 h-4 text-amber-500 flex-shrink-0" />
                  <span className="flex-1 truncate" title={dir.server_filename}>
                    {dir.server_filename}
                  </span>
                  <ChevronRight className="w-3.5 h-3.5 text-muted-foreground opacity-0 group-hover:opacity-100" />
                </button>
              </li>
            ))}

            {/* 视频文件 */}
            {data.videos.map((video) => (
              <li key={video.fs_id}>
                <button
                  onClick={() => onSelectVideo(video)}
                  disabled={loading}
                  className={cn(
                    "w-full flex gap-3 p-2 rounded-lg text-left transition-colors group disabled:opacity-50",
                    String(video.fs_id) === String(currentFsId)
                      ? "bg-primary/10 ring-1 ring-primary/30"
                      : "hover:bg-accent",
                  )}
                >
                  <div className="relative flex-shrink-0 w-20 h-12 bg-muted rounded overflow-hidden">
                    {video.thumbnail ? (
                      <img
                        src={video.thumbnail}
                        alt={video.server_filename}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                        <FileVideo className="w-5 h-5" />
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p
                      className={cn(
                        "text-sm font-medium truncate",
                        String(video.fs_id) === String(currentFsId)
                          ? "text-primary"
                          : "text-foreground",
                      )}
                      title={video.server_filename}
                    >
                      {video.server_filename}
                    </p>
                    <div className="flex items-center gap-2 mt-1 text-[11px] text-muted-foreground">
                      <span>{formatPanSize(video.size)}</span>
                      <Badge variant="outline" className="text-[9px] py-0 px-1 h-3.5">
                        网盘
                      </Badge>
                    </div>
                  </div>
                </button>
              </li>
            ))}

            {/* 其他文件（折叠显示数量） */}
            {data.others.length > 0 && (
              <li className="px-2 py-1.5 text-[11px] text-muted-foreground">
                另有 {data.others.length} 个非视频文件已隐藏
              </li>
            )}

            {/* 空目录 */}
            {data.dirs.length === 0 &&
              data.videos.length === 0 &&
              data.others.length === 0 && (
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
    </div>
  );
}
