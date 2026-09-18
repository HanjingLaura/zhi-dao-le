const NETWORK_FETCH_MESSAGES = new Set([
  "Failed to fetch",
  "failed to fetch",
  "fetch failed",
  "Load failed",
  "NetworkError when attempting to fetch resource."
]);

export function appBasePath(value) {
  const resolved = value ?? import.meta.env?.VITE_APP_BASE_PATH;
  return String(resolved || "").replace(/\/+$/, "");
}

export function apiPath(path, basePath) {
  const normalizedPath = String(path || "").replace(/^\/+|\/+$/g, "");
  const prefix = appBasePath(basePath);
  // Parent microfrontend (hanjing-laura.vercel.app) 308s slashless POSTs.
  // Keep the trailing slash there; the dedicated domain must accept it too.
  return prefix ? `${prefix}/api/${normalizedPath}/` : `/api/${normalizedPath}`;
}

export async function postJson(url, body) {
  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
  } catch (error) {
    if (NETWORK_FETCH_MESSAGES.has(error?.message)) {
      const networkError = new Error("网络连接失败，请稍后重试");
      networkError.code = "network_error";
      networkError.cause = error;
      throw networkError;
    }
    throw error;
  }

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || "请求失败，请稍后重试");
    error.code = payload.code;
    throw error;
  }
  return payload.data;
}
