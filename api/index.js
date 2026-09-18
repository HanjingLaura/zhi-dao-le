import app from "../server.js";

const REWRITTEN_PATH_PARAM = "__zhidaole_path";

export function restoreApiUrl(request) {
  const requestUrl = new URL(
    request.url || "/",
    `http://${request.headers.host || "localhost"}`
  );
  const rewrittenPath = requestUrl.searchParams.get(REWRITTEN_PATH_PARAM);
  if (rewrittenPath !== null) {
    requestUrl.searchParams.delete(REWRITTEN_PATH_PARAM);
    if (requestUrl.searchParams.get("path") === rewrittenPath) {
      requestUrl.searchParams.delete("path");
    }

    const normalizedPath = rewrittenPath.replace(/^\/+|\/+$/g, "");
    const query = requestUrl.searchParams.toString();
    request.url = `/api/${normalizedPath}${query ? `?${query}` : ""}`;
    return;
  }

  if (
    (requestUrl.pathname.startsWith("/api/") ||
      requestUrl.pathname.startsWith("/zhidaole/api/")) &&
    requestUrl.pathname.endsWith("/")
  ) {
    request.url = `${requestUrl.pathname.replace(/\/+$/, "")}${requestUrl.search}`;
  }
}

export default function handler(request, response) {
  restoreApiUrl(request);
  return app(request, response);
}
