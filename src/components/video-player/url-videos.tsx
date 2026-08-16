"use client";

import { useCallback, useMemo, useState } from "react";
import {
  Link as LinkIcon,
  Plus,
  Trash2,
  Download,
  Upload,
  Loader2,
  AlertCircle,
  RefreshCw,
  Search,
  ExternalLink,
  Globe,
  Shield,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
  ContextMenuSeparator,
} from "@/components/ui/context-menu";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { cn } from "@/lib/utils";
import {
  addUrlVideo,
  deleteUrlVideo,
  loadUrlVideos,
  clearAllUrlVideos,
  exportUrlVideosPayload,
  importUrlVideosPayload,
  isValidVideoUrl,
  isSameOrigin,
  type UrlVideo,
} from "@/lib/url-videos";
import { usePagination } from "@/hooks/use-pagination";
import { PagerBar } from "./pager-bar";

interface UrlVideosProps {
  onSelectVideo: (video: UrlVideo, useProxy: boolean) => void;
  currentId?: string | null;
}

export function UrlVideos({ onSelectVideo, currentId }: UrlVideosProps) {
  const [videos, setVideos] = useState<UrlVideo[]>(() => loadUrlVideos());
  const [search, setSearch] = useState("");
  const [addDialogOpen, setAddDialogOpen] = useState(false);

  const refresh = useCallback(() => {
    setVideos(loadUrlVideos());
  }, []);

  // 添加表单状态
  const [newUrl, setNewUrl] = useState("");
  const [newName, setNewName] = useState("");
  const [newNote, setNewNote] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const [remoteImportDialogOpen, setRemoteImportDialogOpen] = useState(false);
  const [remoteImportUrl, setRemoteImportUrl] = useState("");
  const [remoteImportMode, setRemoteImportMode] = useState<"merge" | "replace">("merge");
  const [remoteImporting, setRemoteImporting] = useState(false);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return videos;
    return videos.filter(
      (v) =>
        v.name.toLowerCase().includes(q) ||
        v.url.toLowerCase().includes(q) ||
        v.note?.toLowerCase().includes(q),
    );
  }, [videos, search]);

  const PAGE_SIZE = 50;
  const {
    paginatedItems,
    page,
    pageCount,
    nextPage,
    prevPage,
  } = usePagination(filtered, PAGE_SIZE);

  const handleAdd = async () => {
    setAdding(true);
    setAddError(null);
    try {
      const result = addUrlVideo(newUrl, newName, newNote);
      if (!result.success) {
        setAddError(result.error || "添加失败");
        return;
      }
      // 清空表单
      setNewUrl("");
      setNewName("");
      setNewNote("");
      setAddDialogOpen(false);
      refresh();
    } finally {
      setAdding(false);
    }
  };

  const handleDelete = (id: string) => {
    deleteUrlVideo(id);
    refresh();
  };

  const handleClearAll = () => {
    if (!confirm("确定要清空所有 URL 视频吗？")) return;
    clearAllUrlVideos();
    refresh();
  };

  const handleExport = () => {
    const payload = exportUrlVideosPayload();
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    a.href = url;
    a.download = `url-playlist-${timestamp}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    setImportMessage(`已导出 ${payload.videos.length} 条 URL 视频`);
  };

  const handleImport = async () => {
    setImporting(true);
    setImportMessage(null);
    try {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".json,application/json";

      const file: File | null = await new Promise((resolve) => {
        input.onchange = () => resolve(input.files?.[0] ?? null);
        input.click();
      });

      if (!file) return;

      const text = await file.text();
      let payload: unknown;
      try {
        payload = JSON.parse(text);
      } catch {
        setImportMessage("导入失败：文件不是合法 JSON");
        return;
      }

      const res = importUrlVideosPayload(payload, "merge");
      if (!res.success) {
        setImportMessage(`导入失败：${res.error}`);
        return;
      }

      const { imported, duplicates, invalid, total } = res.result;
      setImportMessage(
        `导入完成：共 ${total} 条，新增 ${imported} 条，重复 ${duplicates} 条，无效 ${invalid} 条`,
      );
      refresh();
    } finally {
      setImporting(false);
    }
  };

  const handleImportFromUrl = async () => {
    if (!remoteImportUrl.trim()) {
      setImportMessage("导入失败：URL 不能为空");
      return;
    }

    const validation = isValidVideoUrl(remoteImportUrl);
    if (!validation.valid) {
      setImportMessage(`导入失败：${validation.reason ?? "URL 不合法"}`);
      return;
    }

    setRemoteImporting(true);
    setImportMessage(null);

    const previousVideos = loadUrlVideos();

    try {
      const response = await fetch("/api/url-playlist/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: remoteImportUrl.trim() }),
      });

      const data = (await response.json().catch(() => null)) as {
        payload?: unknown;
        error?: string;
      } | null;

      if (!response.ok || !data?.payload) {
        setImportMessage(`导入失败：${data?.error ?? `请求失败（${response.status}）`}`);
        return;
      }

      const importResult = importUrlVideosPayload(data.payload, remoteImportMode);
      if (!importResult.success) {
        if (remoteImportMode === "replace") {
          // replace 模式导入失败时回滚
          const rollbackPayload = { videos: previousVideos };
          const rollbackResult = importUrlVideosPayload(rollbackPayload, "replace");
          if (!rollbackResult.success) {
            setImportMessage(
              `导入失败：${importResult.error}；且回滚失败，请手动重新导入备份`,
            );
            return;
          }
        }
        setImportMessage(`导入失败：${importResult.error}`);
        return;
      }

      const { imported, duplicates, invalid, total } = importResult.result;
      setImportMessage(
        `导入完成：共 ${total} 条，新增 ${imported} 条，重复 ${duplicates} 条，无效 ${invalid} 条（模式：${remoteImportMode}）`,
      );
      setRemoteImportDialogOpen(false);
      setRemoteImportUrl("");
      setRemoteImportMode("merge");
      refresh();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setImportMessage(`导入失败：${msg}`);
    } finally {
      setRemoteImporting(false);
    }
  };

  const handleSelect = (video: UrlVideo) => {
    // 同源 URL 直连；跨域 URL 也直连（绝大多数服务器支持 CORS 或 <video> 标签豁免）
    // 跨域 seek 受限的极端情况，用户可在右键菜单选"通过代理播放"
    onSelectVideo(video, false);
  };

  const handleSelectProxy = (video: UrlVideo) => {
    onSelectVideo(video, true);
  };

  return (
    <div className="flex flex-col h-full bg-card">
      {/* 顶部 */}
      <div className="px-3 py-2.5 border-b">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <LinkIcon className="w-4 h-4" />
            URL 视频
          </h2>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              onClick={handleExport}
              className="h-7 w-7"
              title="导出 URL 播放列表"
            >
              <Upload className="w-3.5 h-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => void handleImport()}
              className="h-7 w-7"
              title="导入 URL 播放列表（本地文件）"
              disabled={importing}
            >
              {importing ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Download className="w-3.5 h-3.5" />
              )}
            </Button>
            <Dialog
              open={remoteImportDialogOpen}
              onOpenChange={setRemoteImportDialogOpen}
            >
              <DialogTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  title="通过 URL 导入播放列表"
                >
                  <Globe className="w-3.5 h-3.5" />
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    <Globe className="w-4 h-4" />
                    通过 URL 导入播放列表
                  </DialogTitle>
                  <DialogDescription>
                    支持现有 JSON 播放列表格式（包含 videos 数组），可选择 merge 或 replace 导入模式。
                  </DialogDescription>
                </DialogHeader>

                <div className="space-y-3">
                  <div>
                    <Label htmlFor="remote-playlist-url">播放列表 URL *</Label>
                    <Input
                      id="remote-playlist-url"
                      value={remoteImportUrl}
                      onChange={(e) => setRemoteImportUrl(e.target.value)}
                      placeholder="https://example.com/url-playlist.json"
                      className="mt-1 font-mono text-xs"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>导入模式</Label>
                    <RadioGroup
                      value={remoteImportMode}
                      onValueChange={(value) =>
                        setRemoteImportMode(value === "replace" ? "replace" : "merge")
                      }
                      className="gap-2"
                    >
                      <label className="flex items-start gap-2 rounded border p-2 cursor-pointer">
                        <RadioGroupItem value="merge" id="remote-import-merge" />
                        <div className="text-xs leading-relaxed">
                          <p className="font-medium">merge（默认）</p>
                          <p className="text-muted-foreground">与现有列表合并，按 URL 去重。</p>
                        </div>
                      </label>
                      <label className="flex items-start gap-2 rounded border p-2 cursor-pointer">
                        <RadioGroupItem value="replace" id="remote-import-replace" />
                        <div className="text-xs leading-relaxed">
                          <p className="font-medium">replace</p>
                          <p className="text-muted-foreground">替换现有列表，导入失败时会回滚。</p>
                        </div>
                      </label>
                    </RadioGroup>
                  </div>

                  {remoteImportUrl && <UrlValidationHint url={remoteImportUrl} />}
                </div>

                <DialogFooter>
                  <Button
                    variant="outline"
                    onClick={() => setRemoteImportDialogOpen(false)}
                    disabled={remoteImporting}
                  >
                    取消
                  </Button>
                  <Button onClick={() => void handleImportFromUrl()} disabled={remoteImporting}>
                    {remoteImporting && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />}
                    导入
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
            <Button
              variant="ghost"
              size="icon"
              onClick={refresh}
              className="h-7 w-7"
              title="刷新"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </Button>
            <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
              <DialogTrigger asChild>
                <Button variant="ghost" size="icon" className="h-7 w-7" title="添加 URL">
                  <Plus className="w-3.5 h-3.5" />
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    <LinkIcon className="w-4 h-4" />
                    添加 URL 视频
                  </DialogTitle>
                  <DialogDescription>
                    输入任意 HTTP/HTTPS 视频地址，例如本地 python http.server、局域网 NAS、公网 CDN。
                  </DialogDescription>
                </DialogHeader>

                <div className="space-y-3">
                  <div>
                    <Label htmlFor="new-url">视频 URL *</Label>
                    <Input
                      id="new-url"
                      value={newUrl}
                      onChange={(e) => setNewUrl(e.target.value)}
                      placeholder="http://localhost:8000/a.mp4"
                      className="mt-1 font-mono text-xs"
                    />
                  </div>
                  <div>
                    <Label htmlFor="new-name">显示名称（可选）</Label>
                    <Input
                      id="new-name"
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      placeholder="留空则从 URL 推导"
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <Label htmlFor="new-note">备注（可选）</Label>
                    <Textarea
                      id="new-note"
                      value={newNote}
                      onChange={(e) => setNewNote(e.target.value)}
                      placeholder="比如：英语学习视频 / 第三集"
                      className="mt-1 text-xs min-h-[60px]"
                    />
                  </div>

                  {addError && (
                    <Alert variant="destructive">
                      <AlertCircle className="w-4 h-4" />
                      <AlertDescription className="text-xs">{addError}</AlertDescription>
                    </Alert>
                  )}

                  {/* 实时 URL 校验提示 */}
                  {newUrl && (
                    <UrlValidationHint url={newUrl} />
                  )}
                </div>

                <DialogFooter>
                  <Button
                    variant="outline"
                    onClick={() => setAddDialogOpen(false)}
                  >
                    取消
                  </Button>
                  <Button
                    onClick={handleAdd}
                    disabled={adding || !isValidVideoUrl(newUrl).valid}
                  >
                    {adding && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />}
                    添加
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        {/* 搜索 */}
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input
            placeholder="搜索 URL 视频..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 pl-8 text-sm"
          />
        </div>

        {importMessage && (
          <p className="mt-2 text-[11px] text-muted-foreground">{importMessage}</p>
        )}
      </div>

      {/* 列表 */}
      <ScrollArea className="flex-1 min-h-0">
        {filtered.length === 0 ? (
          <EmptyUrlList hasVideos={videos.length > 0} search={search} />
        ) : (
          <ul className="p-2 space-y-1">
            {paginatedItems.map((video) => (
              <UrlVideoItem
                key={video.id}
                video={video}
                isActive={video.id === currentId}
                onSelect={() => handleSelect(video)}
                onSelectProxy={() => handleSelectProxy(video)}
                onDelete={() => handleDelete(video.id)}
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

      {/* 底部 */}
      {videos.length > 0 && (
        <div className="px-3 py-2 border-t">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleClearAll}
            className="w-full text-destructive hover:text-destructive hover:bg-destructive/10 h-8 text-xs"
          >
            <Trash2 className="w-3.5 h-3.5 mr-1.5" />
            清空全部 ({videos.length})
          </Button>
        </div>
      )}
    </div>
  );
}

/** URL 校验提示：同源/跨域/代理建议 */
function UrlValidationHint({ url }: { url: string }) {
  const validation = isValidVideoUrl(url);
  if (!validation.valid) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="w-4 h-4" />
        <AlertDescription className="text-xs">
          {validation.reason}
        </AlertDescription>
      </Alert>
    );
  }

  const sameOrigin = isSameOrigin(url);
  return (
    <Alert>
      <Globe className="w-4 h-4" />
      <AlertDescription className="text-xs">
        {sameOrigin ? (
          <>同源地址，将直连播放（性能最佳）</>
        ) : (
          <>
            跨域地址。多数情况下 <code className="bg-muted px-1 rounded">{"<video>"}</code> 标签可直接播放；
            若发现<strong>进度条无法拖动</strong>，可在右键菜单选「通过代理播放」。
          </>
        )}
      </AlertDescription>
    </Alert>
  );
}

function UrlVideoItem({
  video,
  isActive,
  onSelect,
  onSelectProxy,
  onDelete,
}: {
  video: UrlVideo;
  isActive: boolean;
  onSelect: () => void;
  onSelectProxy: () => void;
  onDelete: () => void;
}) {
  const sameOrigin = isSameOrigin(video.url);
  // 从 URL 提取主机名用于显示
  let host = "";
  try {
    host = new URL(video.url).host;
  } catch {
    host = video.url.slice(0, 30);
  }

  const progress =
    video.duration && video.lastPosition
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
            {/* 图标 */}
            <div className="relative flex-shrink-0 w-20 h-12 bg-muted rounded overflow-hidden flex items-center justify-center text-muted-foreground">
              <LinkIcon className="w-5 h-5" />
              {sameOrigin ? (
                <Badge
                  variant="outline"
                  className="absolute top-0.5 left-0.5 text-[8px] py-0 px-1 h-3 bg-background/80"
                >
                  同源
                </Badge>
              ) : (
                <Badge
                  variant="outline"
                  className="absolute top-0.5 left-0.5 text-[8px] py-0 px-1 h-3 bg-background/80"
                >
                  跨域
                </Badge>
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
              <p
                className="text-[11px] text-muted-foreground truncate mt-0.5 font-mono"
                title={video.url}
              >
                {host}
              </p>
              {video.note && (
                <p className="text-[11px] text-muted-foreground truncate mt-0.5">
                  {video.note}
                </p>
              )}
              {progress > 5 && progress < 95 && (
                <div className="mt-1">
                  <div className="text-[10px] text-muted-foreground">
                    上次播放到 {Math.floor(video.lastPosition ?? 0)}s
                  </div>
                  <div className="mt-0.5 h-0.5 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary/60"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                </div>
              )}
            </div>
          </button>
        </li>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onClick={onSelect}>
          <LinkIcon className="w-3.5 h-3.5 mr-2" />
          直连播放
        </ContextMenuItem>
        <ContextMenuItem onClick={onSelectProxy}>
          <Shield className="w-3.5 h-3.5 mr-2" />
          通过代理播放
          <span className="ml-auto text-[10px] text-muted-foreground">解决跨域 seek</span>
        </ContextMenuItem>
        <ContextMenuItem
          onClick={() => window.open(video.url, "_blank")}
        >
          <ExternalLink className="w-3.5 h-3.5 mr-2" />
          在新标签打开
        </ContextMenuItem>
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

function EmptyUrlList({
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
        <p className="text-sm font-medium">未找到匹配的 URL 视频</p>
        <p className="text-xs mt-1">尝试调整搜索关键词</p>
      </div>
    );
  }
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4 text-center text-muted-foreground">
      <LinkIcon className="w-12 h-12 mb-3 opacity-30" />
      <p className="text-sm font-medium mb-1">URL 视频列表为空</p>
      <p className="text-xs mt-1 max-w-[220px]">
        点击右上角 <Plus className="w-3 h-3 inline mx-0.5" /> 添加任意 HTTP 视频地址
      </p>
      <div className="mt-4 text-[10px] text-muted-foreground/80 max-w-[240px] bg-muted/40 p-2 rounded text-left leading-relaxed">
        <p className="font-medium mb-1">典型用法：</p>
        <p>1. <code className="bg-muted px-1 rounded">python -m http.server</code></p>
        <p>2. 浏览器访问本应用，添加 URL</p>
        <p>3. URL 形如 http://localhost:8000/a.mp4</p>
      </div>
    </div>
  );
}
