const RELAY_HEADER = "X-Zhidaole-Relay-Token";
const MAX_BODY_BYTES = 320_000;

const jsonResponse = (body, status = 200) =>
  Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff"
    }
  });

export async function handleRequest(request, env, fetchImpl = fetch) {
  const url = new URL(request.url);

  if (request.method === "GET" && url.pathname === "/health") {
    return jsonResponse({
      ok: true,
      configured: Boolean(env.DASHSCOPE_API_KEY && env.RELAY_TOKEN)
    });
  }

  if (url.pathname !== "/chat/completions") {
    return jsonResponse({ error: "Not found" }, 404);
  }
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }
  if (!env.DASHSCOPE_API_KEY || !env.RELAY_TOKEN) {
    return jsonResponse({ error: "Relay is not configured" }, 503);
  }
  if (request.headers.get(RELAY_HEADER) !== env.RELAY_TOKEN) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }
  if (!request.headers.get("Content-Type")?.includes("application/json")) {
    return jsonResponse({ error: "JSON body required" }, 415);
  }

  const declaredLength = Number(request.headers.get("Content-Length") || 0);
  if (declaredLength > MAX_BODY_BYTES) {
    return jsonResponse({ error: "Request body too large" }, 413);
  }

  const body = await request.arrayBuffer();
  if (body.byteLength > MAX_BODY_BYTES) {
    return jsonResponse({ error: "Request body too large" }, 413);
  }

  const baseUrl = String(
    env.DASHSCOPE_BASE_URL ||
      "https://dashscope.aliyuncs.com/compatible-mode/v1"
  ).replace(/\/$/, "");

  try {
    const upstream = await fetchImpl(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.DASHSCOPE_API_KEY}`,
        Accept: "application/json",
        "Content-Type": "application/json"
      },
      body
    });
    const headers = new Headers({
      "Cache-Control": "no-store",
      "Content-Type": upstream.headers.get("Content-Type") || "application/json",
      "X-Content-Type-Options": "nosniff"
    });
    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers
    });
  } catch (error) {
    console.error("DashScope relay failed", {
      name: error?.name,
      message: error?.message
    });
    return jsonResponse({ error: "Upstream connection failed" }, 502);
  }
}

export default {
  fetch(request, env) {
    return handleRequest(request, env);
  }
};
