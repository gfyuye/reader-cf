import { jsonResponse, corsHeaders } from "../http";
import { resolveUserNs } from "../auth";
import { Env } from "../types";

export async function handleGetAsset(request: Request, env: Env): Promise<Response> {
  try {
    const url = new URL(request.url);
    const path = url.pathname;

    // /assets/... 或 /reader3/cover?key=...
    let objectKey: string | null = null;

    if (path.startsWith("/assets/")) {
      objectKey = path.substring("/assets/".length);
    } else if (path === "/reader3/cover") {
      objectKey = url.searchParams.get("key") || url.searchParams.get("r2Key") || null;
    }

    if (!objectKey) {
      return new Response("Not Found", { status: 404, headers: corsHeaders() });
    }

    const userNs = await resolveUserNs(request, env);
    const isCover = path === "/reader3/cover";
    if (userNs) {
      // Authenticated users may access their own assets, or public covers
      if (!objectKey.startsWith(`${userNs}/`) && !isCover) {
        return new Response("Forbidden", { status: 403, headers: corsHeaders() });
      }
    } else {
      // Anonymous access: only public covers allowed
      if (!isCover) {
        return new Response("Forbidden", { status: 403, headers: corsHeaders() });
      }
    }

    const obj = await env.BUCKET.get(objectKey);
    if (!obj) return new Response("Asset Not Found", { status: 404, headers: corsHeaders() });

    const contentType = obj.httpMetadata?.contentType || "application/octet-stream";
    const headers = new Headers(corsHeaders());
    headers.set("Content-Type", contentType);
    headers.set("Cache-Control", "public, max-age=31536000");

    return new Response(obj.body, { headers });
  } catch (err: any) {
    return jsonResponse({ isSuccess: false, errorMsg: err.message });
  }
}
