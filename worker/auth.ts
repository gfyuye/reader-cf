import { getAccessToken } from "./http";
import { getEnv } from "./env";
import { Env } from "./types";

export function isAuthorizedAdmin(request: Request, env: Env): boolean {
  const configuredKey = getEnv(env, "SECURE_KEY");
  if (!configuredKey) return false;
  const secureKey = request.headers.get("X-Secure-Key") || new URL(request.url).searchParams.get("secureKey");
  return secureKey === configuredKey;
}

export async function resolveUserNs(request: Request, env: Env): Promise<string | null> {
  const accessToken = getAccessToken(request);

  if (accessToken && accessToken.includes(":")) {
    const [username, token] = accessToken.split(":");
    const session = await env.DB.prepare(
      `SELECT username FROM user_sessions WHERE username = ?1 AND token = ?2 AND expire_at > ?3`
    )
      .bind(username, token, Math.floor(Date.now() / 1000))
      .first<{ username: string }>();

    if (session) {
      if (isAuthorizedAdmin(request, env)) {
        const overrideNs = new URL(request.url).searchParams.get("userNS");
        if (overrideNs && overrideNs.trim()) {
          return overrideNs.trim();
        }
      }
      return session.username;
    }
  }

  return null;
}
