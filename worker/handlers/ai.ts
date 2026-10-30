import { jsonResponse } from "../http";
import { resolveUserNs } from "../auth";
import { getEnv } from "../env";
import { Env } from "../types";
import * as documentHandlers from "../handlers/document";
import { isSafeRemoteUrl } from "../utils";

export async function handleGetAiBookMemory(request: Request, env: Env): Promise<Response> {
  try {
    const userNs = await resolveUserNs(request, env);
    if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });

    const url = new URL(request.url);
    const bookId = url.searchParams.get("bookId") || "";
    if (!bookId) return jsonResponse({ isSuccess: false, errorMsg: "缺少 bookId" });

    const data = await documentHandlers.getDocument(env, `${userNs}:${bookId}`, "ai-memory.json");
    return jsonResponse({ isSuccess: true, data: data || [] });
  } catch (err: any) {
    return jsonResponse({ isSuccess: false, errorMsg: err.message });
  }
}

export async function handleSaveAiBookMemory(request: Request, env: Env): Promise<Response> {
  try {
    const userNs = await resolveUserNs(request, env);
    if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });

    const body = await request.json<any>();
    const { bookId, memory } = body;
    if (!bookId || memory === undefined) {
      return jsonResponse({ isSuccess: false, errorMsg: "缺少 bookId 或 memory" });
    }

    await documentHandlers.saveDocument(env, `${userNs}:${bookId}`, "ai-memory.json", memory);
    return jsonResponse({ isSuccess: true, data: "AI 记忆已保存" });
  } catch (err: any) {
    return jsonResponse({ isSuccess: false, errorMsg: err.message });
  }
}

export async function handleDeleteAiBookMemory(request: Request, env: Env): Promise<Response> {
  try {
    const userNs = await resolveUserNs(request, env);
    if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });

    const url = new URL(request.url);
    const bookId = url.searchParams.get("bookId") || "";
    if (!bookId) return jsonResponse({ isSuccess: false, errorMsg: "缺少 bookId" });

    await documentHandlers.deleteDocument(env, `${userNs}:${bookId}`, "ai-memory.json");
    return jsonResponse({ isSuccess: true, data: "AI 记忆已删除" });
  } catch (err: any) {
    return jsonResponse({ isSuccess: false, errorMsg: err.message });
  }
}

export async function handleAiProxy(request: Request, env: Env): Promise<Response> {
  try {
    const userNs = await resolveUserNs(request, env);
    if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });

    const body = await request.json<any>();
    const { model, messages, apiKey, apiUrl, temperature, maxTokens } = body;

    const targetUrl = apiUrl || getEnv(env, "AI_API_URL");
    const key = apiKey || getEnv(env, "AI_API_KEY");

    if (!targetUrl) {
      return jsonResponse({ isSuccess: false, errorMsg: "未配置 AI API 地址" });
    }
    if (!isSafeRemoteUrl(targetUrl)) {
      return jsonResponse({ isSuccess: false, errorMsg: "禁止访问内网或本地地址 (SSRF 防御)" });
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (key) headers["Authorization"] = `Bearer ${key}`;

    const payload: any = {
      model: model || getEnv(env, "AI_MODEL", "gpt-3.5-turbo"),
      messages: Array.isArray(messages) ? messages : [],
      temperature: temperature !== undefined ? temperature : 0.7,
      max_tokens: maxTokens || parseInt(getEnv(env, "AI_MAX_TOKENS", "2000"), 10),
    };

    const resp = await fetch(targetUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });

    if (!resp.ok) {
      return jsonResponse({ isSuccess: false, errorMsg: `AI 服务返回 HTTP ${resp.status}` });
    }

    const result = await resp.json();
    return jsonResponse({ isSuccess: true, data: result });
  } catch (err: any) {
    return jsonResponse({ isSuccess: false, errorMsg: err.message });
  }
}

export async function handleAiProxyImage(request: Request, env: Env): Promise<Response> {
  try {
    const userNs = await resolveUserNs(request, env);
    if (!userNs) return jsonResponse({ isSuccess: false, errorMsg: "请登录后使用", data: "NEED_LOGIN" });

    const body = await request.json<any>();
    const { prompt, model, apiKey, apiUrl } = body;

    const targetUrl = apiUrl || getEnv(env, "AI_IMAGE_API_URL");
    const key = apiKey || getEnv(env, "AI_IMAGE_API_KEY");

    if (!targetUrl) {
      return jsonResponse({ isSuccess: false, errorMsg: "未配置 AI 图片 API 地址" });
    }
    if (!isSafeRemoteUrl(targetUrl)) {
      return jsonResponse({ isSuccess: false, errorMsg: "禁止访问内网或本地地址 (SSRF 防御)" });
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (key) headers["Authorization"] = `Bearer ${key}`;

    const payload: any = {
      model: model || getEnv(env, "AI_IMAGE_MODEL", "dall-e-3"),
      prompt: prompt || "",
      n: 1,
      size: "1024x1024",
    };

    const resp = await fetch(targetUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });

    if (!resp.ok) {
      return jsonResponse({ isSuccess: false, errorMsg: `AI 图片服务返回 HTTP ${resp.status}` });
    }

    const result = await resp.json();
    return jsonResponse({ isSuccess: true, data: result });
  } catch (err: any) {
    return jsonResponse({ isSuccess: false, errorMsg: err.message });
  }
}
