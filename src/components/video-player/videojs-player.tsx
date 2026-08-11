"use client";

import { useEffect, useRef, useState } from "react";
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Rewind,
  FastForward,
  Volume2,
  VolumeX,
  Maximize,
  Minimize,
  RotateCcw,
  AlertCircle,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { formatDuration } from "@/lib/video-db";
import {
  resolveSources,
  type NormalizedSource,
} from "@/lib/source-resolver";
import { evaluateCapabilities } from "@/lib/capability-evaluator";
import { createFallbackState, nextFallbackSource } from "@/lib/fallback-policy";
import {
  emitPlaybackEvent,
  type PlaybackEventEmitter,
} from "@/lib/playback-telemetry";
import { evaluateDrmGate, type DrmRequirement } from "@/lib/drm-gate";
import {
  createVideoJsLikePlayer,
  type CreatePlayerResult,
  type VideoJsLikePlayer,
} from "@/lib/videojs-adapter";

const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];
const SEEK_STEP = 10;

interface VideoPlayerProps {
  /** 当前视频源 URL（blob: URL 或 object URL） */
  src: string | null;
  /** 标准化后的候选源（可选） */
  sources?: NormalizedSource[];
  /** 当前视频名称 */
  title?: string;
  /** 上次播放位置（秒），用于断点续播 */
  startPosition?: number;
  /** 时间更新回调 */
  onPositionChange?: (currentTime: number) => void;
  /** 播放结束回调 */
  onEnded?: () => void;
  /** 是否有上一个视频 */
  hasPrev?: boolean;
  /** 是否有下一个视频 */
  hasNext?: boolean;
  /** 切换到上一个 */
  onPrev?: () => void;
  /** 切换到下一个 */
  onNext?: () => void;
  /** 播放遥测回调 */
  onPlaybackEvent?: PlaybackEventEmitter;
  /** DRM 要求（有值时启用 capability gate） */
  drmRequirement?: DrmRequirement | null;
}

