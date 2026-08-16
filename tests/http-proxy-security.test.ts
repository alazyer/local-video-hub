import { afterEach, describe, expect, test } from "bun:test";
import {
  allowPrivateNetwork,
  isAddressAllowed,
  parseHttpUrl,
} from "../src/lib/http-proxy-security";

const ORIGINAL_ALLOW_PRIVATE_NETWORK = process.env.ALLOW_PRIVATE_NETWORK;

afterEach(() => {
  if (ORIGINAL_ALLOW_PRIVATE_NETWORK == null) {
    delete process.env.ALLOW_PRIVATE_NETWORK;
  } else {
    process.env.ALLOW_PRIVATE_NETWORK = ORIGINAL_ALLOW_PRIVATE_NETWORK;
  }
});

describe("parseHttpUrl", () => {
  test("accepts http/https", () => {
    const http = parseHttpUrl("http://example.com/a.json");
    const https = parseHttpUrl("https://example.com/a.json");

    expect(http.ok).toBe(true);
    expect(http.url?.protocol).toBe("http:");
    expect(https.ok).toBe(true);
    expect(https.url?.protocol).toBe("https:");
  });

  test("rejects invalid url and unsupported protocol", () => {
    expect(parseHttpUrl("not-a-url").ok).toBe(false);
    expect(parseHttpUrl("file:///tmp/a.json").ok).toBe(false);
  });
});

describe("allowPrivateNetwork", () => {
  test("defaults to false", () => {
    delete process.env.ALLOW_PRIVATE_NETWORK;
    expect(allowPrivateNetwork()).toBe(false);
  });

  test("accepts true/1", () => {
    process.env.ALLOW_PRIVATE_NETWORK = "true";
    expect(allowPrivateNetwork()).toBe(true);

    process.env.ALLOW_PRIVATE_NETWORK = "1";
    expect(allowPrivateNetwork()).toBe(true);
  });
});

describe("isAddressAllowed", () => {
  test("blocks private and localhost by default", () => {
    delete process.env.ALLOW_PRIVATE_NETWORK;

    expect(isAddressAllowed("127.0.0.1")).toBe(false);
    expect(isAddressAllowed("10.0.0.1")).toBe(false);
    expect(isAddressAllowed("172.16.0.1")).toBe(false);
    expect(isAddressAllowed("192.168.1.1")).toBe(false);
    expect(isAddressAllowed("localhost")).toBe(false);
    expect(isAddressAllowed("api.localhost")).toBe(false);
    expect(isAddressAllowed("::1")).toBe(false);
  });

  test("allows public addresses", () => {
    delete process.env.ALLOW_PRIVATE_NETWORK;

    expect(isAddressAllowed("8.8.8.8")).toBe(true);
    expect(isAddressAllowed("example.com")).toBe(true);
  });

  test("allows private addresses when ALLOW_PRIVATE_NETWORK is enabled", () => {
    process.env.ALLOW_PRIVATE_NETWORK = "true";

    expect(isAddressAllowed("127.0.0.1")).toBe(true);
    expect(isAddressAllowed("192.168.1.1")).toBe(true);
    expect(isAddressAllowed("localhost")).toBe(true);
  });
});
