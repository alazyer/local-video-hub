import { afterEach, describe, expect, test } from "bun:test";
import {
  importUrlVideosPayload,
  loadUrlVideos,
  saveUrlVideos,
} from "../src/lib/url-videos";
import { fetchRemotePlaylist } from "../src/lib/url-playlist-import";

const ORIGINAL_WINDOW = globalThis.window;

function installWindow(initialStorage: Record<string, string> = {}) {
  const storage = new Map(Object.entries(initialStorage));
  const localStorage = {
    getItem(key: string) {
      return storage.has(key) ? storage.get(key)! : null;
    },
    setItem(key: string, value: string) {
      storage.set(key, value);
    },
    removeItem(key: string) {
      storage.delete(key);
    },
  };

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { localStorage },
  });
}

afterEach(() => {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: ORIGINAL_WINDOW,
  });
  delete process.env.ALLOW_PRIVATE_NETWORK;
});

describe("importUrlVideosPayload", () => {
  test("merge 模式导入成功并统计重复/无效", () => {
    installWindow();
    saveUrlVideos([
      {
        id: "existing-1",
        name: "Existing",
        url: "https://cdn.example.com/existing.mp4",
        addedAt: 1,
      },
    ]);

    const result = importUrlVideosPayload(
      {
        videos: [
          {
            id: "existing-dup",
            name: "Dup",
            url: "https://cdn.example.com/existing.mp4",
            addedAt: 2,
          },
          {
            id: "new-1",
            name: "New",
            url: "https://cdn.example.com/new.mp4",
            addedAt: 3,
          },
          {
            id: "bad-1",
            name: "Bad",
            url: "file:///tmp/video.mp4",
            addedAt: 4,
          },
          {
            id: "dup-inside-import",
            name: "Dup2",
            url: "https://cdn.example.com/new.mp4",
            addedAt: 5,
          },
        ],
      },
      "merge",
    );

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.result).toEqual({
      total: 4,
      imported: 1,
      duplicates: 2,
      invalid: 1,
    });

    expect(loadUrlVideos().map((item) => item.url)).toEqual([
      "https://cdn.example.com/new.mp4",
      "https://cdn.example.com/existing.mp4",
    ]);
  });

  test("replace 模式在合法 payload 下完全替换", () => {
    installWindow();
    saveUrlVideos([
      {
        id: "existing-1",
        name: "Existing",
        url: "https://cdn.example.com/existing.mp4",
        addedAt: 1,
      },
    ]);

    const result = importUrlVideosPayload(
      {
        videos: [
          {
            id: "new-1",
            name: "New",
            url: "https://cdn.example.com/new.mp4",
            addedAt: 3,
          },
        ],
      },
      "replace",
    );

    expect(result.success).toBe(true);
    expect(loadUrlVideos().map((item) => item.url)).toEqual([
      "https://cdn.example.com/new.mp4",
    ]);
  });

  test("replace 回滚场景可恢复旧数据", () => {
    installWindow();
    const previousVideos = [
      {
        id: "existing-1",
        name: "Existing",
        url: "https://cdn.example.com/existing.mp4",
        addedAt: 1,
      },
    ];
    saveUrlVideos(previousVideos);

    const failed = importUrlVideosPayload({ bad: true }, "replace");
    expect(failed.success).toBe(false);

    const rollback = importUrlVideosPayload({ videos: previousVideos }, "replace");
    expect(rollback.success).toBe(true);
    expect(loadUrlVideos().map((item) => item.url)).toEqual([
      "https://cdn.example.com/existing.mp4",
    ]);
  });
});

describe("fetchRemotePlaylist", () => {
  test("fetches and validates playlist json", async () => {
    const result = await fetchRemotePlaylist("https://example.com/playlist.json", {
      fetchImpl: async () =>
        new Response(JSON.stringify({ videos: [{ url: "https://cdn.example.com/a.mp4" }] }), {
          status: 200,
          headers: { "content-type": "application/json; charset=utf-8" },
        }),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect((result.payload as { videos: Array<{ url: string }> }).videos[0]?.url).toBe(
      "https://cdn.example.com/a.mp4",
    );
  });

  test("rejects unsupported protocol", async () => {
    const result = await fetchRemotePlaylist("file:///tmp/playlist.json");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(400);
  });

  test("rejects non-json content-type", async () => {
    const result = await fetchRemotePlaylist("https://example.com/playlist.json", {
      fetchImpl: async () =>
        new Response("<html>oops</html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        }),
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(400);
  });

  test("rejects oversized response", async () => {
    const tooLarge = JSON.stringify({ videos: [{ url: "https://cdn.example.com/a.mp4", note: "x".repeat(256) }] });
    const result = await fetchRemotePlaylist("https://example.com/playlist.json", {
      maxBytes: 64,
      fetchImpl: async () =>
        new Response(tooLarge, {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(413);
  });

  test("aborts and reports failure when the request times out", async () => {
    const result = await fetchRemotePlaylist("https://example.com/playlist.json", {
      timeoutMs: 20,
      fetchImpl: async (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          const abortHandler = () => {
            const error = new Error("The operation was aborted");
            error.name = "AbortError";
            reject(error);
          };

          if (signal?.aborted) {
            abortHandler();
            return;
          }

          signal?.addEventListener("abort", abortHandler, { once: true });
        }),
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(502);
    expect(result.error).toContain("请求远端播放列表失败");
    expect(result.error).toContain("The operation was aborted");
  });

  test("blocks private network by default", async () => {
    const result = await fetchRemotePlaylist("http://127.0.0.1:8000/playlist.json", {
      fetchImpl: async () =>
        new Response(JSON.stringify({ videos: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(403);
  });
});
