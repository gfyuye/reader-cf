export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  // 从环境变量读取后端地址（域名或 Worker 都可以）
  const BACKEND = env.READER3_BACKEND;
  if (!BACKEND) {
    return new Response("Missing READER3_BACKEND", { status: 500 });
  }

  // 去掉 /reader3 前缀，保留后续路径和查询参数
  const targetPath = url.pathname.replace(/^\/reader3/, "");
  const targetUrl = BACKEND.replace(/\/$/, "") + targetPath + url.search;

  // 转发请求（保留原始 method、headers、body）
  return fetch(new Request(targetUrl, request));
}