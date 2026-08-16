import { describe, expect, test } from "bun:test";

import { POST } from "../src/app/api/url-playlist/import/route";

describe("POST /api/url-playlist/import", () => {
  test("returns 400 when the request body is invalid JSON", async () => {
    const request = {
      json: async () => {
        throw new Error("invalid json");
      },
    } as unknown as Parameters<typeof POST>[0];

    const response = await POST(request);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "请求体必须是合法 JSON" });
  });

  test("returns 400 when url is missing", async () => {
    const request = {
      json: async () => ({}),
    } as unknown as Parameters<typeof POST>[0];

    const response = await POST(request);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "url 不能为空" });
  });

  test("maps upstream fetch failures to the response status and error", async () => {
    const request = {
      json: async () => ({ url: "file:///tmp/playlist.json" }),
    } as unknown as Parameters<typeof POST>[0];

    const response = await POST(request);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "仅支持 http/https 协议，当前为 file:",
    });
  });
});
