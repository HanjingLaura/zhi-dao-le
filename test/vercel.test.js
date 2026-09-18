import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { readFile } from "node:fs/promises";

process.env.VERCEL = "1";

const { restoreApiUrl, default: handler } = await import("../api/index.js");

test("还原 Vercel 重写后的职到了 API 路径", () => {
  const request = {
    headers: { host: "hanjing-laura.vercel.app" },
    url: "/api/index?__zhidaole_path=structure-jd"
  };

  restoreApiUrl(request);

  assert.equal(request.url, "/api/structure-jd");
});

test("清理微前端重写参数并保留原始查询参数", () => {
  const request = {
    headers: { host: "hanjing-laura.vercel.app" },
    url: "/zhidaole/api/health?__zhidaole_path=health&path=health&source=check"
  };

  restoreApiUrl(request);

  assert.equal(request.url, "/api/health?source=check");
});

test("去掉 Vercel 重写路径中的尾斜杠", () => {
  const request = {
    headers: { host: "zhi-dao-le.vercel.app" },
    url: "/api/index?__zhidaole_path=structure-jd/"
  };

  restoreApiUrl(request);

  assert.equal(request.url, "/api/structure-jd");
});

test("直接去掉未重写 API 请求的尾斜杠", () => {
  const request = {
    headers: { host: "zhi-dao-le.vercel.app" },
    url: "/api/revise-jd/"
  };

  restoreApiUrl(request);

  assert.equal(request.url, "/api/revise-jd");
});

test("不改写未经过 Vercel 路由的请求", () => {
  const request = {
    headers: { host: "localhost" },
    url: "/api/health"
  };

  restoreApiUrl(request);

  assert.equal(request.url, "/api/health");
});

test("Express 接受带尾斜杠的职到了 API", async () => {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();

  try {
    const response = await fetch(`http://127.0.0.1:${port}/zhidaole/api/health/`);
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.ok, true);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

test("vercel.json 显式匹配带尾斜杠的职到了 API", async () => {
  const config = JSON.parse(
    await readFile(new URL("../vercel.json", import.meta.url), "utf8")
  );
  const sources = config.rewrites.map((rule) => rule.source);

  assert.equal(sources.includes("/zhidaole/api/:path/"), true);
  assert.equal(sources.includes("/api/:path/"), true);
  assert.equal(sources.includes("/zhidaole/"), true);
  assert.ok(
    sources.indexOf("/zhidaole/api/:path/") < sources.indexOf("/zhidaole/api/:path*"),
    "带尾斜杠的 API 规则需要排在通配规则前面"
  );
});