export function VideoPlayer({
  src,
  sources,
  title,
  startPosition = 0,
  onPositionChange,
  onEnded,
  hasPrev,
  hasNext,
  onPrev,
  onNext,
  onPlaybackEvent,
  drmRequirement,
}: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const hideControlsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const playerRef = useRef<VideoJsLikePlayer | null>(null);
  const runtimeStatusRef = useRef<CreatePlayerResult["status"] | null>(null);
  const activeSourcesRef = useRef<NormalizedSource[]>([]);
  const fallbackStateRef = useRef(createFallbackState(0));
  const startupStartRef = useRef<number | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [volume, setVolumeState] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [playbackRate, setPlaybackRateState] = useState(1);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showControls, setShowControls] = useState(true);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [scrubTime, setScrubTime] = useState(0);
  const [playerReady, setPlayerReady] = useState(false);

  // 防止过于频繁地持久化位置
  const lastPersistRef = useRef(0);

  // ⚠️ 关键：startPosition 只在 src 切换时使用一次，不能作为 src 加载 effect 的依赖。
  // 否则父组件每次更新 lastPosition 都会触发 v.load()，导致视频被重新加载并暂停。
  // 这里通过 ref 保存最新的 startPosition，在 src 变化时读取。
  // 注意：ref 的更新必须放在 useEffect 中（不能在渲染期间直接赋值，否则违反 react-hooks/refs 规则）。
  const startPositionRef = useRef(startPosition);
  useEffect(() => {
    startPositionRef.current = startPosition;
  }, [startPosition]);

  // 初始化/销毁 Video.js 实例
  useEffect(() => {
    const videoEl = videoRef.current;
    if (!videoEl || playerRef.current) return;

    let cancelled = false;
    void (async () => {
      const result = await createVideoJsLikePlayer(videoEl);
      if (cancelled) {
        result.player.dispose();
        return;
      }
      playerRef.current = result.player;
      runtimeStatusRef.current = result.status;
      setPlayerReady(true);
    })();

    return () => {
      cancelled = true;
      setPlayerReady(false);
      playerRef.current?.dispose();
      playerRef.current = null;
      runtimeStatusRef.current = null;
    };
  }, []);

  // ----- 加载视频源 -----
  useEffect(() => {
    const v = videoRef.current;
    const player = playerRef.current;
    if (!v || !player || !playerReady) return;

    if (!src) {
      player.reset();
      return;
    }

    const normalized = sources && sources.length > 0
      ? sources
      : resolveSources({ origin: "url", url: src });

    const runtimeStatus = runtimeStatusRef.current;
    const evaluated = evaluateCapabilities(normalized, v, {
      dashFeatureEnabled: runtimeStatus?.dashFeatureEnabled ?? false,
      dashPluginLoaded: runtimeStatus?.dashPluginLoaded ?? false,
    });
    const drmGate = evaluateDrmGate(drmRequirement, evaluated.capabilities.drmApiAvailable);
    if (!drmGate.allowed) {
      setError(drmGate.reason ?? "DRM 能力不足，无法播放");
      emitPlaybackEvent(onPlaybackEvent, {
        event: "drm-capability-failure",
        timestamp: Date.now(),
        src,
        detail: drmGate.reason,
      });
      return;
    }

    if (evaluated.playableSources.length === 0) {
      setError("当前浏览器不支持该流媒体协议");
      setIsBuffering(false);
      return;
    }

    activeSourcesRef.current = evaluated.playableSources;
    fallbackStateRef.current = createFallbackState(0);
    startupStartRef.current = Date.now();
    setError(null);

    const first = evaluated.playableSources[0];
    player.src({ src: first.src, type: first.type });
    player.load();

    const startPos = startPositionRef.current;
    if (startPos > 0) {
      const onLoaded = () => {
        if (v.duration && startPos < v.duration) {
          v.currentTime = startPos;
        }
        v.removeEventListener("loadedmetadata", onLoaded);
      };
      v.addEventListener("loadedmetadata", onLoaded);
    }
    // 仅依赖 src，不依赖 startPosition（避免每 5 秒触发 v.load() 导致视频暂停）
  }, [src, sources, drmRequirement, onPlaybackEvent, playerReady]);

  // ----- 事件监听 -----
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;

    const onPlay = () => {
      setIsPlaying(true);
      setError(null);
    };
    const onPause = () => {
      setIsPlaying(false);
      // 暂停时显示控制条（事件回调中 setState 合法）
      setShowControls(true);
      if (hideControlsTimerRef.current) {
        clearTimeout(hideControlsTimerRef.current);
        hideControlsTimerRef.current = null;
      }
    };
    const onLoadStart = () => {
      setError(null);
      setIsBuffering(true);
    };
    const onTimeUpdate = () => {
      if (!isScrubbing) setCurrentTime(v.currentTime);
      // 缓冲进度
      if (v.buffered.length > 0) {
        setBuffered(v.buffered.end(v.buffered.length - 1));
      }
      const now = Date.now();
      // 节流：5 秒才回调一次，避免父组件频繁 setState 触发重渲染
      if (onPositionChange && now - lastPersistRef.current > 5000) {
        lastPersistRef.current = now;
        onPositionChange(v.currentTime);
      }
    };
    const onLoadedMetadata = () => {
      setDuration(isFinite(v.duration) ? v.duration : 0);
      setVolumeState(v.volume);
      setIsMuted(v.muted);
      setPlaybackRateState(v.playbackRate);
    };
    const onWaiting = () => {
      setIsBuffering(true);
      emitPlaybackEvent(onPlaybackEvent, {
        event: "buffering",
        timestamp: Date.now(),
        src: videoRef.current?.currentSrc,
      });
    };
    const onPlaying = () => {
      setIsBuffering(false);
      setIsPlaying(true);
      if (startupStartRef.current) {
        emitPlaybackEvent(onPlaybackEvent, {
          event: "startup-latency",
          timestamp: Date.now(),
          src: videoRef.current?.currentSrc,
          durationMs: Date.now() - startupStartRef.current,
        });
        startupStartRef.current = null;
      }
    };
    const onCanPlay = () => setIsBuffering(false);
    const onEnded = () => {
      setIsPlaying(false);
      onEnded?.();
    };
    const onError = () => {
      const sourceList = activeSourcesRef.current;
      const sourceError = v.error?.message ?? "视频加载失败，可能是不支持的格式";
      const decision = nextFallbackSource(
        sourceList,
        fallbackStateRef.current,
        sourceError,
      );
      if (decision.nextIndex !== null && sourceList[decision.nextIndex]) {
        const nextSource = sourceList[decision.nextIndex];
        playerRef.current?.src({ src: nextSource.src, type: nextSource.type });
        playerRef.current?.load();
        emitPlaybackEvent(onPlaybackEvent, {
          event: "fallback-success",
          timestamp: Date.now(),
          src: nextSource.src,
          detail: decision.reason,
          errorType: decision.errorType,
        });
        return;
      }

      emitPlaybackEvent(onPlaybackEvent, {
        event: "fatal-error",
        timestamp: Date.now(),
        src: videoRef.current?.currentSrc,
        detail: sourceError,
        errorType: decision.errorType,
      });
      setError(sourceError);
      setIsBuffering(false);
    };
    const onVolumeChange = () => {
      setVolumeState(v.volume);
      setIsMuted(v.muted);
    };
    const onRateChange = () => setPlaybackRateState(v.playbackRate);

    v.addEventListener("play", onPlay);
    v.addEventListener("pause", onPause);
    v.addEventListener("loadstart", onLoadStart);
    v.addEventListener("timeupdate", onTimeUpdate);
    v.addEventListener("loadedmetadata", onLoadedMetadata);
    v.addEventListener("waiting", onWaiting);
    v.addEventListener("playing", onPlaying);
    v.addEventListener("canplay", onCanPlay);
    v.addEventListener("ended", onEnded);
    v.addEventListener("error", onError);
    v.addEventListener("volumechange", onVolumeChange);
    v.addEventListener("ratechange", onRateChange);

    return () => {
      v.removeEventListener("play", onPlay);
      v.removeEventListener("pause", onPause);
      v.removeEventListener("loadstart", onLoadStart);
      v.removeEventListener("timeupdate", onTimeUpdate);
      v.removeEventListener("loadedmetadata", onLoadedMetadata);
      v.removeEventListener("waiting", onWaiting);
      v.removeEventListener("playing", onPlaying);
      v.removeEventListener("canplay", onCanPlay);
      v.removeEventListener("ended", onEnded);
      v.removeEventListener("error", onError);
      v.removeEventListener("volumechange", onVolumeChange);
      v.removeEventListener("ratechange", onRateChange);
    };
  }, [onPositionChange, onEnded, isScrubbing, onPlaybackEvent]);

  // ----- 全屏状态 -----
  useEffect(() => {
    const onFsChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  // ----- 控制条自动隐藏 -----
  // 播放中且不在拖动进度条时，3 秒后自动隐藏控制条；其他情况保持显示
  useEffect(() => {
    if (!isPlaying || isScrubbing) {
      // 显示控制条
      if (hideControlsTimerRef.current) {
        clearTimeout(hideControlsTimerRef.current);
        hideControlsTimerRef.current = null;
      }
      // 这里仍需保证 showControls=true，但因为依赖项变化导致的重渲染中
      // setShowControls 会被合理触发；为避免 effect 中 setState，我们用一个
      // 单独的 effect 来同步 showControls。
      return;
    }
    const timer = setTimeout(() => {
      setShowControls(false);
    }, 3000);
    hideControlsTimerRef.current = timer;
    return () => {
      clearTimeout(timer);
    };
  }, [isPlaying, isScrubbing]);

  // 当 isPlaying / isScrubbing 变化时，控制条的显示由以下逻辑负责：
  //  - 暂停时：onPause 事件回调会 setShowControls(true) 并清除计时器
  //  - 播放时：上面的 effect 会在 3s 后自动隐藏
  //  - 用户交互时：handleUserActivity 重置计时并显示控制条

  // ----- 用户交互时显示控制条并重置自动隐藏计时 -----
  // 注意：此函数由事件处理器调用（非 effect），调用 setState 是合法的
  const handleUserActivity = () => {
    setShowControls(true);
    if (hideControlsTimerRef.current) {
      clearTimeout(hideControlsTimerRef.current);
      hideControlsTimerRef.current = null;
    }
    if (isPlaying && !isScrubbing) {
      hideControlsTimerRef.current = setTimeout(() => {
        setShowControls(false);
      }, 3000);
    }
  };

  // ----- 控制方法 -----
  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      void v.play().catch((e) => {
        setError("播放被浏览器拦截，请再次点击播放");
        console.warn(e);
      });
    } else {
      v.pause();
    }
  };

  const seekBy = (delta: number) => {
    const v = videoRef.current;
    if (!v) return;
    const target = Math.max(0, Math.min(v.duration || 0, v.currentTime + delta));
    v.currentTime = target;
    setCurrentTime(target);
  };

  const seekTo = (time: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = Math.max(0, Math.min(v.duration || 0, time));
    setCurrentTime(v.currentTime);
  };

  const setVolume = (vol: number) => {
    const v = videoRef.current;
    if (!v) return;
    const clamped = Math.max(0, Math.min(1, vol));
    v.volume = clamped;
    v.muted = clamped === 0;
  };

  const toggleMute = () => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = !v.muted;
  };

  const setPlaybackRate = (rate: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.playbackRate = rate;
  };

  const toggleFullscreen = async () => {
    const el = containerRef.current;
    if (!el) return;
    try {
      if (!document.fullscreenElement) {
        await el.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch (e) {
      console.warn("fullscreen failed", e);
    }
  };

  // ----- 键盘快捷键 -----
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.tabIndex = 0;

    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;

      switch (e.key) {
        case " ":
        case "k":
          e.preventDefault();
          togglePlay();
          break;
        case "ArrowLeft":
          e.preventDefault();
          seekBy(-SEEK_STEP);
          break;
        case "ArrowRight":
          e.preventDefault();
          seekBy(SEEK_STEP);
          break;
        case "ArrowUp":
          e.preventDefault();
          setVolume(Math.min(1, (videoRef.current?.volume ?? 1) + 0.1));
          break;
        case "ArrowDown":
          e.preventDefault();
          setVolume(Math.max(0, (videoRef.current?.volume ?? 1) - 0.1));
          break;
        case "m":
        case "M":
          toggleMute();
          break;
        case "f":
        case "F":
          void toggleFullscreen();
          break;
        case ",":
          setPlaybackRate(Math.max(0.5, (videoRef.current?.playbackRate ?? 1) - 0.25));
          break;
        case ".":
          setPlaybackRate(Math.min(3, (videoRef.current?.playbackRate ?? 1) + 0.25));
          break;
      }
      handleUserActivity();
    };

    el.addEventListener("keydown", onKey);
    return () => el.removeEventListener("keydown", onKey);
  }, []);

  // ----- 进度条交互 -----
  const handleProgressChange = (value: number[]) => {
    setIsScrubbing(true);
    const newTime = value[0];
    setScrubTime(newTime);
  };

  const handleProgressCommit = (value: number[]) => {
    seekTo(value[0]);
    setIsScrubbing(false);
  };

  const displayTime = isScrubbing ? scrubTime : currentTime;
  const bufferedPercent = duration > 0 ? (buffered / duration) * 100 : 0;

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full bg-black group focus:outline-none"
      onMouseMove={handleUserActivity}
      onMouseLeave={() => {
        if (isPlaying) setShowControls(false);
      }}
      onClick={(e) => {
        // 仅在点击视频本体时切换播放，避免误触控制条
        if (e.target === e.currentTarget || e.target === videoRef.current) {
          togglePlay();
        }
      }}
    >
      {/* 视频本体 */}
      {src ? (
        <video
          ref={videoRef}
          className="w-full h-full object-contain"
          preload="metadata"
          playsInline
          onClick={togglePlay}
        />
      ) : (
        <EmptyState />
      )}

      {/* 加载中 */}
      {isBuffering && src && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <Loader2 className="w-12 h-12 text-white/80 animate-spin" />
        </div>
      )}

      {/* 错误提示 */}
      {error && src && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="bg-red-900/80 text-white px-4 py-3 rounded-lg flex items-center gap-2 max-w-md">
            <AlertCircle className="w-5 h-5 flex-shrink-0" />
            <span className="text-sm">{error}</span>
          </div>
        </div>
      )}

      {/* 视频标题 */}
      {src && title && (
        <div
          className={`absolute top-0 left-0 right-0 p-4 bg-gradient-to-b from-black/80 to-transparent transition-opacity duration-300 ${
            showControls ? "opacity-100" : "opacity-0 pointer-events-none"
          }`}
        >
          <p className="text-white font-medium text-sm md:text-base truncate">{title}</p>
        </div>
      )}

      {/* 控制条 */}
      {src && (
        <div
          className={`absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 via-black/60 to-transparent transition-opacity duration-300 ${
            showControls ? "opacity-100" : "opacity-0 pointer-events-none"
          }`}
        >
          {/* 进度条 */}
          <div className="px-3 md:px-4 pt-6 pb-1">
            <div className="relative">
              {/* 缓冲指示 */}
              <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-1.5 bg-white/20 rounded-full overflow-hidden">
                <div
                  className="h-full bg-white/30"
                  style={{ width: `${bufferedPercent}%` }}
                />
              </div>
              <Slider
                value={[displayTime]}
                max={duration || 100}
                step={0.1}
                onValueChange={handleProgressChange}
                onValueCommit={handleProgressCommit}
                className="relative z-10 [&_[role=slider]]:bg-white [&_[role=slider]]:border-white [&_[role=slider]]:w-3.5 [&_[role=slider]]:h-3.5 [&_[role=slider]]:shadow-md [&>span:first-child]:bg-white/30"
              />
            </div>
          </div>

          {/* 按钮组 */}
          <div className="flex items-center gap-1 md:gap-2 px-3 md:px-4 pb-3 md:pb-4">
            {/* 上一曲 */}
            <Button
              variant="ghost"
              size="icon"
              onClick={onPrev}
              disabled={!hasPrev}
              className="text-white hover:bg-white/20 disabled:opacity-30 h-9 w-9 md:h-10 md:w-10"
              title="上一个视频"
            >
              <SkipBack className="w-4 h-4 md:w-5 md:h-5" />
            </Button>

            {/* 快退 10s */}
            <Button
              variant="ghost"
              size="icon"
              onClick={() => seekBy(-SEEK_STEP)}
              className="text-white hover:bg-white/20 h-9 w-9 md:h-10 md:w-10"
              title={`快退 ${SEEK_STEP} 秒`}
            >
              <Rewind className="w-4 h-4 md:w-5 md:h-5" />
            </Button>

            {/* 播放/暂停 */}
            <Button
              variant="ghost"
              size="icon"
              onClick={togglePlay}
              className="text-white hover:bg-white/20 h-10 w-10 md:h-12 md:w-12"
              title={isPlaying ? "暂停" : "播放"}
            >
              {isPlaying ? (
                <Pause className="w-5 h-5 md:w-6 md:h-6" />
              ) : (
                <Play className="w-5 h-5 md:w-6 md:h-6 ml-0.5" />
              )}
            </Button>

            {/* 快进 10s */}
            <Button
              variant="ghost"
              size="icon"
              onClick={() => seekBy(SEEK_STEP)}
              className="text-white hover:bg-white/20 h-9 w-9 md:h-10 md:w-10"
              title={`快进 ${SEEK_STEP} 秒`}
            >
              <FastForward className="w-4 h-4 md:w-5 md:h-5" />
            </Button>

            {/* 下一曲 */}
            <Button
              variant="ghost"
              size="icon"
              onClick={onNext}
              disabled={!hasNext}
              className="text-white hover:bg-white/20 disabled:opacity-30 h-9 w-9 md:h-10 md:w-10"
              title="下一个视频"
            >
              <SkipForward className="w-4 h-4 md:w-5 md:h-5" />
            </Button>

            {/* 时间 */}
            <div className="ml-1 md:ml-2 text-white text-xs md:text-sm font-mono tabular-nums">
              {formatDuration(displayTime)} / {formatDuration(duration)}
            </div>

            <div className="flex-1" />

            {/* 重置倍速 */}
            {playbackRate !== 1 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setPlaybackRate(1)}
                className="text-white hover:bg-white/20 h-8 px-2 hidden sm:flex"
                title="恢复 1x 倍速"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </Button>
            )}

            {/* 倍速选择 */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-white hover:bg-white/20 h-9 px-2.5 text-xs md:text-sm font-mono"
                  title="播放倍速"
                >
                  {playbackRate}x
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-[120px]">
                <DropdownMenuLabel>播放倍速</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {PLAYBACK_RATES.map((rate) => (
                  <DropdownMenuItem
                    key={rate}
                    onClick={() => setPlaybackRate(rate)}
                    className={rate === playbackRate ? "bg-accent" : ""}
                  >
                    {rate}x{rate === 1 ? " (正常)" : ""}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            {/* 音量 */}
            <div className="flex items-center gap-1 group/vol">
              <Button
                variant="ghost"
                size="icon"
                onClick={toggleMute}
                className="text-white hover:bg-white/20 h-9 w-9 md:h-10 md:w-10"
                title={isMuted ? "取消静音" : "静音"}
              >
                {isMuted || volume === 0 ? (
                  <VolumeX className="w-4 h-4 md:w-5 md:h-5" />
                ) : (
                  <Volume2 className="w-4 h-4 md:w-5 md:h-5" />
                )}
              </Button>
              <div className="w-0 group-hover/vol:w-20 md:w-20 overflow-hidden transition-all duration-200">
                <Slider
                  value={[isMuted ? 0 : volume]}
                  max={1}
                  step={0.05}
                  onValueChange={(v) => setVolume(v[0])}
                  className="[&_[role=slider]]:bg-white [&_[role=slider]]:border-white [&_[role=slider]]:w-3 [&_[role=slider]]:h-3 [&>span:first-child]:bg-white/30"
                />
              </div>
            </div>

            {/* 全屏 */}
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleFullscreen}
              className="text-white hover:bg-white/20 h-9 w-9 md:h-10 md:w-10"
              title={isFullscreen ? "退出全屏" : "全屏"}
            >
              {isFullscreen ? (
                <Minimize className="w-4 h-4 md:w-5 md:h-5" />
              ) : (
                <Maximize className="w-4 h-4 md:w-5 md:h-5" />
              )}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center text-white/60 p-8 text-center">
      <Play className="w-16 h-16 mb-4 opacity-50" />
      <p className="text-lg font-medium mb-1">未选择视频</p>
      <p className="text-sm opacity-80">
        从右侧列表选择视频，或点击「添加视频」按钮上传本地视频文件
      </p>
      <p className="text-xs opacity-60 mt-4 max-w-md">
        支持的格式：MP4 / WebM / OGG / MOV / MKV 等
        <br />
        快捷键：空格=播放/暂停，←/→=快退/快进，↑/↓=音量，M=静音，F=全屏
      </p>
    </div>
  );
}
