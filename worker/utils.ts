import { getEnv } from "./env";
import { Env } from "./types";

export function randomString(len: number): string {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const buf = new Uint8Array(len);
  crypto.getRandomValues(buf);
  let res = "";
  for (let i = 0; i < len; i++) res += chars[buf[i] % chars.length];
  return res;
}

export function isSafeRemoteUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl.trim());
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;

    const hostname = parsed.hostname.toLowerCase();
    if (
      hostname === "localhost" ||
      hostname.endsWith(".localhost") ||
      hostname.endsWith(".local") ||
      hostname.endsWith(".internal") ||
      hostname.endsWith(".lan") ||
      hostname === "127.0.0.1" ||
      hostname === "0.0.0.0" ||
      hostname === "::1" ||
      hostname === "169.254.169.254"
    ) {
      return false;
    }

    // Check private IPv4 ranges
    const ipv4Regex = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
    const match = hostname.match(ipv4Regex);
    if (match) {
      const a = parseInt(match[1], 10);
      const b = parseInt(match[2], 10);
      if (a === 127 || a === 10 || a === 0) return false;
      if (a === 172 && b >= 16 && b <= 31) return false;
      if (a === 192 && b === 168) return false;
      if (a === 169 && b === 254) return false;
      if (a === 100 && b >= 64 && b <= 127) return false;
    }

    // Block link-local IPv6
    if (hostname.includes(":")) {
      if (hostname === "::1" || hostname.startsWith("fe80:") || hostname.startsWith("fc") || hostname.startsWith("fd")) {
        return false;
      }
    }

    return true;
  } catch {
    return false;
  }
}

export async function fetchTextWithEncoding(resp: Response): Promise<string> {
  const buf = await resp.arrayBuffer();
  const contentType = resp.headers.get("content-type") || "";
  const charsetMatch = contentType.match(/charset=([^;,\s]+)/i);
  let charset = charsetMatch ? charsetMatch[1].toLowerCase() : "";

  if (!charset) {
    const html = new TextDecoder("utf-8").decode(new Uint8Array(buf));
    const metaMatch = html.match(/<meta[^>]+charset=["']?([^"'>\s]+)/i) || html.match(/<meta[^>]+content=["'][^"']*charset=([^"'>\s]+)/i);
    if (metaMatch) charset = metaMatch[1].toLowerCase();
  }

  if (charset.includes("gbk") || charset.includes("gb2312") || charset.includes("big5")) {
    try {
      const dec = new TextDecoder("gbk");
      return dec.decode(buf);
    } catch {
      // fallthrough
    }
  }
  try {
    return new TextDecoder("utf-8").decode(buf);
  } catch {
    return new TextDecoder("latin1").decode(buf);
  }
}
