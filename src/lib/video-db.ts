/**
 * IndexedDB 封装：用于本地视频文件的持久化存储。
 *
 * 设计要点：
 * - videos 仓库存放 File 对象（含 blob、type、name 等元数据），保证刷新后仍可播放。
 * - meta 仓库存放视频元信息（id、名称、时长、缩略图、添加时间、最近播放时间等），便于列表展示。
 *
 * 选择 IndexedDB 而非 localStorage：
 *  1. 可直接存储 File/Blob 对象，无需 base64 编码（localStorage 上限约 5MB）。
 *  2. 支持大量数据存储（数百 MB ~ GB 级别），适合本地视频场景。
 *  3. 异步 API，不阻塞主线程，性能更佳。
 *
 * 兼容性：所有现代浏览器与 Capacitor / Cordova WebView 均支持 IndexedDB。
 */

const DB_NAME = "local-video-player";
const DB_VERSION = 1;
const STORE_VIDEOS = "videos"; // 存放 File / Blob
const STORE_META = "meta"; // 存放视频元数据

export interface VideoMeta {
  id: string;
  name: string;
  size: number;
  type: string;
  duration: number; // 秒，未知为 0
  thumbnail?: string; // dataURL 缩略图
  addedAt: number; // 添加时间戳
  lastPlayedAt?: number; // 最近播放时间戳
  lastPosition?: number; // 上次播放位置（秒），用于断点续播
  source: "manual" | "scan"; // 来源
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_VIDEOS)) {
        db.createObjectStore(STORE_VIDEOS);
      }
      if (!db.objectStoreNames.contains(STORE_META)) {
        const store = db.createObjectStore(STORE_META, { keyPath: "id" });
        store.createIndex("addedAt", "addedAt", { unique: false });
        store.createIndex("lastPlayedAt", "lastPlayedAt", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

/** 生成简单的唯一 ID（兼容浏览器无 crypto.randomUUID 的环境） */
export function generateId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `v-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/** 保存一个视频文件 + 元数据 */
export async function saveVideo(
  file: File,
  source: "manual" | "scan" = "manual",
): Promise<VideoMeta> {
  const db = await openDB();
  const id = generateId();
  const meta: VideoMeta = {
    id,
    name: file.name,
    size: file.size,
    type: file.type || guessVideoMime(file.name),
    duration: 0,
    addedAt: Date.now(),
    source,
  };

  // 写入视频文件
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_VIDEOS, "readwrite");
    tx.objectStore(STORE_VIDEOS).put(file, id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

  // 写入元数据
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_META, "readwrite");
    tx.objectStore(STORE_META).put(meta);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

  // 异步提取时长与缩略图（不阻塞保存流程）
  extractMeta(file, id).catch((e) => console.warn("extractMeta failed", e));

  return meta;
}

/** 异步提取视频时长 + 缩略图，并更新到 meta */
async function extractMeta(file: File, id: string): Promise<void> {
  const url = URL.createObjectURL(file);
  try {
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    video.src = url;

    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error("metadata load failed"));
    });

    const duration = isFinite(video.duration) ? video.duration : 0;

    // 尝试抓取缩略图：seek 到 1s 或 10% 处
    let thumbnail: string | undefined;
    try {
      const seekTarget = Math.min(1, duration * 0.1);
      await new Promise<void>((resolve) => {
        const onSeeked = () => {
          video.removeEventListener("seeked", onSeeked);
          resolve();
        };
        video.addEventListener("seeked", onSeeked);
        video.currentTime = seekTarget;
        // 兜底：1.5s 后强制 resolve
        setTimeout(() => {
          video.removeEventListener("seeked", onSeeked);
          resolve();
        }, 1500);
      });

      const canvas = document.createElement("canvas");
      const ratio = video.videoHeight / video.videoWidth || 0.5625;
      canvas.width = 320;
      canvas.height = Math.round(320 * ratio);
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        thumbnail = canvas.toDataURL("image/jpeg", 0.7);
      }
    } catch (e) {
      console.warn("thumbnail extraction failed", e);
    }

    await updateMeta(id, { duration, thumbnail });
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** 更新元数据（合并） */
export async function updateMeta(
  id: string,
  patch: Partial<VideoMeta>,
): Promise<void> {
  const db = await openDB();
  const existing = await getMeta(id);
  if (!existing) return;
  const updated = { ...existing, ...patch };
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_META, "readwrite");
    tx.objectStore(STORE_META).put(updated);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** 获取单个元数据 */
export async function getMeta(id: string): Promise<VideoMeta | undefined> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_META, "readonly");
    const req = tx.objectStore(STORE_META).get(id);
    req.onsuccess = () => resolve(req.result as VideoMeta | undefined);
    req.onerror = () => reject(req.error);
  });
}

/** 列出所有元数据，按添加时间倒序 */
export async function listMeta(): Promise<VideoMeta[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_META, "readonly");
    const req = tx.objectStore(STORE_META).getAll();
    req.onsuccess = () => {
      const list = (req.result as VideoMeta[]) || [];
      list.sort((a, b) => b.addedAt - a.addedAt);
      resolve(list);
    };
    req.onerror = () => reject(req.error);
  });
}

/** 读取视频 File 对象 */
export async function getVideoFile(id: string): Promise<Blob | undefined> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_VIDEOS, "readonly");
    const req = tx.objectStore(STORE_VIDEOS).get(id);
    req.onsuccess = () => resolve(req.result as Blob | undefined);
    req.onerror = () => reject(req.error);
  });
}

/** 删除视频（文件 + 元数据） */
export async function deleteVideo(id: string): Promise<void> {
  const db = await openDB();
  await Promise.all([
    new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_VIDEOS, "readwrite");
      tx.objectStore(STORE_VIDEOS).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    }),
    new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_META, "readwrite");
      tx.objectStore(STORE_META).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    }),
  ]);
}

/** 清空全部 */
export async function clearAll(): Promise<void> {
  const db = await openDB();
  await Promise.all([
    new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_VIDEOS, "readwrite");
      tx.objectStore(STORE_VIDEOS).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    }),
    new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_META, "readwrite");
      tx.objectStore(STORE_META).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    }),
  ]);
}

/** 判断文件是否为视频 */
export function isVideoFile(file: File): boolean {
  if (file.type.startsWith("video/")) return true;
  // 兜底：根据扩展名判断
  return /\.(mp4|webm|ogg|mov|m4v|mkv|avi|flv|wmv|3gp|ts)$/i.test(file.name);
}

function guessVideoMime(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "mp4":
    case "m4v":
      return "video/mp4";
    case "webm":
      return "video/webm";
    case "ogg":
    case "ogv":
      return "video/ogg";
    case "mov":
      return "video/quicktime";
    case "mkv":
      return "video/x-matroska";
    case "avi":
      return "video/x-msvideo";
    case "flv":
      return "video/x-flv";
    case "wmv":
      return "video/x-ms-wmv";
    case "3gp":
      return "video/3gpp";
    case "ts":
      return "video/mp2t";
    default:
      return "video/mp4";
  }
}

/** 格式化时长为 mm:ss 或 hh:mm:ss */
export function formatDuration(seconds: number): string {
  if (!isFinite(seconds) || seconds <= 0) return "00:00";
  const s = Math.floor(seconds % 60);
  const m = Math.floor((seconds / 60) % 60);
  const h = Math.floor(seconds / 3600);
  const pad = (n: number) => String(n).padStart(2, "0");
  if (h > 0) return `${pad(h)}:${pad(m)}:${pad(s)}`;
  return `${pad(m)}:${pad(s)}`;
}

/** 格式化文件大小 */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
