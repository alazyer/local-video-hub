import { isAddressAllowed, parseHttpUrl } from "@/lib/http-proxy-security";

const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_MAX_BYTES = 1024 * 1024;

type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export interface RemotePlaylistFetchOptions {
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  maxBytes?: number;
}

export type RemotePlaylistFetchResult =
  | { ok: true; payload: unknown }
  | { ok: false; status: number; error: string };

function isJsonContentType(contentType: string | null): boolean {
  if (!contentType) return false;
  const normalized = contentType.toLowerCase();
  return normalized.includes("application/json") || normalized.includes("+json");
}

async function readTextWithLimit(
  response: Response,
  maxBytes: number,
): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  const body = response.body;
  if (!body) {
    return { ok: false, error: "响应体为空" };
  }

  const reader = body.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let total = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;

    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel("response too large");
      return { ok: false, error: `响应体过大（上限 ${maxBytes} bytes）` };
    }

    chunks.push(decoder.decode(value, { stream: true }));
  }

  chunks.push(decoder.decode());
  return { ok: true, text: chunks.join("") };
}

export async function fetchRemotePlaylist(
  url: string,
  options: RemotePlaylistFetchOptions = {},
): Promise<RemotePlaylistFetchResult> {
  const parsed = parseHttpUrl(url);
  if (!parsed.ok || !parsed.url) {
    return {
      ok: false,
      status: 400,
      error: parsed.error ?? "URL 不合法",
    };
  }

  if (!isAddressAllowed(parsed.url.hostname)) {
    return {
      ok: false,
      status: 403,
      error:
        "目标地址不被允许（已拦截私网访问）。如需放开，请设置 ALLOW_PRIVATE_NETWORK=true。",
    };
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetchImpl(parsed.url.toString(), {
      method: "GET",
      headers: {
        Accept: "application/json",
        "User-Agent": "LocalVideoHub/remote-playlist-import",
      },
      redirect: "follow",
      signal: controller.signal,
      cache: "no-store",
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, status: 502, error: `请求远端播放列表失败：${message}` };
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    return {
      ok: false,
      status: 502,
      error: `远端返回异常状态：${response.status}`,
    };
  }

  if (!isJsonContentType(response.headers.get("content-type"))) {
    return {
      ok: false,
      status: 400,
      error: "远端响应不是 JSON（content-type 不匹配）",
    };
  }

  const readResult = await readTextWithLimit(response, maxBytes);
  if (!readResult.ok) {
    return { ok: false, status: 413, error: readResult.error };
  }

  let payload: unknown;
  try {
    payload = JSON.parse(readResult.text);
  } catch {
    return { ok: false, status: 400, error: "远端响应不是合法 JSON" };
  }

  if (!payload || typeof payload !== "object") {
    return { ok: false, status: 400, error: "远端 JSON 格式不正确" };
  }

  const maybe = payload as { videos?: unknown };
  if (!Array.isArray(maybe.videos)) {
    return { ok: false, status: 400, error: "远端 JSON 缺少 videos 数组" };
  }

  return { ok: true, payload };
}
