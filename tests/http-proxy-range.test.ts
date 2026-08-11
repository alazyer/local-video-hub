import { describe, expect, test } from "bun:test";
import {
  parseClientRange,
  formatContentRange,
  createRangeSlicingStream,
  SYNTHESIS_DEFAULT_CHUNK,
} from "../src/lib/http-proxy-range";

describe("parseClientRange", () => {
  test("parses closed range bytes=start-end with known total", () => {
    expect(parseClientRange("bytes=0-1023", 77487291)).toEqual({
      start: 0,
      end: 1023,
    });
    expect(parseClientRange("bytes=40000000-40001023", 77487291)).toEqual({
      start: 40000000,
      end: 40001023,
    });
  });

  test("parses closed range bytes=start-end with unknown total", () => {
    expect(parseClientRange("bytes=0-1023", null)).toEqual({
      start: 0,
      end: 1023,
    });
  });

  test("open-end bytes=start- uses total-1 when total known", () => {
    expect(parseClientRange("bytes=100-", 500)).toEqual({
      start: 100,
      end: 499,
    });
  });

  test("open-end bytes=start- uses default chunk when total unknown", () => {
    const r = parseClientRange("bytes=100-", null);
    expect(r).toEqual({
      start: 100,
      end: 100 + SYNTHESIS_DEFAULT_CHUNK - 1,
    });
  });

  test("open-end bytes=start- respects custom chunkSize", () => {
    expect(parseClientRange("bytes=0-", null, 2048)).toEqual({
      start: 0,
      end: 2047,
    });
  });

  test("clamps end to total-1 when end exceeds total", () => {
    expect(parseClientRange("bytes=100-99999", 500)).toEqual({
      start: 100,
      end: 499,
    });
  });

  test("rejects start >= total (out of bounds) when total known", () => {
    expect(parseClientRange("bytes=500-600", 500)).toBeNull();
    expect(parseClientRange("bytes=501-", 500)).toBeNull();
  });

  test("bytes=* returns null (no synthesis, fall back to 200)", () => {
    expect(parseClientRange("bytes=*", 500)).toBeNull();
    expect(parseClientRange("bytes=*", null)).toBeNull();
  });

  test("suffix range bytes=-N supported only when total known", () => {
    expect(parseClientRange("bytes=-100", 500)).toEqual({
      start: 400,
      end: 499,
    });
    // unknown total → cannot locate "last N" → null
    expect(parseClientRange("bytes=-100", null)).toBeNull();
  });

  test("rejects malformed / invalid ranges", () => {
    expect(parseClientRange(null, 500)).toBeNull();
    expect(parseClientRange("", 500)).toBeNull();
    expect(parseClientRange("items=0-10", 500)).toBeNull();
    expect(parseClientRange("bytes=abc-10", 500)).toBeNull();
    expect(parseClientRange("bytes=10-abc", 500)).toBeNull();
    expect(parseClientRange("bytes=-", 500)).toBeNull();
  });

  test("rejects start > end", () => {
    expect(parseClientRange("bytes=100-50", 500)).toBeNull();
  });

  test("handles whitespace around values", () => {
    expect(parseClientRange("bytes= 0 - 1023 ", 5000)).toEqual({
      start: 0,
      end: 1023,
    });
  });
});

describe("formatContentRange", () => {
  test("formats with known total", () => {
    expect(formatContentRange(0, 1023, 77487291)).toBe(
      "bytes 0-1023/77487291",
    );
    expect(formatContentRange(40000000, 40001023, 77487291)).toBe(
      "bytes 40000000-40001023/77487291",
    );
  });

  test("formats with unknown total as *", () => {
    expect(formatContentRange(0, 1023, null)).toBe("bytes 0-1023/*");
  });
});

