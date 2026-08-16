/**
 * 共享的 URL 安全校验（用于代理/远端导入）
 */

export interface HttpUrlValidationResult {
  ok: boolean;
  url?: URL;
  error?: string;
}

export function parseHttpUrl(urlStr: string): HttpUrlValidationResult {
  let parsed: URL;
  try {
    parsed = new URL(urlStr);
  } catch {
    return { ok: false, error: "URL 格式不合法" };
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    return { ok: false, error: `仅支持 http/https 协议，当前为 ${parsed.protocol}` };
  }

  return { ok: true, url: parsed };
}

export function allowPrivateNetwork(): boolean {
  return (
    process.env.ALLOW_PRIVATE_NETWORK === "true" ||
    process.env.ALLOW_PRIVATE_NETWORK === "1"
  );
}

/**
 * 默认拒绝私网地址，防止 SSRF
 */
export function isAddressAllowed(hostname: string): boolean {
  if (allowPrivateNetwork()) return true;

  // IPv4
  const ipv4Match = hostname.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (ipv4Match) {
    const octets = ipv4Match.slice(1).map(Number);
    const [a, b] = octets;
    if (a === 10) return false;
    if (a === 127) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 0) return false;
    return true;
  }

  // IPv6
  const lower = hostname.toLowerCase();
  if (lower === "::1" || lower === "[::1]") return false;
  if (lower.startsWith("fe80")) return false;
  if (lower.startsWith("fc") || lower.startsWith("fd")) return false;

  // localhost
  if (lower === "localhost" || lower.endsWith(".localhost")) return false;

  return true;
}
