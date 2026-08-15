import "dotenv/config";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { structureJd, reviseJd } from "./server/bailian.js";

const app = express();
const api = express.Router();
const port = Number(process.env.PORT || 3210);
const production = process.argv.includes("--production");
const vercel = process.env.VERCEL === "1";
const root = path.dirname(fileURLToPath(import.meta.url));

app.disable("x-powered-by");
app.use(express.json({ limit: "256kb" }));

app.get("/favicon.ico", (_request, response) => response.status(204).end());

api.get("/health", (_request, response) => {
  const relayConfigured = Boolean(
    process.env.DASHSCOPE_RELAY_URL && process.env.DASHSCOPE_RELAY_TOKEN
  );
  response.json({
    ok: true,
    model: process.env.DASHSCOPE_MODEL || "qwen-plus",
    apiConfigured: relayConfigured || Boolean(process.env.DASHSCOPE_API_KEY),
    connection: relayConfigured ? "relay" : "direct"
  });
});

api.post("/structure-jd", async (request, response) => {
  const rawJd = String(request.body?.rawJd || "").trim();
  const mode = String(request.body?.mode || "faithful");
  if (rawJd.length < 10) {
    return response.status(400).json({
      error: "请粘贴更完整的岗位信息",
      code: "raw_jd_too_short"
    });
  }

  try {
    const data = await structureJd({
      rawJd,
      mode,
      searchOfficialLink:
        mode !== "confidential" && request.body?.searchOfficialLink === true
    });
    return response.json({ data });
  } catch (error) {
    const status = error.code === "missing_api_key" ? 503 : error.status || 502;
    return response.status(status).json({
      error: error.message || "JD 整理失败，请稍后重试",
      code: error.code || "unknown_error"
    });
  }
});

api.post("/revise-jd", async (request, response) => {
  const instruction = String(request.body?.instruction || "").trim();
  if (!instruction) {
    return response.status(400).json({
      error: "请告诉 AI 需要如何修改",
      code: "missing_instruction"
    });
  }

  try {
    const data = await reviseJd({
      current: request.body?.current,
      instruction,
      mode: request.body?.mode
    });
    return response.json({ data });
  } catch (error) {
    const status = error.code === "missing_api_key" ? 503 : error.status || 502;
    return response.status(status).json({
      error: error.message || "修改失败，请稍后重试",
      code: error.code || "unknown_error"
    });
  }
});

app.use("/api", api);
app.use("/zhidaole/api", api);

if (vercel) {
  // Vercel serves the Vite build from its CDN and invokes this app for API routes.
} else if (production) {
  const dist = path.join(root, "dist");
  app.use(express.static(dist, { index: false, maxAge: "1h" }));
  app.get("*path", (_request, response) => {
    response.sendFile(path.join(dist, "index.html"));
  });
} else {
  const { createServer: createViteServer } = await import("vite");
  const vite = await createViteServer({
    root,
    server: { middlewareMode: true },
    appType: "spa"
  });
  app.use(vite.middlewares);
}

app.use((error, _request, response, _next) => {
  console.error(error);
  response.status(500).json({ error: "服务暂时不可用", code: "server_error" });
});

if (!vercel) {
  app.listen(port, "127.0.0.1", () => {
    console.log(`职到了已启动：http://127.0.0.1:${port}`);
  });
}

export default app;
