"use client";

import { useState, useEffect } from "react";
import {
  Cloud,
  ExternalLink,
  Loader2,
  KeyRound,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert";

interface BaiduPanSettingsProps {
  onConfigChange?: () => void;
}

interface PanStatus {
  configured: boolean;
  hasAppKey: boolean;
  tokenExpired: boolean;
  expiresAt?: number;
}

export function BaiduPanSettings({ onConfigChange }: BaiduPanSettingsProps) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<PanStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 表单字段
  const [appId, setAppId] = useState("");
  const [appKey, setAppKey] = useState("");
  const [secretKey, setSecretKey] = useState("");
  const [accessToken, setAccessToken] = useState("");

  // OAuth 模式
  const [authorizeUrl, setAuthorizeUrl] = useState<string | null>(null);
  const [authCode, setAuthCode] = useState("");
  const [redirectUri, setRedirectUri] = useState("");

  useEffect(() => {
    if (open) {
      void refreshStatus();
      // 自动填回调地址
      setRedirectUri(`${window.location.origin}/api/baidu-pan/auth/callback`);
    }
  }, [open]);

  const refreshStatus = async () => {
    try {
      const res = await fetch("/api/baidu-pan/auth?action=status");
      const data = await res.json();
      setStatus(data);
    } catch (e) {
      console.warn("获取状态失败", e);
    }
  };

  // 模式 1: 手动填 token
  const handleSaveManual = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/baidu-pan/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          appId,
          appKey,
          secretKey,
          accessToken,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "保存失败");
      }
      await refreshStatus();
      onConfigChange?.();
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  // 模式 2: 获取授权 URL
  const handleGetAuthorizeUrl = async () => {
    setLoading(true);
    setError(null);
    try {
      if (!appKey) {
        throw new Error("请先填写 AppKey");
      }
      const res = await fetch(
        `/api/baidu-pan/auth?action=authorize&appKey=${encodeURIComponent(appKey)}&redirectUri=${encodeURIComponent(redirectUri)}`,
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "获取授权 URL 失败");
      setAuthorizeUrl(data.authorizeUrl);
      // 自动打开新窗口
      window.open(data.authorizeUrl, "_blank");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  // 模式 2: 用 code 换 token
  const handleExchangeCode = async () => {
    setLoading(true);
    setError(null);
    try {
      if (!authCode) {
        throw new Error("请填写授权码");
      }
      if (!appKey || !secretKey) {
        throw new Error("请先填写 AppKey 和 SecretKey");
      }
      // 先保存 AppKey/SecretKey
      await fetch("/api/baidu-pan/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appId, appKey, secretKey, accessToken: "" }),
      });

      // 再用 code 换 token（这里 accessToken 为空会先保存 appKey/secretKey 但 token 为空，需特殊处理）
      // 实际上后端 POST 在 accessToken 为空时会失败，所以我们改为直接调换 token 接口
      const res = await fetch("/api/baidu-pan/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: authCode,
          redirectUri,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "换取 token 失败");
      await refreshStatus();
      onConfigChange?.();
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  // 清除配置
  const handleClear = async () => {
    if (!confirm("确定要清除百度网盘配置吗？")) return;
    setLoading(true);
    try {
      await fetch("/api/baidu-pan/auth", { method: "DELETE" });
      await refreshStatus();
      onConfigChange?.();
      setAccessToken("");
      setAuthCode("");
      setAuthorizeUrl(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs gap-1.5"
          title="百度网盘设置"
        >
          <Cloud className="w-3.5 h-3.5" />
          {status?.configured ? (
            <span className="flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3 text-green-500" />
              已绑定
            </span>
          ) : status === null ? (
            "未配置"
          ) : (
            <span className="flex items-center gap-1">
              <XCircle className="w-3 h-3 text-muted-foreground" />
              未配置
            </span>
          )}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Cloud className="w-5 h-5" />
            百度网盘配置
          </DialogTitle>
          <DialogDescription>
            配置后可浏览网盘视频并通过流代理播放。所有配置仅保存在本地服务端，不会上传到任何第三方。
          </DialogDescription>
        </DialogHeader>

        {/* 当前状态 */}
        {status?.configured && (
          <Alert>
            <CheckCircle2 className="w-4 h-4 text-green-500" />
            <AlertTitle>已绑定百度网盘</AlertTitle>
            <AlertDescription>
              {status.tokenExpired
                ? "Token 已过期，请重新授权"
                : status.expiresAt
                  ? `Token 有效期至：${new Date(status.expiresAt).toLocaleString("zh-CN")}`
                  : "Token 有效"}
            </AlertDescription>
          </Alert>
        )}

        {/* 申请指引 */}
        <Alert>
          <KeyRound className="w-4 h-4" />
          <AlertTitle>如何获取 AppKey / SecretKey？</AlertTitle>
          <AlertDescription>
            <ol className="list-decimal ml-4 mt-1 space-y-1 text-xs">
              <li>
                访问{" "}
                <a
                  href="https://pan.baidu.com/union/apply"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary underline inline-flex items-center gap-0.5"
                >
                  百度网盘开放平台
                  <ExternalLink className="w-3 h-3" />
                </a>{" "}
                申请开发者认证（个人/企业）
              </li>
              <li>创建应用，勾选「网盘基础能力」和「网盘影音能力」</li>
              <li>配置回调地址为：<code className="bg-muted px-1 rounded text-[10px]">{redirectUri || "/api/baidu-pan/auth/callback"}</code></li>
              <li>在应用详情页获取 AppKey / SecretKey / AppID</li>
            </ol>
          </AlertDescription>
        </Alert>

        <Tabs defaultValue="manual">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="manual">
              <KeyRound className="w-3.5 h-3.5 mr-1.5" />
              手动填 Token（推荐）
            </TabsTrigger>
            <TabsTrigger value="oauth">
              <ExternalLink className="w-3.5 h-3.5 mr-1.5" />
              OAuth 跳转授权
            </TabsTrigger>
          </TabsList>

          {/* 模式 1: 手动填 token */}
          <TabsContent value="manual" className="space-y-3 mt-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="appId">App ID（可选）</Label>
                <Input
                  id="appId"
                  value={appId}
                  onChange={(e) => setAppId(e.target.value)}
                  placeholder="如 12345678"
                  className="mt-1"
                />
              </div>
              <div>
                <Label htmlFor="appKey">AppKey（可选）</Label>
                <Input
                  id="appKey"
                  value={appKey}
                  onChange={(e) => setAppKey(e.target.value)}
                  placeholder="如 abc123def456"
                  className="mt-1"
                />
              </div>
            </div>
            <div>
              <Label htmlFor="secretKey">SecretKey（可选）</Label>
              <Input
                id="secretKey"
                type="password"
                value={secretKey}
                onChange={(e) => setSecretKey(e.target.value)}
                placeholder="仅在需要 OAuth 刷新时使用"
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="accessToken">Access Token *</Label>
              <Input
                id="accessToken"
                type="password"
                value={accessToken}
                onChange={(e) => setAccessToken(e.target.value)}
                placeholder="必填，从百度网盘开放平台获取"
                className="mt-1 font-mono text-xs"
              />
              <p className="text-xs text-muted-foreground mt-1">
                获取方式：使用 OAuth 调试工具或访问{" "}
                <a
                  href="https://pan.baidu.com/union/doc/fl1ka3mqf"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary underline inline-flex items-center gap-0.5"
                >
                  官方文档
                  <ExternalLink className="w-3 h-3" />
                </a>
              </p>
            </div>

            {error && (
              <Alert variant="destructive">
                <XCircle className="w-4 h-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <div className="flex justify-between">
              {status?.configured ? (
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={handleClear}
                  disabled={loading}
                >
                  清除配置
                </Button>
              ) : (
                <span />
              )}
              <Button
                onClick={handleSaveManual}
                disabled={loading || !accessToken}
              >
                {loading && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />}
                保存配置
              </Button>
            </div>
          </TabsContent>

          {/* 模式 2: OAuth 跳转授权 */}
          <TabsContent value="oauth" className="space-y-3 mt-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="appId2">App ID</Label>
                <Input
                  id="appId2"
                  value={appId}
                  onChange={(e) => setAppId(e.target.value)}
                  placeholder="如 12345678"
                  className="mt-1"
                />
              </div>
              <div>
                <Label htmlFor="appKey2">AppKey *</Label>
                <Input
                  id="appKey2"
                  value={appKey}
                  onChange={(e) => setAppKey(e.target.value)}
                  placeholder="必填"
                  className="mt-1"
                />
              </div>
            </div>
            <div>
              <Label htmlFor="secretKey2">SecretKey *</Label>
              <Input
                id="secretKey2"
                type="password"
                value={secretKey}
                onChange={(e) => setSecretKey(e.target.value)}
                placeholder="必填"
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="redirectUri">回调地址</Label>
              <Input
                id="redirectUri"
                value={redirectUri}
                onChange={(e) => setRedirectUri(e.target.value)}
                className="mt-1 font-mono text-xs"
              />
              <p className="text-xs text-muted-foreground mt-1">
                必须与百度网盘开放平台应用配置中填写的回调地址一致
              </p>
            </div>

            <div className="flex flex-col gap-2">
              <Button
                variant="outline"
                onClick={handleGetAuthorizeUrl}
                disabled={loading || !appKey}
              >
                {loading ? (
                  <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                ) : (
                  <ExternalLink className="w-4 h-4 mr-1.5" />
                )}
                打开百度授权页
              </Button>
              {authorizeUrl && (
                <p className="text-xs text-muted-foreground break-all">
                  授权 URL：
                  <a
                    href={authorizeUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary underline ml-1"
                  >
                    {authorizeUrl.slice(0, 80)}...
                  </a>
                </p>
              )}
            </div>

            <div>
              <Label htmlFor="authCode">授权码（Code）</Label>
              <Input
                id="authCode"
                value={authCode}
                onChange={(e) => setAuthCode(e.target.value)}
                placeholder="授权完成后从回调 URL 中复制 code 参数"
                className="mt-1 font-mono text-xs"
              />
              <p className="text-xs text-muted-foreground mt-1">
                授权完成后，百度会跳转到回调地址，URL 中会带{" "}
                <code className="bg-muted px-1 rounded text-[10px]">?code=xxxx</code>
              </p>
            </div>

            {error && (
              <Alert variant="destructive">
                <XCircle className="w-4 h-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <div className="flex justify-end">
              <Button
                onClick={handleExchangeCode}
                disabled={loading || !authCode || !appKey || !secretKey}
              >
                {loading && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />}
                用授权码换取 Token
              </Button>
            </div>
          </TabsContent>
        </Tabs>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            关闭
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