describe("createRangeSlicingStream", () => {
  /** Drain a ReadableStream into a single Uint8Array. */
  async function drain(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
    const reader = stream.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.length;
    }
    const out = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) {
      out.set(c, off);
      off += c.length;
    }
    return out;
  }

  /** Build a stream from a list of byte chunks. */
  function fromChunks(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
    return new ReadableStream({
      start(controller) {
        for (const c of chunks) controller.enqueue(c);
        controller.close();
      },
    });
  }

  test("emits only the requested window from a single chunk", async () => {
    const data = new Uint8Array(1000);
    for (let i = 0; i < data.length; i++) data[i] = i % 256;
    let cancelled = false;

    const sliced = fromChunks([data]).pipeThrough(
      createRangeSlicingStream(100, 199, () => {
        cancelled = true;
      }),
    );
    const out = await drain(sliced);

    expect(out.length).toBe(100);
    for (let i = 0; i < out.length; i++) {
      expect(out[i]).toBe((100 + i) % 256);
    }
    expect(cancelled).toBe(true);
  });

  test("emits window spanning multiple upstream chunks", async () => {
    const data = new Uint8Array(1000);
    for (let i = 0; i < data.length; i++) data[i] = i % 256;
    // feed as 50-byte chunks
    const chunks: Uint8Array[] = [];
    for (let i = 0; i < data.length; i += 50) {
      chunks.push(data.subarray(i, i + 50));
    }

    const sliced = fromChunks(chunks).pipeThrough(
      createRangeSlicingStream(120, 280, () => {}),
    );
    const out = await drain(sliced);

    expect(out.length).toBe(161);
    for (let i = 0; i < out.length; i++) {
      expect(out[i]).toBe((120 + i) % 256);
    }
  });

  test("discards bytes before start across chunk boundaries", async () => {
    const data = new Uint8Array(500);
    for (let i = 0; i < data.length; i++) data[i] = i % 256;

    const sliced = fromChunks([data]).pipeThrough(
      createRangeSlicingStream(300, 399, () => {}),
    );
    const out = await drain(sliced);

    expect(out.length).toBe(100);
    expect(out[0]).toBe(300 % 256);
    expect(out[99]).toBe(399 % 256);
  });

  test("full-file window bytes=0-(n-1) emits everything and cancels", async () => {
    const data = new Uint8Array(64);
    for (let i = 0; i < data.length; i++) data[i] = i;
    let cancelled = false;

    const sliced = fromChunks([data]).pipeThrough(
      createRangeSlicingStream(0, 63, () => {
        cancelled = true;
      }),
    );
    const out = await drain(sliced);

    expect(out.length).toBe(64);
    expect(cancelled).toBe(true);
  });

  test("does not copy or alias upstream buffer (output is independent)", async () => {
    const data = new Uint8Array(64);
    for (let i = 0; i < data.length; i++) data[i] = i;

    const sliced = fromChunks([data]).pipeThrough(
      createRangeSlicingStream(10, 20, () => {}),
    );
    const out = await drain(sliced);

    // mutate upstream after the fact; output must be unaffected
    data.fill(0);
    expect(out.length).toBe(11);
    expect(out[0]).toBe(10);
    expect(out[10]).toBe(20);
  });

  test("cancels upstream read once the window is satisfied mid-stream", async () => {
    // Upstream delivers data in two chunks: the window [10..20] is satisfied
    // by the first chunk. The transform MUST terminate so the second chunk is
    // never emitted to the consumer, and the cancel callback MUST fire.
    const first = new Uint8Array(100);
    for (let i = 0; i < first.length; i++) first[i] = i % 256;
    const second = new Uint8Array(900); // would-be extra bytes, must be dropped
    for (let i = 0; i < second.length; i++) second[i] = 255;

    let secondChunkPulled = false;
    const upstream = new ReadableStream({
      pull(controller) {
        if (!secondChunkPulled) {
          secondChunkPulled = true;
          controller.enqueue(first);
        } else {
          controller.enqueue(second);
          controller.close();
        }
      },
    });

    let cancelCallbackFired = false;
    const sliced = upstream.pipeThrough(
      createRangeSlicingStream(10, 20, () => {
        cancelCallbackFired = true;
      }),
    );
    const out = await drain(sliced);

    // Only the 11-byte window was emitted; the 900-byte second chunk (all 0xff)
    // must NOT appear in the output, proving the transform terminated the upstream.
    expect(out.length).toBe(11);
    expect(cancelCallbackFired).toBe(true);
    expect(out.every((b) => b !== 255)).toBe(true);
  });
});
