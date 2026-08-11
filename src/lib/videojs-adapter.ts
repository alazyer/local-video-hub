export interface VideoJsLikePlayer {
  src: (source: { src: string; type?: string }) => void;
  load: () => void;
  reset: () => void;
  dispose: () => void;
}

type VideoJsFactory = (
  element: HTMLVideoElement,
  options?: Record<string, unknown>,
) => VideoJsInstance;

interface VideoJsInstance {
  src: (source: { src: string; type?: string } | Array<{ src: string; type?: string }>) => void;
  load: () => void;
  pause: () => void;
  dispose: () => void;
}

interface VideoJsStatic extends VideoJsFactory {
  getPlugin?: (name: string) => unknown;
}

interface WindowWithVideoJs extends Window {
  videojs?: VideoJsStatic;
}

export interface VideoJsRuntimeStatus {
  engine: "videojs" | "native";
  dashFeatureEnabled: boolean;
  dashPluginLoaded: boolean;
  runtimeError?: string;
}

export interface CreatePlayerResult {
  player: VideoJsLikePlayer;
  status: VideoJsRuntimeStatus;
}

const VIDEOJS_CDN = "https://vjs.zencdn.net/8.23.4/video.min.js";
const DASHJS_CDN = "https://cdn.jsdelivr.net/npm/dashjs@4.7.4/dist/dash.all.min.js";
const VIDEOJS_DASH_CDN =
  "https://cdn.jsdelivr.net/npm/videojs-contrib-dash@5.1.0/dist/videojs-dash.min.js";

function isDashFeatureEnabled(): boolean {
  return process.env.NEXT_PUBLIC_ENABLE_DASH_PLAYBACK === "true";
}

function loadScriptOnce(id: string, src: string): Promise<void> {
  if (typeof document === "undefined") {
    return Promise.reject(new Error("Document is unavailable in this runtime."));
  }

  const existing = document.getElementById(id) as HTMLScriptElement | null;
  if (existing) {
    if (existing.dataset.loaded === "true") return Promise.resolve();
    return new Promise((resolve, reject) => {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error(`Failed to load script: ${src}`)), {
        once: true,
      });
    });
  }

  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.id = id;
    script.src = src;
    script.async = true;
    script.crossOrigin = "anonymous";
    script.onload = () => {
      script.dataset.loaded = "true";
      resolve();
    };
    script.onerror = () => reject(new Error(`Failed to load script: ${src}`));
    document.head.appendChild(script);
  });
}

function createNativeFallback(video: HTMLVideoElement): VideoJsLikePlayer {
  return {
    src(source) {
      video.src = source.src;
      if (source.type) {
        video.setAttribute("type", source.type);
      } else {
        video.removeAttribute("type");
      }
    },
    load() {
      video.load();
    },
    reset() {
      video.removeAttribute("src");
      video.removeAttribute("type");
      video.load();
    },
    dispose() {
      video.pause();
      video.removeAttribute("src");
      video.removeAttribute("type");
      video.load();
    },
  };
}

export async function createVideoJsLikePlayer(video: HTMLVideoElement): Promise<CreatePlayerResult> {
  const dashFeatureEnabled = isDashFeatureEnabled();
  const fallback = createNativeFallback(video);

  try {
    await loadScriptOnce("videojs-runtime", VIDEOJS_CDN);
    if (dashFeatureEnabled) {
      await loadScriptOnce("dashjs-runtime", DASHJS_CDN);
      await loadScriptOnce("videojs-dash-plugin", VIDEOJS_DASH_CDN);
    }

    const win = window as WindowWithVideoJs;
    const videojs = win.videojs;
    if (!videojs) {
      return {
        player: fallback,
        status: {
          engine: "native",
          dashFeatureEnabled,
          dashPluginLoaded: false,
          runtimeError: "Video.js runtime did not initialize. Falling back to native video element.",
        },
      };
    }

    const instance = videojs(video, {
      controls: false,
      preload: "metadata",
      fluid: false,
      html5: {
        vhs: {
          overrideNative: false,
        },
      },
    });
    const dashPluginLoaded = Boolean(videojs.getPlugin?.("dash"));

    return {
      player: {
        src(source) {
          instance.src(source);
        },
        load() {
          instance.load();
        },
        reset() {
          instance.pause();
          instance.src([]);
          instance.load();
        },
        dispose() {
          instance.dispose();
        },
      },
      status: {
        engine: "videojs",
        dashFeatureEnabled,
        dashPluginLoaded,
      },
    };
  } catch (error) {
    return {
      player: fallback,
      status: {
        engine: "native",
        dashFeatureEnabled,
        dashPluginLoaded: false,
        runtimeError:
          error instanceof Error
            ? `${error.message} Falling back to native video element.`
            : "Video.js runtime load failed. Falling back to native video element.",
      },
    };
  }
}
