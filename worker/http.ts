export function corsHeaders(request?: Request): Record<string, string> {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, Range, X-User-NS, X-File-Name, X-Requested-With",
  };
  if (request) {
    const origin = request.headers.get("origin");
    if (origin) {
      headers["Access-Control-Allow-Origin"] = origin;
    }
  }
  return headers;
}

export function jsonResponse(data: any, status: number = 200, request?: Request): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders(request),
    },
  });
}

export function getAccessToken(request: Request): string | null {
  const auth = request.headers.get("Authorization");
  if (auth && auth.trim()) {
    const trimmed = auth.trim();
    if (trimmed.toLowerCase().startsWith("bearer ")) {
      const token = trimmed.substring(7).trim();
      if (token) return token;
    } else {
      return trimmed;
    }
  }
  const tokenHeader = request.headers.get("token") || request.headers.get("X-Access-Token");
  if (tokenHeader && tokenHeader.trim()) return tokenHeader.trim();

  const cookie = request.headers.get("Cookie") || "";
  const match = cookie.match(/token=([^;]+)/);
  if (match) return decodeURIComponent(match[1]);

  const url = new URL(request.url);
  return url.searchParams.get("accessToken") || url.searchParams.get("token");
}
