"use client";

import React from "react";
import { AlertCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ErrorBoundaryProps {
  children: React.ReactNode;
  /** 自定义错误回退 UI */
  fallback?: (error: Error, reset: () => void) => React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

/**
 * 通用错误边界
 *
 * 用于防止子组件抛出的运行时错误冒泡到 React 根，
 * 导致 Next.js Fast Refresh 触发页面全量重载。
 *
 * 典型场景：
 *  - 视频流被取消时 controller 已 close，调用 error() 抛 TypeError
 *  - 网络中断导致 fetch 抛 AbortError
 *  - IndexedDB 操作失败
 */
export class ErrorBoundary extends React.Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  override componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("ErrorBoundary caught:", error, info.componentStack);
  }

  reset = () => {
    this.setState({ hasError: false, error: null });
  };

  override render() {
    if (this.state.hasError && this.state.error) {
      if (this.props.fallback) {
        return this.props.fallback(this.state.error, this.reset);
      }
      return (
        <div className="flex flex-col items-center justify-center h-full p-8 text-center">
          <AlertCircle className="w-12 h-12 text-destructive mb-3" />
          <p className="text-sm font-medium mb-1">播放器发生错误</p>
          <p className="text-xs text-muted-foreground mb-4 max-w-md break-words">
            {this.state.error.message || "未知错误"}
          </p>
          <Button onClick={this.reset} size="sm">
            <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
            重试
          </Button>
        </div>
      );
    }
    return this.props.children;
  }
}
