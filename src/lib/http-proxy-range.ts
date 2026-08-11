/**
 * HTTP 代理服务端 Range 合成辅助函数
 *
 * 与 `server-videos-shared.ts` 的 `parseRange` 不同：后者需要已知 `fileSize`，
 * 而代理场景下上游可能省略 `Content-Length`（total 未知，用 `*` 表示）。
 * 这里独立实现，支持 total 未知与开放端 Range。
 *
 * 纯函数，无副作用，便于单元测试。
 */

/** Range 解析结果 */
export interface ClientRange {
  start: number;
  end: number;
}

/** 合成 206 所需的窗口大小上限（开放端 Range 的默认 chunk 大小） */
export const SYNTHESIS_DEFAULT_CHUNK = 1024 * 1024; // 1 MB

/**
 * 解析客户端 `Range: bytes=...` 头，用于代理服务端 Range 合成。
 *
 * 支持形式：
 *  - `bytes=start-end`        → [start, end]
 *  - `bytes=start-`           → end = start + chunkSize - 1（开放端，避免下载整个尾部）
 *  - `bytes=*`                → 无效（无具体范围，不合成）
 *
 * 当 `total` 已知（上游提供 Content-Length）时：
 *  - 开放端 `bytes=start-` → end = total - 1
 *  - end 超出 total → 截断到 total - 1
 *  - start >= total → 无效（越界）
 *
 * 当 `total` 未知（null）时：
 *  - 开放端 → end = start + chunkSize - 1
 *  - 闭合端 → 按字面值（end 不截断，因为不知道文件实际大小）
 *
 * @param rangeHeader 客户端 `Range` 头值（可能为 null）
 * @param total       上游总字节数；未知时传 null
 * @param chunkSize   开放端 Range 的默认窗口大小，默认 1 MB
 * @returns 解析结果；无效/畸形返回 null（调用方回退 200 透传）
 */
export function parseClientRange(
  rangeHeader: string | null,
  total: number | null,
  chunkSize: number = SYNTHESIS_DEFAULT_CHUNK,
): ClientRange | null {
  if (!rangeHeader) return null;

  const prefix = "bytes=";
  if (!rangeHeader.startsWith(prefix)) return null;

  const spec = rangeHeader.slice(prefix.length).trim();

  // bytes=* → 全量范围，不合成（让调用方走 200 透传）
  if (spec === "*") return null;

  const dashIdx = spec.indexOf("-");
  if (dashIdx === -1) return null;

  const startStr = spec.slice(0, dashIdx).trim();
  const endStr = spec.slice(dashIdx + 1).trim();

  // 后缀范围 bytes=-N（请求最后 N 字节）—— 代理合成场景无意义，
  // 因为 total 未知时无法定位「最后」。仅当 total 已知时支持。
  if (startStr === "") {
    if (total == null) return null;
    const suffixLen = parseInt(endStr, 10);
    if (isNaN(suffixLen) || suffixLen <= 0) return null;
    const start = Math.max(0, total - suffixLen);
    const end = total - 1;
    if (start > end) return null;
    return { start, end };
  }

  const start = parseInt(startStr, 10);
  if (isNaN(start) || start < 0) return null;

  let end: number;
  if (endStr === "") {
    // 开放端 bytes=start-
    end = total != null ? total - 1 : start + chunkSize - 1;
  } else {
    end = parseInt(endStr, 10);
    if (isNaN(end)) return null;
  }

  if (start > end) return null;

  // total 已知时截断越界 end
  if (total != null) {
    if (start >= total) return null; // 越界起始
    if (end >= total) end = total - 1;
  }

  return { start, end };
}

/**
 * 构造 `Content-Range` 头值。
 *
 * @param start  起始字节（含）
 * @param end    结束字节（含）
 * @param total  总字节数；未知时为 null → 输出 `*`
 */
export function formatContentRange(
  start: number,
  end: number,
  total: number | null,
): string {
  const totalPart = total != null ? String(total) : "*";
  return `bytes ${start}-${end}/${totalPart}`;
}

/**
 * 构造一个 TransformStream，从上游流中切片出 [start, end] 字节窗口。
 *
 * 行为：
 *  - 丢弃 start 前字节（计数，未到达 start 前不 enqueue）。
 *  - enqueue start 到 end 字节。
 *  - 输出 end 字节后取消上游读取（terminate + destroy）。
 *
 * @param start      起始字节（含）
 * @param end        结束字节（含）
 * @param cancelUpstream  输出窗口后取消上游读取的回调（销毁 node stream）
 */
export function createRangeSlicingStream(
  start: number,
  end: number,
  cancelUpstream: () => void,
): TransformStream<Uint8Array, Uint8Array> {
  const windowSize = end - start + 1;
  let emitted = 0; // 已 enqueue 的窗口内字节数
  let skipped = 0; // 已丢弃的 start 前字节数
  let cancelled = false;

  return new TransformStream({
    transform(chunk, controller) {
      if (cancelled) return;

      let offset = 0;

      // 1. 丢弃 start 前字节
      if (skipped < start) {
        const needToSkip = start - skipped;
        if (chunk.length <= needToSkip) {
          skipped += chunk.length;
          return; // 整块都在窗口前，全部丢弃
        }
        offset = needToSkip;
        skipped = start;
      }

      // 2. 到达窗口：输出剩余字节，但不超过 windowSize - emitted
      const remaining = windowSize - emitted;
      if (remaining <= 0) return;

      const available = chunk.length - offset;
      const take = Math.min(available, remaining);

      if (take > 0) {
        // 复制切片，避免持有上游 buffer 的引用（上游可能在 destroy 后回收）
        const slice = chunk.subarray(offset, offset + take);
        const copy = new Uint8Array(slice.length);
        copy.set(slice);
        controller.enqueue(copy);
        emitted += take;
      }

      // 3. 窗口已满 → 取消上游读取
      if (emitted >= windowSize) {
        cancelled = true;
        try {
          controller.terminate();
        } catch {
          // 已 terminate，忽略
        }
        cancelUpstream();
      }
    },
  });
}
